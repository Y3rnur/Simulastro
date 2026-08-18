#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <chrono>
#include <atomic>
#include <grpcpp/grpcpp.h>

#include "simulation_manager.hpp"
#include "control_service_impl.hpp"
#include "simulation_service_impl.hpp"
#include "simulation.grpc.pb.h"
#include "telemetry_broadcaster.hpp"

void RunServer() {
    std::string server_address("0.0.0.0:50052");

    // create a central manager for all active simulation sessions
    auto simulation_manager = std::make_shared<SimulationManager>();

    // instantiate gRPC services (injecting manager into them)
    SimulationServiceImpl simulation_service(simulation_manager);
    ControlServiceImpl control_service(simulation_manager);
    SpeedServiceImpl speed_service(simulation_manager);

    grpc::ServerBuilder builder;
    builder.AddListeningPort(server_address, grpc::InsecureServerCredentials());

    // register all services with builder
    builder.RegisterService(&simulation_service);
    builder.RegisterService(&control_service);
    builder.RegisterService(&speed_service);

    // build and start gRPC server
    std::unique_ptr<grpc::Server> server(builder.BuildAndStart());
    std::cout << "[C++ Engine] Server listening on " << server_address << "\n";
    
    // instantiate telemetry broadcaster pointing to the Go backend
    TelemetryBroadcaster broadcaster("localhost:50051");

    std::atomic<bool> engine_running(true);

    // background worker thread for physics ticks
    std::thread physics_worker([simulation_manager, &engine_running]() {
        const auto target_frame_duration = std::chrono::milliseconds(16);   // 60 FPS tick rate

        while (engine_running) {
            auto start_time = std::chrono::steady_clock::now();

            simulation_manager->tickAllActiveInstances(0.016);  // delta time 16ms

            auto elapsed = std::chrono::steady_clock::now() - start_time;
            if (elapsed < target_frame_duration) {
                std::this_thread::sleep_for(target_frame_duration - elapsed);
            }
        }
    });

    // background worker thread for streaming telemetry back to Go
    std::thread telemetry_worker([&broadcaster, simulation_manager, &engine_running](){
        broadcaster.StartStreaming(simulation_manager, engine_running);
    });

    server->Wait();
}

int main(int argc, char** argv)  {
    std::cout << "[C++ Engine] Starting Astrophysics Simulation Engine...\n";
    RunServer();
    return 0;
}