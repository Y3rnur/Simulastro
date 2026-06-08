#ifndef BODY_HPP
#define BODY_HPP

#include <cmath>
#include <algorithm>

struct State {
    double x, y;
    double vx, vy;
};

class Body {
public:
    int id;
    double mass;
    double radius;
    bool alive;
    State state;

    Body(int id, double m, double x, double y, double vx, double vy, double r = 1.0)
        : id(id), mass(m), radius(r), alive(true), state({x, y, vx, vy}) {}

    // radius = cbrt( 3 * mass / (4 * pi * density) )
    // Default density chosen as 2000 kg/m^3 (rocky body)
    static double radiusFromMass(double mass, double density = 2000.0) {
        const double m = std::max(mass, 1e-12);
        const double pi = 3.14159265358979323846;
        double vol = (3.0 * m) / (4.0 * pi * density);
        return std::cbrt(vol);
    }
};

#endif