#include <iostream>
#include <vector>
#include <cmath>
#include <chrono>
#include <thread>

#include "../include/body.hpp"
#include "simulation.pb.h"
#include <grpcpp/grpcpp.h>
#include "simulation.grpc.pb.h"

const double G = 6.67430e-11;   // Gravitational Constant

// Structure to hold derivatives: change in position (dx, dy) and change in velocity (dvx, dvy)
struct Derivative {
    double dx, dy;
    double dvx, dvy;
};

// Derivative function: returns velocity and acceleration (force/mass)
Derivative calculate_derivative(const State& s, double mass, const std::vector<Body>& all_bodies, int my_id) {
    double ax = 0, ay = 0;

    for (const auto& other : all_bodies) {
        if (other.id == my_id) continue;

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
void rk4_step(std::vector<Body>& bodies, double dt) {
    int n = bodies.size();

    // Calculate k1 (at current position) for everyone
    std::vector<Derivative> k1(n);
    for (int i = 0; i < n; ++i) {
        k1[i] = calculate_derivative(bodies[i].state, bodies[i].mass, bodies, bodies[i].id);
    }

    // Creating temporary universe shifted halfway using k1
    std::vector<Body> universe_k2 = bodies;
    for (int i = 0; i < n; ++i) {
        universe_k2[i].state.x += k1[i].dx * dt * 0.5;
        universe_k2[i].state.y += k1[i].dy * dt * 0.5;
        universe_k2[i].state.vx += k1[i].dvx * dt * 0.5;
        universe_k2[i].state.vy += k1[i].dvy * dt * 0.5;
    }

    // Calculate k2 (with shifted universe) for everyone
    std::vector<Derivative> k2(n);
    for (int i = 0; i < n; ++i) {
        k2[i] = calculate_derivative(universe_k2[i].state, universe_k2[i].mass, universe_k2, universe_k2[i].id);
    }

    // Creating temporary universe shifted halfway using k2
    std::vector<Body> universe_k3 = bodies;
    for (int i = 0; i < n; ++i) {
        universe_k3[i].state.x += k2[i].dx * dt * 0.5;
        universe_k3[i].state.y += k2[i].dy * dt * 0.5;
        universe_k3[i].state.vx += k2[i].dvx * dt * 0.5;
        universe_k3[i].state.vy += k2[i].dvy * dt * 0.5;
    }

    // Calculate k3 (with shifted universe) for everyone
    std::vector<Derivative> k3(n);
    for (int i = 0; i < n; ++i) {
        k3[i] = calculate_derivative(universe_k3[i].state, universe_k3[i].mass, universe_k3, universe_k3[i].id);
    }

    // Creating temporary universe shifted a full step using k3
    std::vector<Body> universe_k4 = bodies;
    for (int i = 0; i < n; ++i) {
        universe_k4[i].state.x += k3[i].dx * dt;
        universe_k4[i].state.y += k3[i].dy * dt;
        universe_k4[i].state.vx += k3[i].dvx * dt;
        universe_k4[i].state.vy += k3[i].dvy * dt;
    }

    // Calculate k4 (with shifted universe) for everyone
    std::vector<Derivative> k4(n);
    for (int i = 0; i < n; ++i) {
        k4[i] = calculate_derivative(universe_k4[i].state, universe_k4[i].mass, universe_k4, universe_k4[i].id);
    }

    // Updating the real universe states using the weighted average
    for (int i = 0; i < n; ++i) {
        bodies[i].state.x += (dt / 6.0) * (k1[i].dx + 2.0 * k2[i].dx + 2.0 * k3[i].dx + k4[i].dx);
        bodies[i].state.y += (dt / 6.0) * (k1[i].dy + 2.0 * k2[i].dy + 2.0 * k3[i].dy + k4[i].dy);
        bodies[i].state.vx += (dt / 6.0) * (k1[i].dvx + 2.0 * k2[i].dvx + 2.0 * k3[i].dvx + k4[i].dvx);
        bodies[i].state.vy += (dt / 6.0) * (k1[i].dvy + 2.0 * k2[i].dvy + 2.0 * k3[i].dvy + k4[i].dvy);
    }
}

// squared distance helper
inline double dist2(const State& a, const State& b) {
    double dx = a.x - b.x;
    double dy = a.y - b.y;
    return dx * dx + dy * dy;
}

// Absorb & Merge (inelastic coalescence logic)
void resolve_collisions(std::vector<Body>& bodies) {
    const int n = bodies.size();
    // pairwise check (O(n^2))
    for (int i = 0; i < n; ++i) {
        if (!bodies[i].alive) continue;
        for (int j = i + 1; j < n; ++j) {
            if (!bodies[j].alive) continue;

            double rsum = bodies[i].radius + bodies[j].radius;
            double rsum2 = rsum * rsum;
            double d2 = dist2(bodies[i].state, bodies[j].state);
            if (d2 <= rsum2) {
                // choose heavier as absorber
                Body *a = &bodies[i];
                Body *b = &bodies[j];
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

int main() {
    std::cout << "Astrophysics Engine initialized with RK4..." << std::endl;

    // Example: Setting up a Binary system
    std::vector<Body> universe;

    /*  Head-on collision example
    double r0 = 3000.0;       // Initial distance
    double M = 5e11;          // Central mass
    double satellite_mass = 1e4;

    // Direct head-on collision: Vx is negative, pointing straight to origin
    double v_impact = -5.0;   // Moving fast straight toward the center star

    universe.push_back(Body(1, M, 0.0, 0.0, 0.0, 0.0, Body::radiusFromMass(M)));
    universe.push_back(Body(2, satellite_mass, r0, 0.0, v_impact, 0.0, Body::radiusFromMass(satellite_mass)));

    double dt = 5.0;          // A balanced 5-second step to watch the approach smoothly
    */

    /*  Orbit example
    double r0 = 3000.0;   // initial distance
    double M = 5e11;    // central mass
    double satellite_mass = 1e4;
    double v_escape = std::sqrt(2.0 * G * M / r0);
    double v_init = 0.707 * v_escape;

    universe.push_back(Body(1, M, 0.0, 0.0, 0.0, 0.0, Body::radiusFromMass(M)));
    universe.push_back(Body(2, satellite_mass, r0, 0.0, 0.0, v_init, Body::radiusFromMass(satellite_mass)));
    double dt = 500.0;    // Time step size
    */

      // Free fall example
    double r0 = 500.0;       // Placed reasonably close so it falls quickly
    double M = 5e11;          // Stable central mass
    double satellite_mass = 1e10; // Mega-satellite so it has a visible radius!

    // Let's drop it straight down from the top! 
    // x = 0, y = r0, vx = 0, vy = 0 -> Pure gravitational freefall
    universe.push_back(Body(1, M, 0.0, 0.0, 0.0, 0.0, Body::radiusFromMass(M)));
    universe.push_back(Body(2, satellite_mass, 0.0, r0, 0.0, 0.0, Body::radiusFromMass(satellite_mass)));

    double dt = 2.0;          // 2-second steps keep the RK4 math highly stable

    std::shared_ptr<grpc::Channel> channel = grpc::CreateChannel("localhost:50051", grpc::InsecureChannelCredentials());
    std::unique_ptr<astrophysics::SimulationService::Stub> stub = astrophysics::SimulationService::NewStub(channel);

    grpc::ClientContext context;
    astrophysics::SimulationResponse response;

    std::unique_ptr<grpc::ClientWriter<astrophysics::TelemetryFrame>> writer(stub->StreamTelemetry(&context, &response));

    int64_t frame = 0;
    double current_simulation_time = 0.0;

    // Simulating 5 steps and capturing Protobuf telemetry
    while (true) {
        rk4_step(universe, dt);

        // collision resolution
        resolve_collisions(universe);

        astrophysics::TelemetryFrame telemetry_frame;
        telemetry_frame.set_frame_number(frame);
        telemetry_frame.set_timestamp(current_simulation_time);

        for (const auto& body : universe) {
            astrophysics::BodyState* state_msg = telemetry_frame.add_bodies();
            state_msg->set_id(body.id);
            state_msg->set_mass(body.mass);
            state_msg->set_x(body.state.x);
            state_msg->set_y(body.state.y);
            state_msg->set_vx(body.state.vx);
            state_msg->set_vy(body.state.vy);
            state_msg->set_radius(body.radius);
            state_msg->set_alive(body.alive);
        }

        std::cout << "Frame: " << frame << " -> Packed: "
                    << telemetry_frame.bodies_size() << " bodies ("
                    << telemetry_frame.ByteSizeLong() << " bytes). Sending..." << std::endl;
        
        // Sending the packed frame across the socket pipe
        if (!writer->Write(telemetry_frame)) {
            std::cerr << "gRPC pipeline error" << std::endl;
            break;
        }

        frame++;
        current_simulation_time += dt;

        // rate throttle
        std::this_thread::sleep_for(std::chrono::milliseconds(16));
    }

    writer->WritesDone();
    grpc::Status status = writer->Finish();

    if (status.ok()) {
        std::cout << "Go Response: Success = " << (response.success() ? "TRUE" : "FALSE")
                    << " -> Message: " << response.sim_message() << std::endl;
    } else {
        std::cerr << "gRPC Connection Failure Code (" << status.error_code()
                    << "): " << status.error_message() << std::endl;
    }
    
    return 0;
}