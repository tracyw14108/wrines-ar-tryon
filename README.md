# W.RINES AR Try-On — Ear v7.2 PNG Angles

目前正式版本使用 **MediaPipe Face Landmarker + 透明 PNG 多角度商品圖**。

## 正式網址

```text
https://tracyw14108.github.io/wrines-ar-tryon/
```

## v7.2 已完成

- 手機／電腦瀏覽器開啟前鏡頭
- MediaPipe Face Landmarker 單臉偵測
- 6 款安蘋正式 SKU 切換
- 左耳／右耳／雙耳切換
- 耳環大小微調
- 垂直位置微調
- 截圖／分享試戴畫面
- 商品實際尺寸欄位 `width_mm / height_mm`
- 耳垂近似 anchor + 左右轉頭 tracking
- 依頭部左右轉動切換 5 個商品角度：
  - `front`
  - `left45`
  - `left90`
  - `right45`
  - `right90`

## 目前 6 款 SKU

- `YC4413E_1`｜方形珍珠幾何耳環
- `YC3536E_1`｜蝴蝶結螺絲耳環
- `YC5295E_1`｜線性流蘇耳釘
- `YC9561E`｜經典珍珠耳環
- `YC8320E_1`｜珍珠蝴蝶耳環
- `EH-4520`｜極簡五角星耳釘

## 多角度商品圖來源

正式 build 不再使用泛用幾何圖形冒充商品外觀。

`.github/workflows/deploy-pages.yml` 會先執行：

```text
scripts/generate_angle_pngs.py
```

此腳本直接讀取：

```text
public/products/SKU.png
```

也就是每款已確認的透明商品主圖，再衍生出 45° / 90° 的透視版本，因此 **front 與各角度都維持同一款商品外觀**。

輸出到：

```text
public/products/angles/SKU_front.png
public/products/angles/SKU_left45.png
public/products/angles/SKU_left90.png
public/products/angles/SKU_right45.png
public/products/angles/SKU_right90.png
```

目前共：

```text
6 SKU × 5 angles = 30 PNG
```

## 商品資料格式

`public/products/products.json`

```json
{
  "sku": "YC3536E_1",
  "render_mode": "angles",
  "angle_assets": {
    "front": "angles/YC3536E_1_front.png",
    "left45": "angles/YC3536E_1_left45.png",
    "left90": "angles/YC3536E_1_left90.png",
    "right45": "angles/YC3536E_1_right45.png",
    "right90": "angles/YC3536E_1_right90.png"
  }
}
```

## CI / Pages QA

Pages workflow 在部署前會自動檢查：

- `src/main-v7.js` JavaScript syntax
- `products.json` 必須正好有 6 SKU
- 每款必須有 5 angle assets
- 30 張圖片都必須存在
- 每張圖必須為 `RGBA`
- 每張圖必須有透明背景
- `npm install`
- `npm run build`
- `dist/index.html`
- `dist/products/products.json`
- `dist/products/angles/` 30 張 PNG

所有檢查通過後才會部署 GitHub Pages。

## 尺寸資料

目前有可靠安蘋商品頁尺寸的 SKU：

- `YC3536E_1`：6.83 × 4.25 mm
- `YC5295E_1`：8.61 × 60.67 mm

其他商品仍標記 `NEEDS_PHYSICAL_SIZE`，目前只做比例預覽，不宣稱精準 1:1。

## 重要限制

目前 45° / 90° 是以正式透明商品主圖做的 **2D 透視衍生圖**，因此可以維持商品一致性並改善平面貼圖感，但並不是廠商真正拍攝的側面照片，也不是完整 3D 重建。

若未來取得真正多角度商品攝影或正式 GLB，可直接替換對應 angle assets / model，不需要重寫臉部 tracking 架構。

## 本機執行

```bash
npm install
npm run dev
```

## 主要檔案

```text
index.html
src/main-v7.js
src/style.css
public/products/products.json
public/products/*.png
scripts/generate_angle_pngs.py
.github/workflows/deploy-pages.yml
```
