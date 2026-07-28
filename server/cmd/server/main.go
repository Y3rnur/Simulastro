package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/yernur/astrophysics_simulation/server/internal/auth"
	"github.com/yernur/astrophysics_simulation/server/internal/cache"
	dbqueries "github.com/yernur/astrophysics_simulation/server/internal/db"
	"github.com/yernur/astrophysics_simulation/server/internal/websocket"
	pb "github.com/yernur/astrophysics_simulation/server/proto"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// gRPC server interface (also maintains reference to concurrent-safe cache instance and active WebSocket broadcast hub)
type simulationServer struct {
	pb.UnimplementedSimulationServiceServer
	pb.UnimplementedSpeedServiceServer

	simCache *cache.SimulationCache
	wsHub    *websocket.Hub

	speedMutex      sync.RWMutex
	speedMultiplier float64
}

func (s *simulationServer) UpdateSpeed(ctx context.Context, req *pb.SpeedRequest) (*pb.SpeedResponse, error) {
	s.speedMutex.Lock()
	defer s.speedMutex.Unlock()

	s.speedMultiplier = req.Multiplier
	log.Printf("Server speed state updated via gRPC to: %.1fx", s.speedMultiplier)

	return &pb.SpeedResponse{Ok: true}, nil
}

// StreamTelemetry implements the client-to-server streaming RPC method
func (s *simulationServer) StreamTelemetry(stream pb.SimulationService_StreamTelemetryServer) error {
	fmt.Println("\n Incoming telemetry stream initialized from C++ Engine...")

	for {
		// reading the frame from stream
		frame, err := stream.Recv()

		if err == io.EOF {
			total, currentIdx := s.simCache.GetStats()
			fmt.Printf("\n🏁 C++ Engine finished streaming!\n")
			fmt.Printf("📊 Server Cache Stats -> Total Frames Handled: %d | Current Ring Pointer Index: %d\n", total, currentIdx)

			response := &pb.SimulationResponse{
				Success:    true,
				SimMessage: "Data bridge stable. All frames safely captured by Go Hub Cache!",
			}

			// sending acknowledgement back to C++ and close the RPC call session
			return stream.SendAndClose(response)
		}

		if err != nil {
			log.Printf("❌ Critical error reading from telemetry stream: %v", err)
			return err
		}

		s.simCache.Push(frame) // save frame into circular cache

		s.wsHub.Broadcast <- frame // throw the frame into the Hub's broadcast channel

		fmt.Printf("📦 [Cached & Broadcasted Frame %d] Timestamp: %.3fs | Contains %d Celestial Bodies\n", frame.FrameNumber, frame.Timestamp, len(frame.Bodies))
	}
}

func TestingCache() { /* FOR TESTING THE CIRCULAR BUFFER OF TELEMETRY FRAMES */
	fmt.Println("Executing Simulation Cache...")

	simCache := cache.NewSimulationCache(5)

	fmt.Println("Simulating C++ streaming data burst...")
	for i := 1; i <= 7; i++ {
		mockFrame := &pb.TelemetryFrame{
			FrameNumber: int64(i),
			Timestamp:   float64(i) * 0.001,
			Bodies:      []*pb.BodyState{}, // empty for convenience
		}
		simCache.Push(mockFrame)

		total, nextIdx := simCache.GetStats()
		fmt.Printf("Pushed frame %d | Total Frames Processed: %d | Next Write Index Target: %d\n", i, total, nextIdx)
		time.Sleep(50 * time.Millisecond)
	}

	// Extract chronological history to prove time travel works and old frames are vaporized
	fmt.Println("Compiling Chronological History Timeline for the UI slider...")
	history := simCache.GetHistory()

	for idx, frame := range history {
		fmt.Printf("[History Position %d] -> Contains Frame Number: %d (Timestamp: %.3fs)\n", idx, frame.FrameNumber, frame.Timestamp)
	}
}

func main() {
	fmt.Println("Initializing Go Command Server...")

	// Database connection setup
	ctx := context.Background()
	dbConnString := "postgres://postgres:some_strong_password@localhost:5432/astrophysics_db?sslmode=disable"

	dbPool, err := pgxpool.New(ctx, dbConnString)
	if err != nil {
		log.Fatalf("❌ Unable to connect to database: %v", err)
	}
	defer dbPool.Close()

	if err := dbPool.Ping(ctx); err != nil {
		log.Fatalf("❌ Database ping failed: %v", err)
	}
	fmt.Println("📦 Successfully connected to PostgreSQL database pool!")

	// initialize sqlc queries wrapper
	dbQueries := dbqueries.New(dbPool)
	_ = dbQueries

	maxHistorySlots := 20000
	globalCache := cache.NewSimulationCache(maxHistorySlots)
	fmt.Printf("Pre-allocated %d structural history frames in local system memory.\n", maxHistorySlots)

	engineConn, err := grpc.DialContext(
		context.Background(),
		"localhost:50052",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		log.Fatalf("failed to connect to engine control: %v", err)
	}
	defer engineConn.Close()

	sceneClient := pb.NewSimulationServiceClient(engineConn)
	controlClient := pb.NewControlServiceClient(engineConn)
	speedClient := pb.NewSpeedServiceClient(engineConn)

	wsHub := websocket.NewHub(sceneClient, controlClient)
	go wsHub.Run()

	fs := http.FileServer(http.Dir("../../../web"))
	http.Handle("/", fs)

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		websocket.ServeWs(wsHub, globalCache, w, r)
	})

	authHandler := auth.NewAuthHandler(dbQueries)
	http.HandleFunc("/api/register", authHandler.HandleRegister)
	http.HandleFunc("/api/login", authHandler.HandleLogin)

	webPort := ":8080"
	go func() {
		fmt.Printf("🌐 WebSocket Server listening for browser connections on port %s/ws...\n", webPort)
		if err := http.ListenAndServe(webPort, nil); err != nil {
			log.Fatalf("❌ Failed to activate HTTP WebSocket server: %v", err)
		}
	}()

	// Local port where C++ engine will connect
	grpcPort := ":50051"
	listener, err := net.Listen("tcp", grpcPort)
	if err != nil {
		log.Fatalf("❌ Failed to bind to network port %s: %v", grpcPort, err)
	}

	grpcServer := grpc.NewServer()

	simServer := &simulationServer{
		simCache:        globalCache, // connect cache to the network receiver
		wsHub:           wsHub,       // connect hub instance to gRPC receiver
		speedMultiplier: 1.0,         // default 1.0x execution speed
	}

	pb.RegisterSimulationServiceServer(grpcServer, simServer)

	go func() {
		for v := range wsHub.SpeedUpdates {
			simServer.speedMutex.Lock()
			simServer.speedMultiplier = v
			simServer.speedMutex.Unlock()
			log.Printf("Updated server speedMultiplier -> %.3f", v)

			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			_, err := speedClient.UpdateSpeed(ctx, &pb.SpeedRequest{Multiplier: v})
			cancel()

			if err != nil {
				log.Printf("❌ Forward speed failed: %v", err)
			}
		}
	}()

	fmt.Printf("gRPC Engine Hub listening on port %s...\n", grpcPort)

	if err := grpcServer.Serve(listener); err != nil {
		log.Fatalf("❌ Failed to activate gRPC engine processing loop: %v", err)
	}
}
