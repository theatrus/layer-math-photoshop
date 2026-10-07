"""Generate the small code-drawn Layer Math toolbar icon; no external fonts."""
from pathlib import Path
import struct
import zlib

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind+data))

pixels = bytearray()
for y in range(48):
    pixels.append(0)
    for x in range(48):
        color = (34, 39, 51, 255)
        if 7 <= x <= 30 and (10 <= y <= 13 or 20 <= y <= 23 or 30 <= y <= 33):
            color = (148, 190, 225, 255)
        if (33 <= x <= 37 and 26 <= y <= 42) or (27 <= x <= 43 and 32 <= y <= 36):
            color = (242, 195, 106, 255)
        pixels.extend(color)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 48,48,8,6,0,0,0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')
target = Path(__file__).resolve().parent.parent / 'uxp/icons/icon.png'
target.parent.mkdir(exist_ok=True)
target.write_bytes(png)
