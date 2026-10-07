"""Regenerate committed instruction artwork: Pillow + explicit local font files."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont

regular, bold = sys.argv[1:3]
image = Image.new("RGB", (920, 660), (27, 32, 43))
draw = ImageDraw.Draw(image)
def text(x, y, value, size=22, weight=False, color=(213,222,236)):
    draw.text((x,y), value, font=ImageFont.truetype(bold if weight else regular,size), fill=color)
draw.rectangle((0,0,919,7),fill=(242,195,106))
text(70,65,"Layer Math",52,True)
text(72,137,"Mathematical expressions for Photoshop layers",25)
text(72,385,"1. Open Install Layer Math.ccx",27,True)
text(72,438,"2. Follow Adobe Creative Cloud's installation prompts",24)
text(72,491,"3. Open Photoshop > Plugins > Layer Math",24)
text(72,576,"16-bit and 32-bit RGB / grayscale",19,color=(148,190,225))
image.save(Path(__file__).with_name("dmg-background.png"))
