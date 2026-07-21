#ifndef GLOBALS_HPP
#define GLOBALS_HPP

#include <mutex>
#include <atomic>
#include <vector>
#include <condition_variable>
#include "body.hpp"

extern std::mutex universe_mutex;
extern std::vector<Body> universe;
extern std::atomic<bool> scene_loaded;
extern std::atomic<bool> is_running;
extern std::condition_variable state_cv;
extern std::mutex state_mutex;

#endif