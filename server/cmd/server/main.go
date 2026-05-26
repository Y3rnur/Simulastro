package main

import (
	"fmt"
	"io"
	"log"
	"net"

	pb "github.com/yernur/astrophysics_simulation/server/proto"
	"google.golang.org/grpc"
)

// gRPC server interface
type simulationServer struct {
	pb.UnimplementedSimulationServiceServer
}

// StreamTelemetry implements the client-to-server streaming RPC method
func (s *simulationServer) StreamTelemetry(stream pb.SimulationService_StreamTelemetryServer) error {
	fmt.Println("\n Incoming telemetry stream initialized from C++ Engine...")

	var frameCount int

	for {
		// reading the frame from stream
		frame, err := stream.Recv()

		if err == io.EOF {
			fmt.Printf("\n🏁 C++ Engine finished streaming. Total frames processed: %d\n", frameCount)

			response := &pb.SimulationResponse{
				Success:    true,
				SimMessage: "Data bridge stable. All frames safely captured by Go Hub!",
			}

			// sending acknowledgement back to C++ and close the RPC call session
			return stream.SendAndClose(response)
		}

		if err != nil {
			log.Printf("❌ Critical error reading from telemetry stream: %v", err)
			return err
		}

		frameCount++

		// Unpacking and printing the frame meta-information
		fmt.Printf(" [Frame %d] Timestamp: %.3fs | Contains %d Celestial Bodies\n", frame.FrameNumber, frame.Timestamp, len(frame.Bodies))

		// Loop through the unpacked bodies to view the physical states in real time
		for _, body := range frame.Bodies {
			fmt.Printf(" Body ID %d: Mass=%1.e | Pos=(%6.1f, %6.1f) | Vel=(%5.1f, %5.1f)\n",
				body.Id, body.Mass, body.X, body.Y, body.Vx, body.Vy)
		}
	}
}

func main() {
	fmt.Println("Initializing Go Command Server...")

	// Local port where C++ engine will connect
	port := ":50051"

	// TCP work listener
	listener, err := net.Listen("tcp", port)
	if err != nil {
		log.Fatalf("❌ Failed to bind to port %s: %v", port, err)
	}

	grpcServer := grpc.NewServer()

	simServer := &simulationServer{}

	pb.RegisterSimulationServiceServer(grpcServer, simServer)

	fmt.Printf("gRPC Engine Hub listening on port %s...\n", port)

	if err := grpcServer.Serve(listener); err != nil {
		log.Fatalf("❌ Failed to activate gRPC engine processing loop: %v", err)
	}
}
