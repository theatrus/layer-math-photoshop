"use strict";
const FLOAT32_MAX = 3.4028234663852886e38;
function decode(data, bits, components, hasAlpha, channels) {
  if (![16, 32].includes(bits) || ![1,3].includes(channels) || components !== channels + (hasAlpha ? 1 : 0) || data.length % components) {
    throw new Error("Unexpected host pixel layout.");
  }
  const result = new Float64Array(data.length / components * channels);
  const scale = bits === 16 ? 32768 : 1;
  for (let p = 0; p < data.length / components; p++) {
    if (hasAlpha && data[p * components + channels] !== scale) throw new Error("Inputs must be fully opaque. Prepare a full-canvas raster copy.");
    for (let c = 0; c < channels; c++) {
      const v = data[p * components + c];
      if (!Number.isFinite(v) || (bits === 16 && (v < 0 || v > 32768 || !Number.isInteger(v)))) throw new Error("Invalid native input sample.");
      result[p * channels + c] = v / scale;
    }
  }
  return result;
}
function emptyRange() { return { min: Infinity, max: -Infinity, samples: 0 }; }
function include(range, values) {
  for (const v of values) {
    if (!Number.isFinite(v) || Math.abs(v) > FLOAT32_MAX) throw new Error("Non-finite or overflowing output.");
    range.min = Math.min(range.min, v); range.max = Math.max(range.max, v); range.samples++;
  }
}
function rangePolicy(range, bits, policy) {
  if (!range.samples || !Number.isFinite(range.min) || !Number.isFinite(range.max)) throw new Error("Missing range analysis.");
  if (!["ask", "clip", "rescale"].includes(policy)) throw new Error("Unknown range policy.");
  const outside = range.min < 0 || range.max > 1;
  if (bits === 16 && outside && policy === "ask") throw new Error(`Output range is ${range.min} to ${range.max}. Choose Rescale, Clip, or New 32-bit document, then apply again.`);
  if (bits === 16 && outside && policy === "rescale" && range.min === range.max) throw new Error("A constant out-of-range result requires Clip or New 32-bit document.");
}
function encode(values, bits, range, policy) {
  rangePolicy(range, bits, policy);
  if (![16,32].includes(bits)) throw new Error("Unsupported output depth.");
  const out = bits === 16 ? new Uint16Array(values.length) : new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let v = values[i];
    if (!Number.isFinite(v) || v < range.min || v > range.max || Math.abs(v) > FLOAT32_MAX) throw new Error("Output differs from analyzed snapshot.");
    if (bits === 16) {
      if (policy === "rescale" && (range.min < 0 || range.max > 1)) v = (v-range.min)/(range.max-range.min);
      if (policy === "clip") v = Math.max(0, Math.min(1,v));
      out[i] = Math.round(v*32768);
    } else out[i] = v;
  }
  return out;
}
function* tiles(width, height, size = 128) {
  if (![width,height,size].every(n => Number.isSafeInteger(n) && n > 0) || size > 128) throw new Error("Invalid tile dimensions.");
  for (let top = 0; top < height; top += size) for (let left = 0; left < width; left += size) {
    yield {left, top, right: Math.min(left+size,width), bottom: Math.min(top+size,height)};
  }
}
function profileName(name) {
  // Photoshop names its built-in 32-bit gray space this way, but rejects that
  // name as an Imaging API profile. Empty means the target document's space.
  if (name === "Linear Grayscale Profile") return "";
  return String(name || "").replace(/ \(Linear (?:RGB|Grayscale) Profile\)$/, "");
}
function decodeMask(data, bits) {
  const scale = {8:255,16:32768,32:1}[bits];
  if (!scale) throw new Error("Unsupported mask sample depth.");
  return Float64Array.from(data, v => {
    if (!Number.isFinite(v) || v < 0 || v > scale || (bits !== 32 && !Number.isInteger(v))) throw new Error("Invalid mask sample.");
    return v/scale;
  });
}
// Two independent 32-bit accumulators used only for change detection, not security.
function fingerprint(seed) {
  let a=2166136261,b=5381;
  function add(bytes) { for(const n of bytes) {a=Math.imul(a^n,16777619);b=Math.imul(b,33)^n;} }
  add(Array.from(seed,c=>c.charCodeAt(0)));
  return {add, value:()=>`${a>>>0}:${b>>>0}`};
}
module.exports = { decode, decodeMask, fingerprint, encode, emptyRange, include, rangePolicy, tiles, profileName };
