cmake_minimum_required(VERSION 3.20)
project(AstrophysicsEngine LANGUAGES CXX)

# Force modern C++20 standards
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Define where our header files live (.hpp)
include_directories(include)

	# Find all our source files (.cpp) (reconfigure when sources change)
	file(GLOB_RECURSE SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp")

	# Fail early if no sources were found (helps diagnose empty-glob issues)
	if(NOT SOURCES)
		message(FATAL_ERROR "No source files found in ${CMAKE_CURRENT_SOURCE_DIR}/src — ensure at least one .cpp is present or adjust the glob pattern.")
	endif()

	# Declare our executable binary target
	add_executable(engine_bin ${SOURCES})

# Informative print statement when configuring
message(STATUS "Configuring Astrophysics Engine with C++20 support...")