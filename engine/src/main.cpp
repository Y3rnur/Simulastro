#include <iostream>
#include <vector>
#include <cmath>
#include "../include/body.hpp"

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
        double dist_sq = dx * dx + dy * dy + 1e9;   // +1e9 to avoid division by zero
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

int main() {
    std::cout << "Astrophysics Engine initialized with RK4..." << std::endl;

    // Example: Setting up a Binary system
    std::vector<Body> universe;
    universe.push_back(Body(1, 1000.0, 0.0, 0.0, 0.0, -0.1));   // star at center
    universe.push_back(Body(2, 1.0, 10.0, 0.0, 0.0, 10.0));     // planet orbiting

    double dt = 0.01;    // Time step size

    // Simulate 5 steps and print coordinates
    for (int frame = 0; frame < 5; ++frame) {
        rk4_step(universe, dt);
        std::cout << "Frame " << frame << " -> Planet X: " << universe[1].state.x
                    << ", Y: " << universe[1].state.y << std::endl;
    }
    
    return 0;
}