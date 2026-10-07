#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif
typedef struct LmProgram LmProgram;
typedef struct LmCancel LmCancel;
typedef struct { const double* data; size_t length; } LmInput;
typedef struct {
    size_t offset; /* UTF-8 byte offset, SIZE_MAX when absent */
    size_t pixel; /* Index within the supplied tile, SIZE_MAX when absent */
    size_t channel;
    char message[512]; /* NUL-terminated UTF-8, owned by caller */
} LmError;

/* ABI 1: doubles are normalized, interleaved channel samples. All pointers must
   be aligned, valid and live for their specified lengths. No caller allocation
   is freed by Rust. Program and cancel handles must be freed exactly once and
   never while an evaluation uses them. Immutable programs may be shared across
   evaluations; use a separate output/error per call. lm_cancel_set is thread-safe.
   All other mutations/frees require exclusive access to the affected object.
   Return: 0 success, 1 error, 2 cancelled. Output is unchanged on failure.
   Compile JSON is UTF-8, at most 64 KiB; inputs are in CompileSpec order.
   Output has pixels * channels elements. Zero-size tiles are rejected.
   Error may be NULL. Null frees are allowed. */
uint32_t lm_abi_version(void);
size_t lm_program_channels(const LmProgram* program);
int32_t lm_compile(const uint8_t* json, size_t length, LmProgram** out, LmError* error);
void lm_program_free(LmProgram* program);
LmCancel* lm_cancel_new(void);
void lm_cancel_set(const LmCancel* cancel);
void lm_cancel_free(LmCancel* cancel);
int32_t lm_evaluate(const LmProgram* program, const LmInput* inputs, size_t input_count,
    size_t pixels, double* output, size_t output_length, const LmCancel* cancel, LmError* error);
#ifdef __cplusplus
}
#endif
