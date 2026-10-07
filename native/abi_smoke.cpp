#include "layer_math.h"
#include <cmath>
#include <cstring>
#include <iostream>
#include <stdexcept>

static void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
int main() {
    try {
        require(lm_abi_version() == 1, "ABI mismatch");
        const char* json = R"json({"channels":1,"inputs":[{"name":"A","channels":1},{"name":"B","channels":1}],"expressions":{"shared":"combine(A,B,op_screen())"}})json";
        LmProgram* program = nullptr;
        LmError error{};
        require(lm_compile(reinterpret_cast<const uint8_t*>(json), std::strlen(json), &program, &error) == 0, error.message);
        double a[] = {0.2, 2.0, -0.2}, b[] = {0.4, 0.25, 0.4}, output[3] = {};
        LmInput inputs[] = {{a,3},{b,3}};
        require(lm_evaluate(program, inputs, 2, 3, output, 3, nullptr, &error) == 0, error.message);
        require(std::abs(output[0]-0.52) < 1e-12 && output[1] == 1.75 && std::abs(output[2]-0.28) < 1e-12, "Wrong pixels");
        auto cancel = lm_cancel_new();
        lm_cancel_set(cancel);
        output[0] = 42;
        require(lm_evaluate(program, inputs, 2, 3, output, 3, cancel, &error) == 2, "Cancellation failed");
        require(output[0] == 42, "Cancellation changed output");
        lm_cancel_free(cancel);
        inputs[0].length = 2;
        require(lm_evaluate(program, inputs, 2, 3, output, 3, nullptr, &error) == 1, "Bad buffer accepted");
        lm_program_free(program);
        require(lm_compile(nullptr, 0, &program, &error) == 1 && program == nullptr, "Invalid compile accepted");
        std::cout << "C++/Rust ABI smoke passed\n";
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n'; return 1;
    }
}
