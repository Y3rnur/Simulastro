package websocket

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/yernur/astrophysics_simulation/server/internal/auth"
	"github.com/yernur/astrophysics_simulation/server/internal/cache"
	db "github.com/yernur/astrophysics_simulation/server/internal/db"
	pb "github.com/yernur/astrophysics_simulation/server/proto"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	writeWait      = 10 * time.Second    // Time allowed to write a message to the peer.
	pongWait       = 60 * time.Second    // Time allowed to read the next pong message from the peer.
	pingPeriod     = (pongWait * 9) / 10 // Send pings to peer with this period. Must be less than pongWait.
	maxMessageSize = 8192                // Maximum message size allowed from peer.
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allowing all origins for local cross-origin canvas visualization convenience
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Client represents the intermediary link between the frontend canvas and the server Hub
type Client struct {
	Hub       *Hub
	Conn      *websocket.Conn
	Send      chan []byte
	simCache  *cache.SimulationCache // reference to history cache for time-travel queries
	isPaused  bool                   // state valve for streaming gating
	UserID    pgtype.UUID            // client's database user ID
	DbQueries *db.Queries            // sqlc queries handle
}

// Small struct to parse the control payload
type WSMessage struct {
	Type         string      `json:"type"`
	Command      string      `json:"command,omitempty"`
	Multiplier   float64     `json:"multiplier,omitempty"`
	Scene        *SceneDraft `json:"scene,omitempty"`
	SceneID      string      `json:"scene_id,omitempty"`
	Name         string      `json:"name,omitempty"`
	Descriptions string      `json:"descriptions,omitempty"`
}

type SceneDraft struct {
	Bodies []DraftBody `json:"bodies"`
}

type DraftBody struct {
	ID     int     `json:"id"`
	Mass   float64 `json:"mass"`
	Radius float64 `json:"radius"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Vx     float64 `json:"vx"`
	Vy     float64 `json:"vy"`
	Alive  bool    `json:"alive"`
}

type SceneSummaryResponse struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Descriptions string    `json:"descriptions"`
	CreatedAt    time.Time `json:"created_at"`
}

func (c *Client) SendError(msg string) {
	errEnvelope := map[string]string{
		"type":  "ERROR",
		"error": msg,
	}
	bytes, _ := json.Marshal(errEnvelope)

	// non-blocking send
	select {
	case c.Send <- bytes:
	default:
		log.Println("⚠️ Could not send error: channel full")
	}
}

func handleControl(c *Client, cmd string) {
	switch cmd {
	case "PAUSE":
		c.isPaused = true
		if c.Hub.ControlClient != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			_, err := c.Hub.ControlClient.Control(ctx, &pb.ControlRequest{
				Command: pb.ControlRequest_PAUSE,
			})
			if err != nil {
				c.SendError("Engine pause failed")
				return
			}
		}
		log.Println("⏸️ System Paused")
	case "PLAY":
		c.isPaused = false
		if c.Hub.ControlClient != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			_, err := c.Hub.ControlClient.Control(ctx, &pb.ControlRequest{
				Command: pb.ControlRequest_PLAY,
			})
			if err != nil {
				c.SendError("Engine play failed")
				return
			}
		}
		log.Println("▶️ System Playing")

	default:
		c.SendError("Invalid control command: " + cmd)
	}
}

func handleSceneUpload(c *Client, scene *SceneDraft) {
	if scene == nil || len(scene.Bodies) == 0 {
		c.SendError("Empty scene received")
		return
	}

	// Forward to C++ engine via gRPC
	pbBodies := make([]*pb.BodyState, len(scene.Bodies))
	for i, b := range scene.Bodies {
		pbBodies[i] = &pb.BodyState{
			Id:     int32(b.ID),
			Mass:   b.Mass,
			Radius: b.Radius,
			X:      b.X,
			Y:      b.Y,
			Vx:     b.Vx,
			Vy:     b.Vy,
			Alive:  b.Alive,
		}
	}

	req := &pb.UploadSceneRequest{Bodies: pbBodies}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	resp, err := c.Hub.SceneClient.UploadScene(ctx, req)

	if err != nil {
		log.Printf("❌ Failed to send scene to C++ engine: %v", err)
		c.SendError("Engine communication failed")
		return
	}

	if !resp.Success {
		c.SendError("Engine rejected scene: " + resp.Message)
		return
	}

	log.Printf("✅ Scene successfully forwarded to C++ engine: %s", resp.Message)
}

func handleSaveScene(c *Client, scene *SceneDraft, userID pgtype.UUID, dbQueries *db.Queries) {
	if scene == nil || len(scene.Bodies) == 0 {
		c.SendError("Empty scene received for saving")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Generate a new pgtype.UUID for the scene
	var sceneID pgtype.UUID
	if err := sceneID.Scan(uuid.New().String()); err != nil {
		log.Printf("❌ Failed to generate scene UUID: %v", err)
		c.SendError("Internal server error")
		return
	}

	sceneName := fmt.Sprintf("Custom Cosmic Layout %s", time.Now().Format("Jan 02 15:04"))

	log.Printf("🔍 DEBUG: About to call CreateScene. UserID Valid: %v, Bytes: %v", userID.Valid, userID.Bytes)

	_, dbErr := dbQueries.CreateScene(ctx, db.CreateSceneParams{
		ID:       sceneID,
		UserID:   userID,
		Name:     sceneName,
		IsPublic: false,
	})
	if dbErr != nil {
		log.Printf("❌ Failed to save scene to database: %v", dbErr)
		c.SendError("Failed to persist scene in database")
		return
	}

	// Insert each body
	for index, b := range scene.Bodies {
		var bodyUUID pgtype.UUID
		_ = bodyUUID.Scan(uuid.New().String())

		err := dbQueries.InsertSceneBody(ctx, db.InsertSceneBodyParams{
			ID:        bodyUUID,
			SceneID:   sceneID,
			BodyIndex: int32(index),
			BodyID:    int32(b.ID),
			Mass:      b.Mass,
			Radius:    b.Radius,
			X:         b.X,
			Y:         b.Y,
			Vx:        b.Vx,
			Vy:        b.Vy,
			Alive:     b.Alive,
		})
		if err != nil {
			log.Printf("⚠️ Failed to insert scene body %d: %v", b.ID, err)
		}
	}

	log.Printf("💾 Scene successfully saved to PostgreSQL! Scene ID: %s", sceneID.Bytes)
}

func handleListScenes(c *Client) {
	if !c.UserID.Valid {
		c.SendError("Unauthorized: must be logged in to view saved scenes")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	dbScenes, err := c.DbQueries.GetScenesByUserId(ctx, c.UserID)
	if err != nil {
		log.Printf("❌ Failed to fetch user scenes: %v", err)
		c.SendError("Failed to fetch scenes from database")
		return
	}

	log.Printf("📂 Found %d scenes for user %s", len(dbScenes), c.UserID.String())

	scenes := make([]SceneSummaryResponse, len(dbScenes))
	for i, s := range dbScenes {
		uuidStr, _ := s.ID.Value()

		var createdAtTime time.Time
		if s.CreatedAt.Valid {
			createdAtTime = s.CreatedAt.Time
		}

		scenes[i] = SceneSummaryResponse{
			ID:           fmt.Sprintf("%v", uuidStr),
			Name:         s.Name,
			Descriptions: s.Descriptions.String,
			CreatedAt:    createdAtTime,
		}
	}

	response := map[string]interface{}{
		"type":   "SCENE_LIST",
		"scenes": scenes,
	}
	bytes, _ := json.Marshal(response)
	c.Send <- bytes
}

func handleLoadScene(c *Client, sceneIDStr string) {
	var sceneID pgtype.UUID
	if err := sceneID.Scan(sceneIDStr); err != nil {
		c.SendError("Invalid scene ID format")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	dbBodies, err := c.DbQueries.GetSceneBodiesBySceneId(ctx, sceneID)
	if err != nil {
		log.Printf("❌ Failed to load bodies for scene %s: %v", sceneIDStr, err)
		c.SendError("Failed to load scene bodies")
		return
	}

	// map database rows back into DraftBody format
	bodies := make([]DraftBody, len(dbBodies))
	for i, b := range dbBodies {
		bodies[i] = DraftBody{
			ID:     int(b.BodyID),
			Mass:   b.Mass,
			Radius: b.Radius,
			X:      b.X,
			Y:      b.Y,
			Vx:     b.Vx,
			Vy:     b.Vy,
			Alive:  true,
		}
	}

	response := map[string]interface{}{
		"type": "LOADED_SCENE",
		"scene": map[string]interface{}{
			"id":     sceneIDStr,
			"bodies": bodies,
		},
	}
	bytes, _ := json.Marshal(response)
	c.Send <- bytes
	log.Printf("📂 Scene %s successfully loaded and sent to client", sceneIDStr)
}

func handleDeleteScene(c *Client, sceneIDStr string) {
	if !c.UserID.Valid {
		c.SendError("Unauthorized: must be logged in to delete scenes")
		return
	}

	var sceneID pgtype.UUID
	if err := sceneID.Scan(sceneIDStr); err != nil {
		c.SendError("Invalid scene ID format for deletion")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	err := c.DbQueries.DeleteScene(ctx, sceneID)
	if err != nil {
		log.Printf("❌ Failed to delete scene %s: %v", sceneIDStr, err)
		c.SendError("Failed to delete scene from database")
		return
	}

	log.Printf("🗑️ Scene %s successfully deleted by user %s", sceneIDStr, c.UserID.String())

	handleListScenes(c)
}

func handleUpdateScene(c *Client, sceneIDStr string, name string, descriptions string) {
	var sceneUUID pgtype.UUID
	if err := sceneUUID.Scan(sceneIDStr); err != nil {
		log.Printf("❌ Invalid scene UUID format for update: %v", err)
		return
	}

	descText := pgtype.Text{String: descriptions, Valid: descriptions != ""}

	err := c.DbQueries.UpdateSceneMetadata(context.Background(), db.UpdateSceneMetadataParams{
		Name:         name,
		Descriptions: descText,
		ID:           sceneUUID,
		UserID:       c.UserID,
	})

	if err != nil {
		log.Printf("❌ Failed to update scene metadata: %v", err)
		return
	}

	log.Printf("✅ Scene %s successfully updated by user %s", sceneIDStr, c.UserID)
	log.Printf("Description is: %v", descText)

	// refresh scene list after updating scene description/metadata
	handleListScenes(c)
}

func handleFetchHistory(c *Client) {
	if !c.isPaused {
		c.SendError("Must be PAUSED to fetch history")
		return
	}
	log.Println("🕒 Time-Travel Scrubber activated! Fetching historical RAM cache buffer...")
	historyFrames := c.simCache.GetHistory()
	log.Printf("📺 Preparing %d cached frames to send to frontend slider memory", len(historyFrames))

	// Convert each protobuf frame to a JSON-friendly object via protojson
	converted := make([]interface{}, 0, len(historyFrames))
	for _, f := range historyFrames {
		// ensure nil-safety
		if f == nil {
			continue
		}
		b, err := protojson.Marshal(f)
		if err != nil {
			log.Printf("⚠️ Failed to protojson-encode history frame: %v", err)
			continue
		}
		var obj interface{}
		if err := json.Unmarshal(b, &obj); err != nil {
			log.Printf("⚠️ Failed to convert protojson bytes into object: %v", err)
			continue
		}
		converted = append(converted, obj)
	}

	historyEnvelope := struct {
		Type   string        `json:"type"`
		Frames []interface{} `json:"frames"`
	}{
		Type:   "HISTORY",
		Frames: converted,
	}

	jsonBytes, err := json.Marshal(historyEnvelope)
	if err != nil {
		log.Printf("❌ Error marshaling history memory buffer: %v", err)
	}

	c.Send <- jsonBytes // push the marshaled payload into client's write channel
}

func handleSpeed(c *Client, multiplier float64) {
	log.Printf("💨 SET_SPEED command processed. Multiplier: %.3fx", multiplier)

	// non-blocking send to hub channel
	select {
	case c.Hub.SpeedUpdates <- multiplier:
		log.Printf("enqueued speed update %.3f", multiplier)
	default:
		log.Printf("⚠️ speed update dropped (hub busy): %.3f", multiplier)
	}
}

// ReadPump loops constantly to catch incoming command strings from the HTML5 control buttons
func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error { c.Conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("❌ ReadPump connection error: %v", err)
			} else {
				log.Printf("ℹ️ ReadPump connection closed (Expected): %v", err)
			}
			break
		}

		var msg WSMessage

		// Handle user interactive command payloads from canvas dashboard UI
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("⚠️ Received non-JSON or malformed packet: %v", err)
			c.SendError("Invalid message format")
			continue
		}

		switch msg.Type {
		case "CONTROL":
			handleControl(c, msg.Command)
		case "UPLOAD_SCENE":
			log.Printf("Trying to hit the UPLOAD_SCENE (debugging)...")
			handleSceneUpload(c, msg.Scene)
		case "SAVE_SCENE":
			log.Printf("💾 Received SAVE_SCENE request from frontend...")
			handleSaveScene(c, msg.Scene, c.UserID, c.DbQueries)
		case "LIST_SCENES":
			log.Printf("💾 Received LIST_SCENES request from frontend...")
			handleListScenes(c)
		case "LOAD_SCENE":
			log.Printf("💾 Received LOAD_SCENE request from frontend...")
			handleLoadScene(c, msg.SceneID)
		case "DELETE_SCENE":
			handleDeleteScene(c, msg.SceneID)
		case "UPDATE_SCENE":
			handleUpdateScene(c, msg.SceneID, msg.Name, msg.Descriptions)
		case "FETCH_HISTORY":
			handleFetchHistory(c)
		case "SET_SPEED":
			handleSpeed(c, msg.Multiplier)
		default:
			log.Printf("⚠️ Unknown message type: %s", msg.Type)
			c.SendError("Unknown command type")
		}
	}
}

// WritePump continuously drains the client's internal send channel and pumps the bytes to Chrome
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if c.isPaused {
				// allow HISTORY, LOADED_SCENE, and SCENE_LIST envelopes while paused
				if !bytes.Contains(message, []byte("\"HISTORY\"")) &&
					!bytes.Contains(message, []byte("\"LOADED_SCENE\"")) &&
					!bytes.Contains(message, []byte("\"SCENE_LIST\"")) {
					continue
				}
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ServeWs upgrades the raw HTTP connection to a full bi-directional WebSocket client link
func ServeWs(hub *Hub, simCache *cache.SimulationCache, dbQueries *db.Queries, w http.ResponseWriter, r *http.Request) {
	// extract and validate the auth cookie
	cookie, err := r.Cookie("auth_token")
	if err != nil {
		log.Printf("❌ Cookie read error: %v", err)
	} else {
		log.Printf("🍪 Found cookie string: %s", cookie.Value)
	}
	var userID pgtype.UUID

	if err == nil && cookie != nil {
		claims := &auth.Claims{}
		token, parseErr := jwt.ParseWithClaims(cookie.Value, claims, func(token *jwt.Token) (interface{}, error) {
			return []byte("super_secret_cosmic_key_change_me_later"), nil
		})

		if parseErr == nil && token.Valid {
			if parseErr := userID.Scan(claims.UserID); parseErr != nil {
				log.Printf("⚠️ Failed to scan JWT UserID into pgtype.UUID: %v", parseErr)
			}
		} else {
			log.Printf("⚠️ Invalid or expired auth token in WebSocket connection: %v", parseErr)
		}
	} else {
		log.Printf("⚠️ No auth_token cookie found on WebSocket connection (guest mode)")
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("❌ Failed to execute WebSocket protocol upgrade: %v", err)
		return
	}

	client := &Client{
		Hub:       hub,
		Conn:      conn,
		Send:      make(chan []byte, 1024),
		simCache:  simCache,
		isPaused:  false,
		DbQueries: dbQueries,
		UserID:    userID,
	}

	client.Hub.Register <- client

	// Launch individual client execution run routines onto independent lightweight concurrent spaces
	go client.WritePump()
	go client.ReadPump()
}
