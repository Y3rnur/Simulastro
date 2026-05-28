package websocket

import (
	"encoding/json"
	"log"

	pb "github.com/yernur/astrophysics_simulation/server/proto"
)

// Hub maintains the set of active clients and broadcasts messages to them
type Hub struct {
	clients    map[*Client]bool        // Registered active browser connections
	Broadcast  chan *pb.TelemetryFrame // Inbound frames from the gRPC stream loop
	Register   chan *Client            // Registration requests from the new browser tabs
	Unregister chan *Client            // Unregistration requests when tabs close
}

// NewHub initializes our centralized communication matrix
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		Broadcast:  make(chan *pb.TelemetryFrame, 100), // Buffered to handle traffic bursts
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	log.Println("🌐 Central WebSocket Hub event-loop broker fully activated...")
	for {
		select {
		case client := <-h.Register:
			h.clients[client] = true
			log.Printf("🔌 New browser client connected. Active dashboard tabs: %d", len(h.clients))

		case client := <-h.Unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.Send)
				log.Printf("❌ Browser client disconnected. Remaining active tabs: %d", len(h.clients))
			}

		case frame := <-h.Broadcast:
			// Marshal our Protobuf TelemetryFrame directly into optimized JSON payloads for the browser
			payload, err := json.Marshal(frame)
			if err != nil {
				log.Printf("⚠️ Failed to marshal telemetry frame to JSON: %v", err)
				continue
			}

			// Distribute the payload out to every single connected browser tab simultaneously
			for client := range h.clients {
				select {
				case client.Send <- payload:
				default:
					// if a client's individual buffer channel is choked, close it down to save server health
					close(client.Send)
					delete(h.clients, client)
				}
			}
		}
	}
}
