#ifndef BODY_HPP
#define BODY_HPP

struct State {
    double x, y;
    double vx, vy;
};

class Body {
public:
    int id;
    double mass;
    State state;

    Body(int id, double m, double x, double y, double vx, double vy) : id(id), mass(m), state({x, y, vx, vy}) {}
};

#endif