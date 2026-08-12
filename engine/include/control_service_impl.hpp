#ifndef CONTROL_SERVICE_IMPL_HPP
#define CONTROL_SERVICE_IMPL_HPP

#include "simulation.grpc.pb.h"
#include "simulation_manager.hpp"

class ControlServiceImpl final : public astrophysics::ControlService::Service {
private:
    std::shared_ptr<SimulationManager> m_manager;

public:
    explicit ControlServiceImpl(std::shared_ptr<SimulationManager> manager) : m_manager(manager) {}

    grpc::Status Control(grpc::ServerContext*,
                        const astrophysics::ControlRequest* request,
                        astrophysics::ControlResponse* response) override {
        std::string session_id = request->session_id();
        if (session_id.empty()) {
            response->set_success(false);
            response->set_message("Error: session_id is missing!");
            return grpc::Status::OK;
        }

        auto instance = m_manager->getOrCreateInstance(session_id);

        switch (request->command()) {
            case astrophysics::ControlRequest::PLAY:
                instance->setRunning(true);
                response->set_message("Running session: " + session_id);
                break;
            case astrophysics::ControlRequest::PAUSE:
                instance->setRunning(false);
                response->set_message("Paused session: " + session_id);
                break;
            default:
                response->set_message("Unknown control command");
                response->set_success(false);
                return grpc::Status::OK;
        }

        response->set_success(true);
        return grpc::Status::OK;
    }
};

class SpeedServiceImpl final : public astrophysics::SpeedService::Service {
private:
    std::shared_ptr<SimulationManager> m_manager;

public:
    explicit SpeedServiceImpl(std::shared_ptr<SimulationManager> manager) : m_manager(manager) {}

    grpc::Status UpdateSpeed(grpc::ServerContext*,
                            const astrophysics::SpeedRequest* request,
                            astrophysics::SpeedResponse* response) override {
        std::string session_id = request->session_id();
        if (session_id.empty()) {
            response->set_ok(false);
            response->set_message("Error: session_id is missing!");
            return grpc::Status::OK;
        }

        auto instance = m_manager->getOrCreateInstance(session_id);

        double v = request->multiplier();
        instance->setSpeedMultiplier(v);

        response->set_ok(true);
        response->set_message("Speed updated for session");
        return grpc::Status::OK;
    }
};

#endif