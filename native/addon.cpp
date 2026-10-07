#include "UxpAddon.h"
#include "layer_math.h"
#include <cmath>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <vector>

namespace {
using ProgramPtr = std::unique_ptr<LmProgram, decltype(&lm_program_free)>;
std::mutex mutex;
std::map<addon_env, std::map<uint32_t, ProgramPtr>> programs;
uint32_t nextId = 1;
void check(addon_status status) {
    if (status != addon_ok) throw std::runtime_error("UXP native API call failed");
}
void require(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
addon_value failure(addon_env env) noexcept {
    try { throw; }
    catch (const std::exception& e) { UxpAddonApis.uxp_addon_throw_error(env, nullptr, e.what()); }
    catch (...) { UxpAddonApis.uxp_addon_throw_error(env, nullptr, "Unexpected native error"); }
    return nullptr;
}
void nativeCheck(int status, const LmError& error) {
    if (!status) return;
    std::string message(error.message);
    if (error.offset != SIZE_MAX) message += " at byte " + std::to_string(error.offset);
    if (error.pixel != SIZE_MAX) message += ", tile pixel " + std::to_string(error.pixel);
    if (error.channel != SIZE_MAX) message += ", channel " + std::to_string(error.channel);
    throw std::runtime_error(message);
}
std::vector<addon_value> args(addon_env env, addon_callback_info info, size_t expected) {
    std::vector<addon_value> values(expected + 1);
    size_t count = values.size();
    check(UxpAddonApis.uxp_addon_get_cb_info(env, info, &count, values.data(), nullptr, nullptr));
    require(count == expected, "Wrong number of native arguments");
    return values;
}
uint32_t integer(addon_env env, addon_value value) {
    double n = 0;
    check(UxpAddonApis.uxp_addon_get_value_double(env, value, &n));
    require(std::isfinite(n) && n >= 0 && n <= UINT32_MAX && n == std::floor(n), "Expected an unsigned integer");
    return static_cast<uint32_t>(n);
}
addon_value compile(addon_env env, addon_callback_info info) {
    try {
        const auto argv = args(env, info, 1);
        size_t length = 0;
        check(UxpAddonApis.uxp_addon_get_value_string_utf8(env, argv[0], nullptr, 0, &length));
        require(length > 0 && length <= 65536, "Compile request exceeds 64 KiB");
        std::vector<char> json(length + 1);
        check(UxpAddonApis.uxp_addon_get_value_string_utf8(env, argv[0], json.data(), json.size(), &length));
        LmProgram* raw = nullptr; LmError error{};
        nativeCheck(lm_compile(reinterpret_cast<const uint8_t*>(json.data()), length, &raw, &error), error);
        ProgramPtr program(raw, lm_program_free);
        std::lock_guard<std::mutex> lock(mutex);
        auto& handles = programs[env];
        require(handles.size() < 64 && nextId != 0, "Too many live compiled expressions");
        const auto id = nextId++;
        addon_value result = nullptr;
        check(UxpAddonApis.uxp_addon_create_uint32(env, id, &result));
        handles.emplace(id, std::move(program));
        return result;
    } catch (...) { return failure(env); }
}
addon_value dispose(addon_env env, addon_callback_info info) {
    try {
        const auto argv = args(env, info, 1);
        const auto id = integer(env, argv[0]);
        std::lock_guard<std::mutex> lock(mutex);
        require(programs[env].erase(id) == 1, "Unknown or disposed expression handle");
        addon_value result = nullptr;
        check(UxpAddonApis.uxp_addon_get_undefined(env, &result));
        return result;
    } catch (...) { return failure(env); }
}
// A bounded synchronous tile avoids retaining any borrowed UXP values. The JS
// orchestrator yields/checks cancellation between tiles and owns the modal scope.
addon_value evaluate(addon_env env, addon_callback_info info) {
    try {
        const auto argv = args(env, info, 3);
        const auto id = integer(env, argv[0]);
        const auto pixels = integer(env, argv[2]);
        require(pixels > 0 && pixels <= 16384, "Native tile must contain 1..16384 pixels");
        std::lock_guard<std::mutex> lock(mutex);
        auto& handles = programs[env];
        const auto found = handles.find(id);
        require(found != handles.end(), "Unknown or disposed expression handle");
        auto* program = found->second.get();
        uint32_t count = 0;
        check(UxpAddonApis.uxp_addon_get_array_length(env, argv[1], &count));
        require(count <= 32, "Too many inputs");
        std::vector<LmInput> inputs;
        for (uint32_t i = 0; i < count; ++i) {
            addon_value buffer = nullptr; void* data = nullptr; size_t bytes = 0;
            check(UxpAddonApis.uxp_addon_get_element(env, argv[1], i, &buffer));
            check(UxpAddonApis.uxp_addon_get_arraybuffer_info(env, buffer, &data, &bytes));
            require(bytes % sizeof(double) == 0 && bytes <= 16384 * 3 * sizeof(double), "Invalid Float64 input buffer");
            inputs.push_back({static_cast<const double*>(data), bytes / sizeof(double)});
        }
        const size_t samples = pixels * lm_program_channels(program);
        void* output = nullptr; addon_value buffer = nullptr, result = nullptr;
        check(UxpAddonApis.uxp_addon_create_arraybuffer(env, samples * sizeof(double), &output, &buffer));
        LmError error{};
        nativeCheck(lm_evaluate(program, inputs.data(), inputs.size(), pixels,
            static_cast<double*>(output), samples, nullptr, &error), error);
        check(UxpAddonApis.uxp_addon_create_typedarray(env, addon_float64_array, samples, buffer, 0, &result));
        return result;
    } catch (...) { return failure(env); }
}
addon_value version(addon_env env, addon_callback_info info) {
    try {
        args(env, info, 0);
        addon_value result = nullptr;
        check(UxpAddonApis.uxp_addon_create_uint32(env, lm_abi_version(), &result));
        return result;
    } catch (...) { return failure(env); }
}
addon_value init(addon_env env, addon_value exports, const addon_apis&) {
    try {
        for (const auto& item : std::vector<std::pair<const char*, addon_callback>>{
            {"compile",compile},{"evaluate",evaluate},{"dispose",dispose},{"abiVersion",version}}) {
            addon_value fn = nullptr;
            check(UxpAddonApis.uxp_addon_create_function(env, item.first, std::strlen(item.first), item.second, nullptr, &fn));
            check(UxpAddonApis.uxp_addon_set_named_property(env, exports, item.first, fn));
        }
        return exports;
    } catch (...) { return failure(env); }
}
void terminate(addon_env env) {
    std::lock_guard<std::mutex> lock(mutex);
    programs.erase(env);
}
}
UXP_ADDON_INIT(init)
UXP_ADDON_TERMINATE(terminate)
