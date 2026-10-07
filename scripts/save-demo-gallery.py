"""Save the demo-gallery.js UXP result as images, importable recipes and a gallery.

Usage: python scripts/save-demo-gallery.py build/live-gallery-export.json build/gallery-export.json
The input may include Adobe CLI log lines before the JSON result.
"""
import argparse
import base64
import html
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent


def save(sources):
    data = {"examples": []}
    for source in sources:
        raw = source.read_text(encoding="utf-8-sig")
        result = json.loads(raw[raw.index("{"):])
        if "error" in result:
            raise ValueError(result["error"])
        current = result["value"]
        data["examples"].extend(current["examples"])
        if current.get("photoshopVersion"):
            data["photoshopVersion"] = current["photoshopVersion"]
    ids = [example["id"] for example in data["examples"]]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate example IDs")
    sequence = ["layer-mask-before", "live-mask-before", "layer-mask-after", "live-mask-after"]
    data["examples"].sort(key=lambda e: sequence.index(e["id"]) if e["id"] in sequence else len(sequence))
    # Use canonical descriptions to avoid legacy console-export encoding damage.
    presets = {r["name"]: r for r in json.loads((ROOT / "examples/recipes.json").read_text(encoding="utf-8"))["recipes"]}
    images = ROOT / "docs/images/gallery"
    recipes = ROOT / "examples/gallery"
    images.mkdir(parents=True, exist_ok=True)
    recipes.mkdir(parents=True, exist_ok=True)
    cards = []
    markdown = ["# Math example gallery", "", "Actual Photoshop image exports, not UI screenshots. All examples use a deterministic synthetic nebula and stars fixture (960 × 640, 16-bit RGB, sRGB). JPEGs are display copies; the calculations use native sample values.", "", "Open [the visual gallery](gallery.html) for larger images and downloadable recipes. Imported recipes require explicit layer bindings.", "", "For the live mask example, bind A and B as Pixels and M as Mask, enter `mix(A, B, M)`, and enable Live result. Inverting the attached source mask automatically updates the same output layer. No clipping mask is needed. The plugin must be running, and the document must be active. Mask inputs use density 100% and feather 0. Exported recipes do not automatically enable Live result.", ""]
    for example in data["examples"]:
        key = example["id"]
        if not re.fullmatch(r"[a-z0-9-]+", key):
            raise ValueError("Invalid example filename")
        jpeg = base64.b64decode(example["jpeg"], validate=True)
        if not jpeg.startswith(b"\xff\xd8"):
            raise ValueError("Expected a JPEG export")
        (images / f"{key}.jpg").write_bytes(jpeg)
        recipe = {"formatVersion": 1, "languageVersion": "layer-math-1", **example["recipe"]}
        if recipe["name"] in presets:
            recipe["description"] = presets[recipe["name"]].get("description", "")
        (recipes / f"{key}.json").write_text(json.dumps(recipe, indent=2)+"\n", encoding="utf-8", newline="\n")
        expressions = recipe["expressions"]
        formula = expressions.get("shared") or "\n".join(f"{channel.upper()}: {expressions[channel]}" for channel in ("r", "g", "b"))
        parameters = ", ".join(f"{name} = {value}" for name, value in recipe["parameters"].items())
        bindings = "; ".join(f"{name} ← {value}" for name, value in example["bindings"].items())
        policy = "Attached mask output (0–1); no rescaling or clipping needed." if recipe["output"]["destination"] == "layer-mask" else "16-bit output; Clip to 0–1 explicitly selected." if recipe["output"]["outOfRange16"] == "clip" else "16-bit output; no rescaling or clipping needed."
        title = example["title"]
        note = example.get("note", "")
        esc = html.escape
        cards.append(f'<article id="{key}"><a href="images/gallery/{key}.jpg"><img src="images/gallery/{key}.jpg" alt="{esc(title)}" width="960" height="640"></a><div class="copy"><h2>{esc(title)}</h2><pre>{esc(formula)}</pre><p class="parameters">{esc(parameters)}</p><p>{esc(bindings)}</p><p>{esc(recipe.get("description", ""))}</p><p>{esc(note)}</p><p class="note">{esc(policy)}</p><a download href="../examples/gallery/{key}.json">Download recipe</a></div></article>')
        markdown += [f"## {title}", "", f"![{title}](images/gallery/{key}.jpg)", "", "```text", formula, "```", "", parameters or "No named parameters.", "", bindings, "", note, "", policy, "", f"[Importable recipe](../examples/gallery/{key}.json)", ""]
    page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Layer Math · examples</title><style>
*{box-sizing:border-box}body{margin:0;background:#14171d;color:#e9ecf2;font:15px/1.55 system-ui,sans-serif}header{max-width:1500px;margin:auto;padding:36px 28px 24px}h1{font-size:34px;margin:0 0 8px}header p{max-width:900px;color:#b8c2d2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:20px;max-width:1500px;margin:auto;padding:0 28px 40px}article{border:1px solid #384252;border-radius:2px;overflow:hidden;background:#1d232d}img{display:block;width:100%;height:auto}.copy{padding:16px}h2{font-size:18px;margin:0 0 10px}pre{font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:#b9d9ff}p{font-size:13px;margin:8px 0}.parameters{color:#d7bb88}.note{color:#9faab9}a{color:#9cc6ff}a:focus-visible{outline:2px solid #9cc6ff}footer{max-width:1500px;margin:auto;padding:0 28px 28px;color:#a8b2c1}
</style></head><body><header><h1>Layer Math in formulas</h1><p>EXAMPLE_COUNT examples evaluated by the native addon inside Photoshop. These are actual image exports from a synthetic 16-bit RGB fixture, not photographs or screenshots of the panel. Click any image to inspect it at full size.</p><p><strong>Masks + live results:</strong> bind A and B as Pixels and M as Mask, enter <code>mix(A, B, M)</code>, then enable Live result. Invert the attached source mask and the same result layer updates automatically. No clipping mask required. Keep the plugin running and the document active; mask density must be 100% and feather 0.</p><p>Type formulas as plain text. Downloaded recipes require source bindings; enable Live result separately. <a href="../README.md">README</a> · <a href="#live-mask-before">Before the mask edit</a> · <a href="#live-mask-after">After automatic refresh</a> · <a href="#screen">More math examples</a></p></header><main class="grid">'''+"\n".join(cards)+f'</main><footer>Photoshop {esc(data.get("photoshopVersion", "host export"))} · 960 × 640 · sRGB IEC61966-2.1 · 16-bit calculation inputs, JPEG display exports.</footer></body></html>'
    page = page.replace("EXAMPLE_COUNT", str(len(cards))).replace("minmax(330px,1fr)", "minmax(min(100%,330px),1fr)")
    (ROOT / "docs/gallery.html").write_text(page, encoding="utf-8", newline="\n")
    (ROOT / "docs/gallery.md").write_text("\n".join(markdown), encoding="utf-8", newline="\n")
    print(f"Saved {len(cards)} verified JPEG exports and recipes to docs/gallery.html")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", nargs="+", type=Path)
    save(parser.parse_args().sources)
