"""Local QA only: review imported photographs without uploading them."""
import json
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
root=Path(__file__).resolve().parent.parent
catalog=json.loads((root/'.private/import-catalog.json').read_text(encoding='utf-8'))
items=catalog['memories']
sheet=Image.new('RGB',(8*160,((len(items)+7)//8)*190),'#f5f0e8')
draw=ImageDraw.Draw(sheet)
for i,item in enumerate(items):
    image=Image.open(root/'private-media'/Path(item['thumb']).name)
    image=ImageOps.contain(image,(152,158))
    x=(i%8)*160;y=(i//8)*190
    sheet.paste(image,(x+(160-image.width)//2,y))
    draw.text((x+4,y+159),str(i)+' '+item.get('originalName','')[:20],fill='#35111e')
    draw.text((x+4,y+174),item.get('date','sin fecha'),fill='#35111e')
(root/'.qa').mkdir(exist_ok=True)
sheet.save(root/'.qa/contact-sheet.jpg')
