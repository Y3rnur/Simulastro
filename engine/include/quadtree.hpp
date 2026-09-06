#ifndef QUADTREE_HPP
#define QUADTREE_HPP

#include <vector>
#include <memory>
#include <cmath>
#include "body.hpp"

class QuadTreeNode {
public:
    // Bounding box center and dimensions
    double x, y;
    double width, height;

    // Center of mass and total mass
    double mass;
    double com_x, com_y;

    // Node state
    Body* body;     // pointer to body if this is a leaf node holding 1 body
    bool is_internal;

    // Quadtree children (0=NW, 1=NE, 2=SW, 3=SE)
    std::unique_ptr<QuadTreeNode> children[4];

    QuadTreeNode(double x, double y, double w, double h)
        : x(x), y(y), width(w), height(h),
        mass(0.0), com_x(0.0), com_y(0.0),
        body(nullptr), is_internal(false) {
        for (int i = 0; i < 4; ++i) {
            children[i] = nullptr;
        }
    }

    // check if a point (px, py) is within this node's bounding box
    bool contains(double px, double py) const {
        double half_w = width / 2.0;
        double half_h = height / 2.0;
        return (px >= x - half_w && px < x + half_w &&
                py >= y - half_h && py < y + half_h);
    }

    // determine which quadrant a point belongs to (0:NW, 1:NE, 2:SW, 3:SE)
    int getQuadrant(double px, double py) const {
        bool west = (px < x);
        bool north = (py < y);
        if (north) {
            return west ? 0 : 1;    // NW : NE
        } else {
            return west ? 2 : 3;    // SW : SE
        }
    }

    // subdivide this node into 4 smaller quadrants
    void subdivide() {
        double half_w = width / 2.0;
        double half_h = height / 2.0;
        double q_w = half_w / 2.0;
        double q_h = half_h / 2.0;

        // 0: NW, 1: NE, 2: SW, 3: SE
        children[0] = std::make_unique<QuadTreeNode>(x - q_w, y - q_h, half_w, half_h);
        children[1] = std::make_unique<QuadTreeNode>(x + q_w, y - q_h, half_w, half_h);
        children[2] = std::make_unique<QuadTreeNode>(x - q_w, y + q_h, half_w, half_h);
        children[3] = std::make_unique<QuadTreeNode>(x + q_w, y + q_h, half_w, half_h);

        is_internal = true;
    }

    // Insert a body into the quadtree
    void insert(Body* b) {
        if (!b || !b->alive) return;

        // update center of mass using weighted average formula
        if (mass == 0.0) {
            com_x = b->state.x;
            com_y = b->state.y;
            mass = b->mass;
        } else {
            double new_mass = mass + b->mass;
            com_x = (com_x * mass + b->state.x * b->mass) / new_mass;
            com_y = (com_y * mass + b->state.y * b->mass) / new_mass;
            mass = new_mass;
        }

        // if this is an external node and currently empty, store the body here
        if (!is_internal && body == nullptr) {
            body = b;
            return;
        }

        // if this node already has a body, we subdivide (if not already internal)
        if (!is_internal) {
            subdivide();

            // re-insert the existing body into its corresponding child quadrant
            Body* old_body = body;
            body = nullptr;
            int old_quad = getQuadrant(old_body->state.x, old_body->state.y);
            children[old_quad]->insert(old_body);
        }

        // insert the new body into the appropriate child quadrant
        int quad = getQuadrant(b->state.x, b->state.y);
        children[quad]->insert(b);
    }

    // calculate gravitational force/acceleration on a target body using Barnes-Hut approximation
    void calculateForce(const Body& target_body, double& ax, double& ay, double theta = 0.5) const {
        // if node empty, do nothing
        if (mass == 0.0) return;

        // if node is target body itself, skip
        if (!is_internal && body && body->id == target_body.id) {
            return;
        }

        // distance vector from target body to this node's center of mass
        double dx = com_x - target_body.state.x;
        double dy = com_y - target_body.state.y;
        double dist_sq = dx * dx + dy * dy + 1e-4;  // +1e-4 to avoid division by zero
        double dist = std::sqrt(dist_sq);

        // if this is external node (leaf) containing a single body, calculate direct force
        if (!is_internal) {
            if (body && body->id != target_body.id && body->alive) {
                double accel = (G * body->mass) / dist_sq;
                ax += accel * (dx / dist);
                ay += accel * (dy / dist);
            }
            return;
        }

        // check Barnes-Hut opening criterion: width / distance < theta
        if ((width / dist) < theta) {
            // treat this entire node as a single point mass at (com_x, com_y)
            double accel = (G * mass) / dist_sq;
            ax += accel * (dx / dist);
            ay += accel * (dy / dist);
        } else {
            // recursively visit all 4 children quadrants (because too close to approximate)
            for (int i = 0; i < 4; ++i) {
                if (children[i]) {
                    children[i]->calculateForce(target_body, ax, ay, theta);
                }
            }
        }
    }
};

#endif