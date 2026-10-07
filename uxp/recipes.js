"use strict";
function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
function keys(value, allowed) { if (!object(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Error("Unexpected recipe fields."); }
function validate(recipe) {
  keys(recipe,["formatVersion","languageVersion","name","description","inputs","inputKinds","parameters","expressions","output"]);
  if (recipe.formatVersion !== 1 || recipe.languageVersion !== "layer-math-1") throw new Error("Unsupported recipe or language version.");
  if (typeof recipe.name !== "string" || !recipe.name.trim() || recipe.name.length > 128) throw new Error("Recipe name is required (maximum 128 characters).");
  if (!Array.isArray(recipe.inputs) || recipe.inputs.length > 32 || new Set(recipe.inputs).size !== recipe.inputs.length || recipe.inputs.some(n => typeof n !== "string" || !/^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(n))) throw new Error("Invalid input aliases.");
  if (!object(recipe.parameters) || Object.keys(recipe.parameters).length > 128 || Object.entries(recipe.parameters).some(([n,v]) => !/^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(n) || recipe.inputs.includes(n) || typeof v !== "number" || !Number.isFinite(v))) throw new Error("Invalid scalar parameters.");
  if (recipe.inputKinds !== undefined && (!object(recipe.inputKinds) || Object.entries(recipe.inputKinds).some(([name,kind])=>!recipe.inputs.includes(name)||!["pixels","mask"].includes(kind)))) throw new Error("Invalid input kinds.");
  keys(recipe.expressions,["shared","r","g","b"]);
  const fields = Object.keys(recipe.expressions).sort().join(",");
  if (!["shared","b,g,r"].includes(fields) || Object.values(recipe.expressions).some(v => typeof v !== "string" || !v.trim() || v.length > 8192)) throw new Error("Provide a shared expression or all three RGB expressions.");
  keys(recipe.output,["destination","depth","outOfRange16"]);
  if (!["new-layer","new-document","layer-mask"].includes(recipe.output.destination) || !["document",32].includes(recipe.output.depth) || !["ask","rescale","clip"].includes(recipe.output.outOfRange16)) throw new Error("Invalid recipe output settings.");
  if ((recipe.output.destination === "new-document") !== (recipe.output.depth === 32)) throw new Error("New documents must use 32-bit output.");
  return recipe;
}
function parse(text) {
  if (text.length > 65536) throw new Error("Recipe exceeds 64 KiB.");
  return validate(JSON.parse(text));
}
module.exports = { validate, parse };
