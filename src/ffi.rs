//! C callers must obey the pointer/ownership contract in native/layer_math.h.
#![allow(clippy::missing_safety_doc)]
use crate::{Error, Program};
use std::{
    ffi::c_char,
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
    sync::atomic::{AtomicBool, Ordering},
};

#[repr(C)]
pub struct LmInput {
    pub data: *const f64,
    pub length: usize,
}
#[repr(C)]
pub struct LmError {
    pub offset: usize,
    pub pixel: usize,
    pub channel: usize,
    pub message: [c_char; 512],
}
fn guard(error: *mut LmError, f: impl FnOnce() -> Result<(), Error>) -> i32 {
    let result = catch_unwind(AssertUnwindSafe(f))
        .unwrap_or_else(|_| Err(Error::new("Internal evaluator panic")));
    // SAFETY: the caller provides a writable error or null.
    unsafe {
        if !error.is_null() {
            *error = LmError {
                offset: usize::MAX,
                pixel: usize::MAX,
                channel: usize::MAX,
                message: [0; 512],
            };
        }
        match result {
            Ok(()) => 0,
            Err(e) => {
                if !error.is_null() {
                    (*error).offset = e.offset.unwrap_or(usize::MAX);
                    (*error).pixel = e.pixel.unwrap_or(usize::MAX);
                    (*error).channel = e.channel.unwrap_or(usize::MAX);
                    let mut end = e.message.len().min(511);
                    while !e.message.is_char_boundary(end) {
                        end -= 1;
                    }
                    for (i, b) in e.message.as_bytes()[..end].iter().enumerate() {
                        (*error).message[i] = *b as c_char;
                    }
                }
                if e.message == "Cancelled" { 2 } else { 1 }
            }
        }
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn lm_abi_version() -> u32 {
    1
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn lm_program_channels(program: *const Program) -> usize {
    unsafe { program.as_ref() }.map_or(0, Program::channels)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn lm_compile(
    json: *const u8,
    length: usize,
    out: *mut *mut Program,
    error: *mut LmError,
) -> i32 {
    guard(error, || {
        if out.is_null() {
            return Err(Error::new("Null program output"));
        }
        unsafe {
            *out = ptr::null_mut();
        }
        if json.is_null() || length == 0 || length > 65_536 {
            return Err(Error::new("Invalid compile buffer"));
        }
        let text = std::str::from_utf8(unsafe { slice::from_raw_parts(json, length) })
            .map_err(|_| Error::new("Compile request must be UTF-8"))?;
        let program = Program::from_json(text)?;
        unsafe {
            *out = Box::into_raw(Box::new(program));
        }
        Ok(())
    })
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lm_program_free(program: *mut Program) {
    if !program.is_null() {
        unsafe {
            drop(Box::from_raw(program));
        }
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn lm_cancel_new() -> *mut AtomicBool {
    Box::into_raw(Box::new(AtomicBool::new(false)))
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lm_cancel_set(cancel: *const AtomicBool) {
    if let Some(cancel) = unsafe { cancel.as_ref() } {
        cancel.store(true, Ordering::Relaxed);
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lm_cancel_free(cancel: *mut AtomicBool) {
    if !cancel.is_null() {
        unsafe {
            drop(Box::from_raw(cancel));
        }
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lm_evaluate(
    program: *const Program,
    inputs: *const LmInput,
    input_count: usize,
    pixels: usize,
    output: *mut f64,
    output_length: usize,
    cancel: *const AtomicBool,
    error: *mut LmError,
) -> i32 {
    guard(error, || {
        let program = unsafe { program.as_ref() }.ok_or_else(|| Error::new("Null program"))?;
        if input_count != program.input_count()
            || (input_count > 0 && inputs.is_null())
            || output.is_null()
        {
            return Err(Error::new("Invalid tile pointers or input count"));
        }
        let count = pixels
            .checked_mul(program.channels())
            .filter(|n| *n > 0 && *n <= crate::MAX_TILE_SAMPLES)
            .ok_or_else(|| Error::new("Invalid tile dimensions"))?;
        if output_length != count {
            return Err(Error::new("Wrong output buffer length"));
        }
        let descriptors = if input_count == 0 {
            &[]
        } else {
            unsafe { slice::from_raw_parts(inputs, input_count) }
        };
        let mut data = Vec::with_capacity(input_count);
        let mut total = 0usize;
        for (i, input) in descriptors.iter().enumerate() {
            let length = pixels
                .checked_mul(program.input_channels(i))
                .ok_or_else(|| Error::new("Input length overflow"))?;
            total = total
                .checked_add(length)
                .filter(|n| *n <= crate::MAX_INPUT_SAMPLES)
                .ok_or_else(|| Error::new("Input sample budget exceeded"))?;
            if input.data.is_null() || input.length != length {
                return Err(Error::new("Invalid input buffer"));
            }
            data.push(unsafe { slice::from_raw_parts(input.data, length) });
        }
        let values = program.evaluate(&data, pixels, unsafe { cancel.as_ref() })?;
        // Caller output is untouched on failure and may overlap an input buffer.
        unsafe {
            ptr::copy_nonoverlapping(values.as_ptr(), output, count);
        }
        Ok(())
    })
}
