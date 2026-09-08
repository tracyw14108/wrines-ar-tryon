from __future__ import annotations

import io
import json
from collections import deque
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data' / 'anpin-ar-products.json'
OUT_DIR = ROOT / 'public' / 'products'
OUT_DIR.mkdir(parents=True, exist_ok=True)

session = requests.Session()
session.headers.update({
    'User-Agent': 'Mozilla/5.0 W.RINES-AR/1.0',
    'Referer': 'https://www.anpingbeauty.com/',
})


def corner_background(img: Image.Image):
    rgba = img.convert('RGBA')
    w, h = rgba.size
    pts = [
        rgba.getpixel((0, 0)), rgba.getpixel((w - 1, 0)),
        rgba.getpixel((0, h - 1)), rgba.getpixel((w - 1, h - 1)),
    ]
    return tuple(sum(p[i] for p in pts) // len(pts) for i in range(3))


def remove_border_background(raw: bytes, output: Path):
    img = Image.open(io.BytesIO(raw)).convert('RGBA')
    if max(img.size) > 1600:
        scale = 1600 / max(img.size)
        img = img.resize(
            (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
            Image.Resampling.LANCZOS,
        )

    bg = corner_background(img)
    px = img.load()
    w, h = img.size

    def similar(pixel, threshold=34):
        return max(abs(pixel[i] - bg[i]) for i in range(3)) <= threshold

    q = deque()
    seen = bytearray(w * h)

    def add(x, y):
        idx = y * w + x
        if seen[idx]:
            return
        seen[idx] = 1
        if similar(px[x, y]):
            q.append((x, y))

    for x in range(w):
        add(x, 0); add(x, h - 1)
    for y in range(h):
        add(0, y); add(w - 1, y)

    while q:
        x, y = q.popleft()
        r, g, b, _ = px[x, y]
        px[x, y] = (r, g, b, 0)
        if x > 0: add(x - 1, y)
        if x + 1 < w: add(x + 1, y)
        if y > 0: add(x, y - 1)
        if y + 1 < h: add(x, y + 1)

    bbox = img.getchannel('A').getbbox()
    if bbox:
        l, t, r, b = bbox
        pad_x = max(8, int((r - l) * 0.06))
        pad_y = max(8, int((b - t) * 0.05))
        img = img.crop((
            max(0, l - pad_x), max(0, t - pad_y),
            min(w, r + pad_x), min(h, b + pad_y),
        ))

    img.save(output, 'PNG', optimize=True)
    return img.size


def main():
    source_catalog = json.loads(SOURCE.read_text(encoding='utf-8'))
    output_catalog = []
    failures = []

    for item in source_catalog:
        sku = item['sku']
        try:
            response = session.get(item['source_image_url'], timeout=60)
            response.raise_for_status()
            filename = f'{sku}.png'
            size = remove_border_background(response.content, OUT_DIR / filename)
            output_catalog.append({
                **item,
                'image': filename,
                'image_px': {'width': size[0], 'height': size[1]},
                'scale_correction': 1.0,
                'anchor_type': 'earlobe',
            })
            print(f'OK {sku}: {size[0]}x{size[1]}')
        except Exception as exc:
            failures.append({'sku': sku, 'error': repr(exc)})
            print(f'FAILED {sku}: {exc!r}')

    (OUT_DIR / 'products.json').write_text(
        json.dumps(output_catalog, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    (OUT_DIR / 'build-failures.json').write_text(
        json.dumps(failures, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )

    print(json.dumps({'success': len(output_catalog), 'failed': len(failures)}, ensure_ascii=False))
    if not output_catalog:
        raise SystemExit('No product assets generated.')


if __name__ == '__main__':
    main()
