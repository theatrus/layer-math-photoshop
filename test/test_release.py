import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release", ROOT / "scripts/release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def fixture(self, folder):
        ccx = folder / f"LayerMath-Photoshop-{release.version()}.ccx"
        with zipfile.ZipFile(ccx, "w") as z:
            for name in ("manifest.json", "index.html", "host.js", "panel.js", "pixels.js",
                         "recipes.js", "live.js", "live-data.js", "icons/icon.png"):
                z.write(ROOT / "uxp" / name, name)
            z.write(ROOT / "examples/recipes.json", "presets.json")
            for name in release.DOCS:
                z.write(ROOT / name, name)
            z.writestr("win/x64/layer_math.uxpaddon", b"MZtest")
            for arch in ("arm64", "x64"):
                z.writestr(f"mac/{arch}/layer_math.uxpaddon", b"\xcf\xfa\xed\xfetest")
        record = folder / release.INPUT_NAME
        record.write_text(json.dumps(release.identity(ccx)))
        return ccx, record

    def test_reject_wrong_source_version_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            ccx, record = self.fixture(Path(temp))
            release.check(ccx, record)
            original = json.loads(record.read_text())
            for key, value in (("source", "bad"), ("version", "99.0.0"), ("sha256", "bad")):
                record.write_text(json.dumps({**original, key: value}))
                with self.assertRaises(ValueError):
                    release.check(ccx, record)

    def test_zip_preserves_payload_and_checksums_final_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            ccx, record = self.fixture(folder)
            for platform in ("win", "mac"):
                release.archives(ccx, record, platform, folder)
            for archive in folder.glob("*.zip"):
                with zipfile.ZipFile(archive) as z:
                    self.assertEqual(z.read("Install Layer Math.ccx"), ccx.read_bytes())
                    self.assertIn("Read me first.txt", z.namelist())
                self.assertEqual(archive.with_name(archive.name + ".sha256").read_text(),
                                 f"{release.digest(archive)}  {archive.name}\n")
            with self.assertRaises(ValueError):
                release.archives(ccx, record, "win", folder)

    def test_release_rejects_changed_panel_even_if_hash_updated(self):
        with tempfile.TemporaryDirectory() as temp:
            ccx, record = self.fixture(Path(temp))
            with zipfile.ZipFile(ccx) as z:
                files = {name: z.read(name) for name in z.namelist()}
            files["panel.js"] = b"unexpected panel"
            with zipfile.ZipFile(ccx, "w") as z:
                for name, data in files.items(): z.writestr(name, data)
            record.write_text(json.dumps(release.identity(ccx)))
            with self.assertRaisesRegex(ValueError, "source file mismatch"):
                release.check(ccx, record)


if __name__ == "__main__": unittest.main()
