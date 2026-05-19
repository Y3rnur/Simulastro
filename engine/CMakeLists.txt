cmake_minimum_required(VERSION 3.20)
project(AstrophysicsEngine LANGUAGES CXX)

# Force modern C++20 standards
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find Protobuf
find_package(Protobuf REQUIRED)

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

# Link Protobuf library to the executable (prefer imported target when available)
if(TARGET Protobuf::libprotobuf)
	target_link_libraries(engine_bin PRIVATE Protobuf::libprotobuf)
else()
	target_link_libraries(engine_bin PRIVATE ${Protobuf_LIBRARIES})
endif()

# Informative print statement when configuring
message(STATUS "Configuring Astrophysics Engine with C++20 support...")