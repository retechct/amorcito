"""Import project photos safely; never changes the supplied originals."""
from pathlib import Path, PurePosixPath
import io, json, hashlib, zipfile, re, collections
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'private-media'
PRIVATE = ROOT / '.private'
OUTPUT.mkdir(exist_ok=True)
PRIVATE.mkdir(exist_ok=True)
MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
originals = {
    'amorcito 1.jpg': ('lights', 'Nuestra noche de colores', 'Noches de luz', 'Lo más bonito nunca fue el lugar ni la fecha, sino compartirlo contigo.'),
    'amorcito2.JPG': ('hearts', 'Entre luces y corazones', 'Noches de luz', 'Siempre tú, siempre nosotros. Una noche para guardar.'),
    'image.png': ('graduation', 'Verte cumplir tus sueños', 'Lo que celebramos', 'Tu logro también se convirtió en uno de mis recuerdos favoritos.')
}

def capture_date(image):
    exif = image.getexif()
    inner = exif.get_ifd(34665) if 34665 in exif else {}
    for value in [inner.get(36867), exif.get(36867), inner.get(36868), exif.get(306)]:
        if value and re.match(r'^\d{4}:\d{2}:\d{2}', str(value)):
            date = str(value)[:10].replace(':', '-')
            try:
                from datetime import date as dt
                dt.fromisoformat(date)
                return date
            except ValueError:
                pass
    return ''

records, issues, seen = [], [], set()
def import_image(name, content):
    digest = hashlib.sha256(content).hexdigest()[:24]
    if digest in seen:
        return
    seen.add(digest)
    try:
        with Image.open(io.BytesIO(content)) as source:
            date = capture_date(source)
            image = ImageOps.exif_transpose(source).convert('RGB')
            width, height = image.size
            image.thumbnail((1800,1800), Image.Resampling.LANCZOS)
            image.save(OUTPUT / (digest+'.jpg'), quality=88, optimize=True)
            image.thumbnail((480,480), Image.Resampling.LANCZOS)
            image.save(OUTPUT / (digest+'-thumb.jpg'), quality=82, optimize=True)
        base = Path(name).name
        ident, title, album, note = originals.get(base, ('photo-'+digest, 'Un instante contigo', '', ''))
        if not album:
            album = (MONTHS[int(date[5:7])-1].capitalize()+' de '+date[:4]) if date else 'Instantes por ubicar'
        records.append(dict(id=ident, title=title, album=album, date=date, month=date[:7], note=note, src='/media/'+digest+'.jpg', thumb='/media/'+digest+'-thumb.jpg', originalName=base, kind='photo', width=width, height=height, featured=base in originals, updated=0))
    except Exception as error:
        issues.append({'file':name, 'error':str(error)})

for name in originals:
    import_image(name, (ROOT/name).read_bytes())
for file in sorted(ROOT.glob('*.HEIC')):
    import_image(file.name, file.read_bytes())
videos = []
zip_path = ROOT / 'Photos-1-001.zip'
if zip_path.exists():
    with zipfile.ZipFile(zip_path) as bundle:
        if sum(item.file_size for item in bundle.infolist()) > 512*1024*1024:
            raise ValueError('The archive exceeds the import limit.')
        for item in bundle.infolist():
            path = PurePosixPath(item.filename.replace('\\','/'))
            if item.is_dir() or path.is_absolute() or '..' in path.parts or item.file_size > 25*1024*1024:
                continue
            extension = path.suffix.lower()
            if extension in {'.jpg','.jpeg','.png','.heic','.webp'}:
                import_image(item.filename, bundle.read(item))
            elif extension in {'.mov','.mp4'}:
                digest = hashlib.sha256(bundle.read(item)).hexdigest()[:24]
                destination = OUTPUT / (digest+extension)
                destination.write_bytes(bundle.read(item))
                videos.append({'originalName':path.name,'file':destination.name})

manifest = {'memories':records,'videoSources':videos,'issues':issues}
(PRIVATE/'import-catalog.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
counts = collections.Counter(item['month'] or 'Sin fecha' for item in records)
print(json.dumps({'photos':len(records),'months':dict(sorted(counts.items())),'videos':len(videos),'issues':issues},ensure_ascii=False))
