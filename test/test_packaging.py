import importlib.util
import io
from pathlib import Path
import stat
import unittest
import zipfile

spec=importlib.util.spec_from_file_location("ci_sdk",Path(__file__).resolve().parents[1]/"scripts/ci_sdk.py")
sdk=importlib.util.module_from_spec(spec)
spec.loader.exec_module(sdk)

class ArchiveTests(unittest.TestCase):
    def archive(self,name,symlink=False):
        data=io.BytesIO()
        with zipfile.ZipFile(data,"w") as out:
            info=zipfile.ZipInfo(name)
            if symlink:info.external_attr=(stat.S_IFLNK|0o777)<<16
            out.writestr(info,b"header")
        raw=data.getvalue()
        if "\\" in name:
            # ZipInfo normalizes Windows separators when writing. Restore a raw
            # hostile archive name in both directory records for the read test.
            raw=raw.replace(name.replace("\\","/").encode(),name.encode())
        return zipfile.ZipFile(io.BytesIO(raw))

    def test_sdk_archive_rejects_escape_and_symlinks(self):
        for name in ("../escape","/absolute","a/../../escape","C:/escape","a\\escape"):
            with self.subTest(name=name),self.archive(name) as archive:
                with self.assertRaises(ValueError):sdk.safe_members(archive)
        with self.archive("link",True) as archive:
            with self.assertRaises(ValueError):sdk.safe_members(archive)

    def test_sdk_archive_accepts_relative_headers(self):
        with self.archive("sdk/src/api/header.h") as archive:
            self.assertEqual(len(sdk.safe_members(archive)),1)

if __name__=="__main__":unittest.main()
