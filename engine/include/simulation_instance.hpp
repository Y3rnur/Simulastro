#ifndef SIMULATION_INSTANCE_HPP
#define SIMULATION_INSTANCE_HPP

#include <vector>
#include <mutex>
#include <atomic>
#include <cmath>
#include <algorithm>
#include <iostream>
#include "body.hpp"
#include "simulation.grpc.pb.h"

const double G = 6.67430e-11;   // Gravitational Constant

// Structure to hold derivatives: change in position (dx, dy) and change in velocity (dvx, dvy)
struct Derivative {
    double dx, dy;
    double dvx, dvy;
};

class SimulationInstance {
private:
    std::mutex m_mutex;
    std::vector<Body> m_bodies;
    
    bool m_scene_loaded = false;
    bool m_is_running = false;
    double m_speed_multiplier = 1.0;

    double m_current_time = 0.0;
    double m_frame = 0.0;
    double m_step_accumulator = 0.0;
    const int MAX_SUBSTEPS = 100;

    // Derivative function: returns velocity and acceleration (force/mass)
    Derivative calculate_derivative(const State& s, double mass, const std::vector<Body>& all_bodies, int my_id) {
        double ax = 0, ay = 0;

        for (const auto& other : all_bodies) {
            if (other.id == my_id || !other.alive) continue;

            double dx = other.state.x - s.x;
            double dy = other.state.y - s.y;
            double dist_sq = dx * dx + dy * dy + 1e-4;   // +1e-4 to avoid division by zero
            double dist = std::sqrt(dist_sq);
            // double force = (G * mass * other.mass) / dist_sq; <- FORCE, if expressed fully by formula F = G*m1*m2 / r^2

            double accel = (G * other.mass) / dist_sq;

            ax += accel * (dx / dist);
            ay += accel * (dy / dist);
        }

        return Derivative{s.vx, s.vy, ax, ay};    // Returns {dx/dt, dy/dt, dvx/dt, dvy/dt}
    }

    // Perform a single Runge-Kutta 4th Order step for the entire universe
    void rk4_step(double dt) {
        int n = m_bodies.size();
        if (n == 0) return;

        // Calculate k1 (at current position) for everyone
        std::vector<Derivative> k1(n);
        for (int i = 0; i < n; ++i) {
            if (!m_bodies[i].alive) {
                k1[i] = Derivative{0.0, 0.0, 0.0, 0.0};
            } else {
                k1[i] = calculate_derivative(m_bodies[i].state, m_bodies[i].mass, m_bodies, m_bodies[i].id);
            }
        }

        // Creating temporary universe shifted halfway using k1
        std::vector<Body> universe_k2 = m_bodies;
        for (int i = 0; i < n; ++i) {
            universe_k2[i].state.x += k1[i].dx * dt * 0.5;
            universe_k2[i].state.y += k1[i].dy * dt * 0.5;
            universe_k2[i].state.vx += k1[i].dvx * dt * 0.5;
            universe_k2[i].state.vy += k1[i].dvy * dt * 0.5;
        }

        // Calculate k2 (with shifted universe) for everyone
        std::vector<Derivative> k2(n);
        for (int i = 0; i < n; ++i) {
            if (!m_bodies[i].alive) {
                k2[i] = Derivative{0.0, 0.0, 0.0, 0.0};
            } else {
                k2[i] = calculate_derivative(universe_k2[i].state, universe_k2[i].mass, universe_k2, universe_k2[i].id);
            }
        }

        // Creating temporary universe shifted halfway using k2
        std::vector<Body> universe_k3 = m_bodies;
        for (int i = 0; i < n; ++i) {
            universe_k3[i].state.x += k2[i].dx * dt * 0.5;
            universe_k3[i].state.y += k2[i].dy * dt * 0.5;
            universe_k3[i].state.vx += k2[i].dvx * dt * 0.5;
            universe_k3[i].state.vy += k2[i].dvy * dt * 0.5;
        }

        // Calculate k3 (with shifted universe) for everyone
        std::vector<Derivative> k3(n);
        for (int i = 0; i < n; ++i) {
            if (!m_bodies[i].alive) {
                k3[i] = Derivative{0.0, 0.0, 0.0, 0.0};
            } else {
                k3[i] = calculate_derivative(universe_k3[i].state, universe_k3[i].mass, universe_k3, universe_k3[i].id);
            }
        }

        // Creating temporary universe shifted a full step using k3
        std::vector<Body> universe_k4 = m_bodies;
        for (int i = 0; i < n; ++i) {
            universe_k4[i].state.x += k3[i].dx * dt;
            universe_k4[i].state.y += k3[i].dy * dt;
            universe_k4[i].state.vx += k3[i].dvx * dt;
            universe_k4[i].state.vy += k3[i].dvy * dt;
        }

        // Calculate k4 (with shifted universe) for everyone
        std::vector<Derivative> k4(n);
        for (int i = 0; i < n; ++i) {
            if (!m_bodies[i].alive) {
                k4[i] = Derivative{0.0, 0.0, 0.0, 0.0};
            } else {
                k4[i] = calculate_derivative(universe_k4[i].state, universe_k4[i].mass, universe_k4, universe_k4[i].id);
            }
        }

        // Updating the real universe states using the weighted average
        for (int i = 0; i < n; ++i) {
            if (!m_bodies[i].alive) {
                m_bodies[i].state.vx = 0.0;
                m_bodies[i].state.vy = 0.0;
                continue;
            }

            m_bodies[i].state.x += (dt / 6.0) * (k1[i].dx + 2.0 * k2[i].dx + 2.0 * k3[i].dx + k4[i].dx);
            m_bodies[i].state.y += (dt / 6.0) * (k1[i].dy + 2.0 * k2[i].dy + 2.0 * k3[i].dy + k4[i].dy);
            m_bodies[i].state.vx += (dt / 6.0) * (k1[i].dvx + 2.0 * k2[i].dvx + 2.0 * k3[i].dvx + k4[i].dvx);
            m_bodies[i].state.vy += (dt / 6.0) * (k1[i].dvy + 2.0 * k2[i].dvy + 2.0 * k3[i].dvy + k4[i].dvy);
        }
    }

    // squared distance helper
    inline double dist2(const State& a, const State& b) {
        double dx = a.x - b.x;
        double dy = a.y - b.y;
        return dx * dx + dy * dy;
    }

    // Absorb & Merge (inelastic coalescence logic)
    void resolve_collisions() {
        const int n = m_bodies.size();
        // pairwise check (O(n^2))
        for (int i = 0; i < n; ++i) {
            if (!m_bodies[i].alive) continue;
            for (int j = i + 1; j < n; ++j) {
                if (!m_bodies[j].alive) continue;

                double rsum = m_bodies[i].radius + m_bodies[j].radius;
                double rsum2 = rsum * rsum;
                double d2 = dist2(m_bodies[i].state, m_bodies[j].state);
                if (d2 <= rsum2) {
                    // choose heavier as absorber
                    Body *a = &m_bodies[i];
                    Body *b = &m_bodies[j];
                    if (b->mass > a->mass) std::swap(a, b);

                    // linear momentum conservation (inelastic merge)
                    double vx_final = (a->mass * a->state.vx + b->mass * b->state.vx) / (a->mass + b->mass);
                    double vy_final = (a->mass * a->state.vy + b->mass * b->state.vy) / (a->mass + b->mass);

                    a->state.vx = vx_final;
                    a->state.vy = vy_final;
                    a->mass = a->mass + b->mass;
                    // Update absorber radius from mass
                    a->radius = Body::radiusFromMass(a->mass);

                    // Mark victim dead (will be skipped when sending telemetry)
                    b->alive = false;
                    std::cerr << "[collision] absorber=" << a->id << " new_mass=" << a->mass << " new_radius=" << a->radius << "\n";
                }
            }
        }
    }

public:
    SimulationInstance() = default;

    // Load or replace bodies from an incoming scene request
    void uploadScene(const astrophysics::UploadSceneRequest& request) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_bodies.clear();
        for (const auto& body : request.bodies()) {
            Body new_body(
                static_cast<int>(body.id()),
                body.mass(),
                body.x(),
                body.y(),
                body.vx(),
                body.vy()
            );
            if (body.radius() > 0) new_body.radius = body.radius();
            new_body.alive = body.alive();
            m_bodies.push_back(new_body);
        }
        m_scene_loaded = false;
        m_is_running = false;
        m_current_time = 0.0;
        m_frame = 0;
        m_step_accumulator = 0.0;
    }

    // Control playback state (Play / Pause)
    void setRunning(bool running) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_is_running = running;
    }

    bool isRunning() {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_is_running;
    }

    bool isSceneLoaded() {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_scene_loaded;
    }

    void setSpeedMultiplier(double mult) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_speed_multiplier = std::max(0.0, mult);
    }

    // Perform a single simulation if tick running
    void tick() {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (!m_scene_loaded || !m_is_running) return;

        m_step_accumulator += m_speed_multiplier;
        int steps = static_cast<int>(std::floor(m_step_accumulator));
        if (steps > MAX_SUBSTEPS) steps = MAX_SUBSTEPS;

        double dt = 1.0;
        for (int s = 0; s < steps; ++s) {
            rk4_step(dt);
            resolve_collisions();
            m_current_time += dt;
        }
        m_step_accumulator -= steps;
        m_frame++;
    }

    // Populate a Protobuf TelemetryFrame with current instance state
    void populateTelemetry(astrophysics::TelemetryFrame& frame_msg) {
        std::lock_guard<std::mutex> lock(m_mutex);
        frame_msg.set_frame_number(m_frame);
        frame_msg.set_timestamp(m_current_time);
        frame_msg.clear_bodies();

        for (const auto& body : m_bodies) {
            auto* state_msg = frame_msg.add_bodies();
            state_msg->set_id(body.id);
            state_msg->set_mass(body.mass);
            state_msg->set_x(body.state.x);
            state_msg->set_y(body.state.y);
            state_msg->set_vx(body.state.vx);
            state_msg->set_vy(body.state.vy);
            state_msg->set_radius(body.radius);
            state_msg->set_alive(body.alive);
        }
    }
};

#endif