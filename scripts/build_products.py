from __future__ import annotations

import io
import json
from pathlib import Path

import cv2
import numpy as np
import requests
from PIL import Image
from rembg import remove

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data' / 'anpin-ar-products.json'
OUT_DIR = ROOT / 'public' / 'products'
OUT_DIR.mkdir(parents=True, exist_ok=True)

session = requests.Session()
session.headers.update({
    'User-Agent': 'Mozilla/5.0 W.RINES-AR/1.0',
    'Referer': 'https://www.anpingbeauty.com/',
})


def extract_main_component(mask: np.ndarray) -> np.ndarray:
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if num_labels <= 1:
        return mask

    h, w = mask.shape
    img_cx, img_cy = w / 2.0, h / 2.0
    img_diag = (w ** 2 + h ** 2) ** 0.5
    min_area = max(120, int(h * w * 0.0015))

    best_label = None
    best_score = -1.0

    for label in range(1, num_labels):
        x = stats[label, cv2.CC_STAT_LEFT]
        y = stats[label, cv2.CC_STAT_TOP]
        bw = stats[label, cv2.CC_STAT_WIDTH]
        bh = stats[label, cv2.CC_STAT_HEIGHT]
        area = stats[label, cv2.CC_STAT_AREA]
        if area < min_area:
            continue

        cx, cy = centroids[label]
        center_dist = ((cx - img_cx) ** 2 + (cy - img_cy) ** 2) ** 0.5
        center_score = 1.0 - min(center_dist / (img_diag / 2.0), 1.0)
        fill_ratio = area / max(1, bw * bh)
        touches_edge = (
            x <= 2 or y <= 2 or
            (x + bw) >= (w - 2) or
            (y + bh) >= (h - 2)
        )

        score = area * (0.7 + 0.5 * center_score) * (0.7 + 0.6 * fill_ratio)
        if touches_edge:
            score *= 0.6

        if score > best_score:
            best_score = score
            best_label = label

    if best_label is None:
        best_label = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])

    out = np.zeros_like(mask)
    out[labels == best_label] = 255
    return out


def crop_to_alpha(img: Image.Image, pad_ratio_x=0.08, pad_ratio_y=0.08) -> Image.Image:
    bbox = img.getchannel('A').getbbox()
    if not bbox:
        return img

    l, t, r, b = bbox
    w = r - l
    h = b - t
    pad_x = max(8, int(w * pad_ratio_x))
    pad_y = max(8, int(h * pad_ratio_y))

    return img.crop((
        max(0, l - pad_x),
        max(0, t - pad_y),
        min(img.width, r + pad_x),
        min(img.height, b + pad_y),
    ))


def subject_only_png(raw: bytes, output: Path):
    cut_bytes = remove(raw)
    img = Image.open(io.BytesIO(cut_bytes)).convert('RGBA')

    if max(img.size) > 1600:
        scale = 1600 / max(img.size)
        img = img.resize(
            (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
            Image.Resampling.LANCZOS,
        )

    rgba = np.array(img)
    alpha = rgba[:, :, 3]
    mask = np.where(alpha > 20, 255, 0).astype(np.uint8)

    kernel3 = np.ones((3, 3), np.uint8)
    kernel5 = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel3)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel5)
    main_mask = extract_main_component(mask)

    rgba[:, :, 3] = np.where(main_mask > 0, rgba[:, :, 3], 0)
    img = Image.fromarray(rgba, 'RGBA')
    img = crop_to_alpha(img)

    if img.getchannel('A').getbbox() is None:
        raise ValueError('NO_VISIBLE_SUBJECT_AFTER_BACKGROUND_REMOVAL')

    img.save(output, 'PNG', optimize=True)
    return img.size


def main():
    source_catalog = json.loads(SOURCE.read_text(encoding='utf-8'))
    source_catalog = [item for item in source_catalog if item.get('ar_enabled', True) is not False]
    output_catalog = []
    failures = []

    expected_files = {f"{item['sku']}.png" for item in source_catalog}

    # 移除已從 AR catalog 排除的舊 PNG，避免模特圖或污染圖繼續留在前台。
    for existing in OUT_DIR.glob('*.png'):
        if existing.name not in expected_files and existing.name != 'wrines-earring.png':
            existing.unlink()
            print(f'REMOVED stale asset: {existing.name}')

    for item in source_catalog:
        sku = item['sku']
        try:
            response = session.get(item['source_image_url'], timeout=60)
            response.raise_for_status()
            filename = f'{sku}.png'
            size = subject_only_png(response.content, OUT_DIR / filename)
            output_catalog.append({
                **item,
                'image': filename,
                'image_px': {'width': size[0], 'height': size[1]},
                'scale_correction': item.get('scale_correction', 1.0),
                'anchor_type': item.get('anchor_type', 'earlobe'),
                'product_type': item.get('product_type', 'stud'),
                'pivot_x': item.get('pivot_x', 0.5),
                'pivot_y': item.get('pivot_y', 0.5),
                'wear_scale': item.get('wear_scale', 1.0),
                'contact_shadow': item.get('contact_shadow', 0.14),
                'sway': item.get('sway', 0.0),
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
