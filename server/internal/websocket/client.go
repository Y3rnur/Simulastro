package websocket

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/yernur/astrophysics_simulation/server/internal/cache"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	writeWait      = 10 * time.Second    // Time allowed to write a message to the peer.
	pongWait       = 60 * time.Second    // Time allowed to read the next pong message from the peer.
	pingPeriod     = (pongWait * 9) / 10 // Send pings to peer with this period. Must be less than pongWait.
	maxMessageSize = 512                 // Maximum message size allowed from peer.
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allowing all origins for local cross-origin canvas visualization convenience
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Client represents the intermediary link between the frontend canvas and the server Hub
type Client struct {
	Hub      *Hub
	Conn     *websocket.Conn
	Send     chan []byte
	simCache *cache.SimulationCache // reference to history cache for time-travel queries
	isPaused bool                   // state valve for streaming gating
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
			}
			break
		}

		// Handle user interactive command payloads from canvas dashboard UI
		command := string(message)
		log.Printf("🎛️ Command received from client interface: %s", command)

		switch command {
		case "PAUSE":
			c.isPaused = true
			log.Println("⏸️ UI initiated Pause State. Holding live stream frames.")
		case "PLAY":
			c.isPaused = false
			log.Println("▶️ UI initiated Play State. Resuming live frame rendering coordinates.")
		case "FETCH_HISTORY":
			if !c.isPaused {
				log.Println("⚠️ FETCH_HISTORY ignored: client must be in PAUSE state before requesting history")
				continue
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
				continue
			}

			c.Send <- jsonBytes // push the marshaled payload into client's write channel
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
				// still allow HISTORY envelopes while paused so the client can fetch and
				// replay cached frames — detect HISTORY by a simple substring check
				if !bytes.Contains(message, []byte("\"HISTORY\"")) {
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
func ServeWs(hub *Hub, simCache *cache.SimulationCache, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("❌ Failed to execute WebSocket protocol upgrade: %v", err)
		return
	}

	client := &Client{Hub: hub, Conn: conn, Send: make(chan []byte, 256), simCache: simCache, isPaused: false}
	client.Hub.Register <- client

	// Launch individual client execution run routines onto independent lightweight concurrent spaces
	go client.WritePump()
	go client.ReadPump()
}
