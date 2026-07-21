#ifndef CONTROL_SERVICE_IMPL_HPP
#define CONTROL_SERVICE_IMPL_HPP

#include "simulation.grpc.pb.h"
#include "globals.hpp"

class ControlServiceImpl final : public astrophysics::ControlService::Service {
public:
    grpc::Status Control(grpc::ServerContext*,
                        const astrophysics::ControlRequest* request,
                        astrophysics::ControlResponse* response) override {
        {
            std::lock_guard<std::mutex> lock(state_mutex);
            switch (request->command()) {
                case astrophysics::ControlRequest::PLAY:
                    is_running.store(true);
                    response->set_message("Running");
                    break;
                case astrophysics::ControlRequest::PAUSE:
                    is_running.store(false);
                    response->set_message("Paused");
                    break;
                default:
                    response->set_message("Unknown control command");
                    response->set_success(false);
                    return grpc::Status::OK;
            }
        }

        response->set_success(true);
        state_cv.notify_all();
        return grpc::Status::OK;
    }
};

#endif