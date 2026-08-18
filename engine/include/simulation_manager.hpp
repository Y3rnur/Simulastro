#ifndef SIMULATION_MANAGER_HPP
#define SIMULATION_MANAGER_HPP

#include <unordered_map>
#include <memory>
#include <shared_mutex>
#include <string>
#include "simulation_instance.hpp"

class SimulationManager {
private:
    mutable std::shared_mutex m_manager_mutex;
    std::unordered_map<std::string, std::shared_ptr<SimulationInstance>> m_instances;

public:
    SimulationManager() = default;

    // Get an existing instance or create a new one if it doesn't exist for this session_id
    std::shared_ptr<SimulationInstance> getOrCreateInstance(const std::string& session_id) {
        std::lock_guard<std::shared_mutex> lock(m_manager_mutex);
        auto it = m_instances.find(session_id);
        if (it != m_instances.end()) {
            return it->second;
        }

        // Create a new simulation instance for this session
        auto new_instance = std::make_shared<SimulationInstance>();
        m_instances[session_id] = new_instance;
        std::cout << "[SimulationManager] Created new simulation instance for session: " << session_id << "\n";
        return new_instance;
    }

    // Lookup an existing instance (returns nullptr if not found)
    std::shared_ptr<SimulationInstance> getInstance(const std::string& session_id) {
        std::lock_guard<std::shared_mutex> lock(m_manager_mutex);
        auto it = m_instances.find(session_id);
        if (it != m_instances.end()) {
            return it->second;
        }
        return nullptr;
    }

    // Explicitly destroy an instance (e.g., on explicit logout or cleanup timeout)
    void destroyInstance(const std::string& session_id) {
        std::lock_guard<std::shared_mutex> lock(m_manager_mutex);
        auto it = m_instances.find(session_id);
        if (it != m_instances.end()) {
            m_instances.erase(it);
            std::cout << "[SimulationManager] Destroyed simulation instance for session: " << session_id << "\n";
        }
    }

    // Ticks all active/running instances concurrently in the background loop
    void tickAllActiveInstances(double dt) {
        std::shared_lock<std::shared_mutex> lock(m_manager_mutex);
        for (auto& [session_id, instance] : m_instances) {
            // Only tick if the simulation is currently playing
            if (instance && instance->isRunning()) {
                instance->tick();
            }
        }
    }

    std::unordered_map<std::string, std::shared_ptr<SimulationInstance>> getAllActiveInstancesSnapshot() {
        std::shared_lock<std::shared_mutex> lock(m_manager_mutex);
        return m_instances;
    }
};

#endif