#ifndef TELEMETRY_BROADCASTER_HPP
#define TELEMETRY_BROADCASTER_HPP

#include <grpcpp/grpcpp.h>
#include <memory>
#include <thread>

#include "simulation.grpc.pb.h"
#include "simulation_manager.hpp"

class TelemetryBroadcaster {
private:
    std::shared_ptr<grpc::Channel> channel_;
    std::unique_ptr<astrophysics::SimulationService::Stub> stub_;

public:
    TelemetryBroadcaster(const std::string& go_server_address) {
        channel_ = grpc::CreateChannel(go_server_address, grpc::InsecureChannelCredentials());
        stub_ = astrophysics::SimulationService::NewStub(channel_);
    }

    // background loop that continuously sweeps active sessions and streams telemetry
    void StartStreaming(std::shared_ptr<SimulationManager> manager, std::atomic<bool>& running) {
        grpc::ClientContext context;
        astrophysics::SimulationResponse response;

        auto writer = stub_->StreamTelemetry(&context, &response);
        if (!writer) {
            std::cerr << "[TelemetryBroadcaster] Failed to open telemetry stream to Go server!\n";
            return;
        }

        const auto target_frame_duration = std::chrono::milliseconds(16);   // 60 fps

        while (running) {
            auto start_time = std::chrono::steady_clock::now();

            auto instances = manager->getAllActiveInstancesSnapshot();

            for (const auto& [session_id, instance] : instances) {
                if (instance && instance->isRunning() && instance->isSceneLoaded()) {
                    astrophysics::TelemetryFrame frame_msg;

                    // inject the session id
                    frame_msg.set_session_id(session_id);

                    // populate body states
                    instance->populateTelemetry(frame_msg);

                    if (!writer->Write(frame_msg)) {
                        std::cerr << "[TelemetryBroadcaster] Stream broken for session: " << session_id << "\n";
                        break;
                    }
                }
            }

            // rate limiter to maintain steady 60 FPS telemetry dispatch
            auto elapsed = std::chrono::steady_clock::now() - start_time;
            if (elapsed < target_frame_duration) {
                std::this_thread::sleep_for(target_frame_duration - elapsed);
            }
        }

        writer->WritesDone();
        grpc::Status status = writer->Finish();
        if (!status.ok()) {
            std::cerr << "[TelemetryBroadcaster] Stream ended with error: " << status.error_message() << "\n";
        }
    }
};

#endif