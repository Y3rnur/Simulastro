package main

import (
	"fmt"
	"log"
	"net"

	pb "github.com/yernur/astrophysics_simulation/server/proto"
	"google.golang.org/grpc"
)

// gRPC server interface
type simulationServer struct {
	pb.UnimplementedSimulationServiceServer
}

func main() {
	fmt.Println("Initializing Go Command Server...")

	// Local port where C++ engine will connect
	port := ":50051"

	// TCP work listener
	listener, err := net.Listen("tcp", port)
	if err != nil {
		log.Fatalf("Failed to bind to port %s: %v", port, err)
	}

	grpcServer := grpc.NewServer()

	simServer := &simulationServer{}

	pb.RegisterSimulationServiceServer(grpcServer, simServer)

	fmt.Printf("gRPC Engine Hub listening on port %s...\n", port)

	if err := grpcServer.Serve(listener); err != nil {
		log.Fatalf("Failed to activate gRPC engine processing loop: %v", err)
	}
}
