cmake_minimum_required(VERSION 3.14)
project(hand_eval LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(hand_eval SHARED
    hand_eval.cpp
)

target_include_directories(hand_eval PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

if(WIN32)
    set_target_properties(hand_eval PROPERTIES
        WINDOWS_EXPORT_ALL_SYMBOLS TRUE
    )
endif()

add_executable(test_hand_eval test_hand_eval.cpp)
target_link_libraries(test_hand_eval hand_eval)

enable_testing()
add_test(NAME hand_eval_test COMMAND test_hand_eval)