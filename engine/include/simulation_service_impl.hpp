#ifndef SIMULATION_SERVICE_IMPL_HPP
#define SIMULATION_SERVICE_IMPL_HPP

#include <grpcpp/grpcpp.h>
#include "simulation.grpc.pb.h"
#include "simulation_manager.hpp"
#include <thread>
#include <chrono>

class SimulationServiceImpl final : public astrophysics::SimulationService::Service {
private:
    std::shared_ptr<SimulationManager> m_manager;

public:
    explicit SimulationServiceImpl(std::shared_ptr<SimulationManager> manager) : m_manager(manager) {}

    // Upload or reset bodies for a specific session
    grpc::Status UploadScene(grpc::ServerContext* context,
                            const astrophysics::UploadSceneRequest* request,
                            astrophysics::UploadSceneResponse* response) override {
        std::string session_id = request->session_id();
        if (session_id.empty()) {
            response->set_success(false);
            response->set_message("Error: session_id is missing in UploadScene!");
            return grpc::Status::OK;
        }

        // Get the instance for this session and delegate the scene loading to it
        auto instance = m_manager->getOrCreateInstance(session_id);
        instance->uploadScene(*request);

        response->set_success(true);
        response->set_message("Scene successfully uploaded for session: " + session_id);
        std::cerr << "[SimulationServiceImpl] Scene uploaded for session=" << session_id << "\n";
        return grpc::Status::OK;
    }

    // Stream telemetry frames back to the caller for a specific session
    grpc::Status StreamTelemetry(grpc::ServerContext* context,
                                grpc::ServerReader<astrophysics::TelemetryFrame>* reader,
                                astrophysics::SimulationResponse* response) override {
        astrophysics::TelemetryFrame frame;
        std::string active_session_id;

        while (reader->Read(&frame)) {
            if (active_session_id.empty() && !frame.session_id().empty()) {
                active_session_id = frame.session_id();
            }
        }

        response->set_success(true);
        response->set_sim_message("Telemetry stream closed");
        return grpc::Status::OK;
    }
};

#endif