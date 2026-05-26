cmake_minimum_required(VERSION 3.20)
project(AstrophysicsEngine LANGUAGES CXX)

# Force modern C++20 standards
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find Protobuf
find_package(Protobuf REQUIRED)

# Try to find gRPC via CMake package config first; if unavailable, fall back to pkg-config.
find_package(gRPC CONFIG QUIET)

find_package(PkgConfig QUIET)
if(NOT gRPC_FOUND AND PkgConfig_FOUND)
	pkg_check_modules(GRPC_PKG QUIET grpc++)
	if(GRPC_PKG_FOUND)
		set(GRPC_PKG_AVAILABLE TRUE)
	endif()
endif()

# Find all our source files
file(GLOB_RECURSE CPP_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp")
file(GLOB_RECURSE CC_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cc")
set(SOURCES ${CPP_SOURCES} ${CC_SOURCES})

# Fail early if no sources were found
if(NOT SOURCES)
	message(FATAL_ERROR "No source files found in ${CMAKE_CURRENT_SOURCE_DIR}/src — ensure at least one .cpp or .cc is present or adjust the glob pattern.")
endif()

# Declare our executable binary target
add_executable(engine_bin ${SOURCES})

# Include project headers and generated Protobuf headers for the target
target_include_directories(engine_bin PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}/include
	${CMAKE_CURRENT_SOURCE_DIR}/src/generated
	${Protobuf_INCLUDE_DIRS}
)

# Link Protobuf and gRPC libraries to the executable (prefer imported target when available)
if(TARGET Protobuf::libprotobuf)
	target_link_libraries(engine_bin PRIVATE Protobuf::libprotobuf)
else()
	target_link_libraries(engine_bin PRIVATE ${Protobuf_LIBRARIES})
endif()

if(TARGET gRPC::grpc++)
	target_link_libraries(engine_bin PRIVATE gRPC::grpc++)
elseif(GRPC_PKG_AVAILABLE)
	target_include_directories(engine_bin PRIVATE ${GRPC_PKG_INCLUDE_DIRS})
	target_link_libraries(engine_bin PRIVATE ${GRPC_PKG_LIBRARIES})
else()
	message(WARNING "gRPC not found. Install the system package 'libgrpc++-dev' or set CMAKE_PREFIX_PATH/GPRC_DIR to a gRPC CMake package location. Continuing without gRPC; gRPC-related generated code may fail to link at build time.")
endif()

# Informative print statement when configuring
message(STATUS "Configuring Astrophysics Engine with C++20 support...")