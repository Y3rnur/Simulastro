package main

import (
	"fmt"
	"io"
	"log"
	"net"
	"time"

	"github.com/yernur/astrophysics_simulation/server/internal/cache"
	pb "github.com/yernur/astrophysics_simulation/server/proto"
	"google.golang.org/grpc"
)

// gRPC server interface (also maintains reference to concurrent-safe cache instance)
type simulationServer struct {
	pb.UnimplementedSimulationServiceServer
	simCache *cache.SimulationCache
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

		s.simCache.Push(frame)

		fmt.Printf("📦 [Cached Frame %d] Timestamp: %.3fs | Contains %d Celestial Bodies\n", frame.FrameNumber, frame.Timestamp, len(frame.Bodies))
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

	maxHistorySlots := 20000
	globalCache := cache.NewSimulationCache(maxHistorySlots)
	fmt.Printf("Pre-allocated %d structural history frames in local system memory.\n", maxHistorySlots)

	// Local port where C++ engine will connect
	port := ":50051"

	// TCP work listener
	listener, err := net.Listen("tcp", port)
	if err != nil {
		log.Fatalf("❌ Failed to bind to port %s: %v", port, err)
	}

	grpcServer := grpc.NewServer()

	simServer := &simulationServer{
		simCache: globalCache, // hooking cache to the network receiver
	}

	pb.RegisterSimulationServiceServer(grpcServer, simServer)

	fmt.Printf("gRPC Engine Hub listening on port %s...\n", port)

	if err := grpcServer.Serve(listener); err != nil {
		log.Fatalf("❌ Failed to activate gRPC engine processing loop: %v", err)
	}
}
