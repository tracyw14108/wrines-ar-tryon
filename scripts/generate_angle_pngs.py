from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PRODUCT_DIR = ROOT / 'public' / 'products'
OUT = PRODUCT_DIR / 'angles'
OUT.mkdir(parents=True, exist_ok=True)
CANVAS = 512
ANGLES = {
    'front': (1.00, 0.0),
    'left45': (0.78, -0.035),
    'left90': (0.38, -0.065),
    'right45': (0.78, 0.035),
    'right90': (0.38, 0.065),
}
SKUS = ['YC4413E_1','YC3536E_1','YC5295E_1','YC9561E','YC8320E_1','EH-4520']


def clean_source(path: Path) -> Image.Image:
    im = Image.open(path).convert('RGBA')
    alpha = im.getchannel('A')
    bbox = alpha.getbbox()
    if bbox:
        im = im.crop(bbox)
    target = int(CANVAS * 0.74)
    im.thumbnail((target, target), Image.Resampling.LANCZOS)
    out = Image.new('RGBA', (CANVAS, CANVAS), (0,0,0,0))
    out.alpha_composite(im, ((CANVAS-im.width)//2, (CANVAS-im.height)//2))
    return out


def affine_angle(src: Image.Image, scale_x: float, shear: float) -> Image.Image:
    if scale_x == 1 and shear == 0:
        return src.copy()
    bbox = src.getchannel('A').getbbox() or (0,0,CANVAS,CANVAS)
    crop = src.crop(bbox)
    w, h = crop.size
    new_w = max(16, int(w * scale_x))
    crop = crop.resize((new_w, h), Image.Resampling.LANCZOS)
    pad = int(abs(shear) * h) + 8
    transformed = crop.transform(
        (new_w + pad*2, h),
        Image.Transform.AFFINE,
        (1, shear, -pad - shear*h/2, 0, 1, 0),
        resample=Image.Resampling.BICUBIC,
    )
    out = Image.new('RGBA', (CANVAS, CANVAS), (0,0,0,0))
    out.alpha_composite(transformed, ((CANVAS-transformed.width)//2, (CANVAS-transformed.height)//2))
    return out


def main():
    for sku in SKUS:
        source = PRODUCT_DIR / f'{sku}.png'
        if not source.exists():
            raise FileNotFoundError(source)
        front = clean_source(source)
        for key, (sx, shear) in ANGLES.items():
            img = front if key == 'front' else affine_angle(front, sx, shear)
            path = OUT / f'{sku}_{key}.png'
            img.save(path, 'PNG', optimize=True)
            print(path.relative_to(ROOT))

if __name__ == '__main__':
    main()
