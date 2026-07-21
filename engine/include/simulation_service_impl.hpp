#include <mutex>
#include <vector>
#include <atomic>

#include "simulation.grpc.pb.h"
#include "body.hpp"
#include "globals.hpp"

class SimulationServiceImpl final : public astrophysics::SimulationService::Service {
public:
    grpc::Status UploadScene(grpc::ServerContext* context,
                            const astrophysics::UploadSceneRequest* request,
                            astrophysics::UploadSceneResponse* response) override {
        {
            std::lock_guard<std::mutex> lock(universe_mutex);
            universe.clear();

            for (const auto& body : request->bodies()) {
                Body new_body(
                    static_cast<int>(body.id()),
                    body.mass(),
                    body.x(),
                    body.y(),
                    body.vx(),
                    body.vy()
                );
                if (body.radius() > 0) {
                    new_body.radius = body.radius();
                }

                new_body.alive = body.alive();
                universe.push_back(new_body);
            }
        }

        {
            std::lock_guard<std::mutex> state_lock(state_mutex);
            scene_loaded.store(true);
            is_running.store(false);
        }
        state_cv.notify_all();

        response->set_success(true);
        response->set_message("Scene successfully uploaded!");
        return grpc::Status::OK;
    }
};