# W.RINES AR Try-On — Ear v6

目前已包含：
- 手機／電腦瀏覽器開啟前鏡頭
- MediaPipe Face Landmarker 單臉偵測
- 多 SKU 正式安蘋耳環切換
- 左耳／右耳／雙耳切換
- 耳環大小與垂直位置微調
- 截圖／分享試戴畫面
- 商品實際尺寸欄位 `width_mm / height_mm`
- AR 商品 PNG 採 `rembg + OpenCV` 去背流程，只保留主要飾品主體

## v6 升級重點

v6 已把原本的 2D 圖片貼耳模式改成 **Three.js 3D 試戴引擎**：

- 耳環跟著臉部姿態旋轉，不再只是平面圖片平移。
- 左右轉頭會同步改變 yaw / roll / pitch、遠近比例與透視寬度。
- 支援真正的 `.glb` 商品模型。
- `products.json` 若有 `model_glb`，會直接載入 `public/models/` 中的 GLB。
- 尚未有正式商品建模資料時，先使用幾何 proxy GLB，避免再把 2D 商品 PNG 貼到臉上。

## 批次 GLB 導入

已建立自動化：

```text
scripts/generate_glb_proxies.py
.github/workflows/generate-glb.yml
```

目前已批次產出 6 個 GLB：

- `YC4413E_1.glb`
- `YC3536E_1.glb`
- `YC5295E_1.glb`
- `YC9561E.glb`
- `YC8320E_1.glb`
- `EH-4520.glb`

`public/products/products.json` 已全部加入 `model_glb`、`model_scale` 與 `model_status`。

## GLB 商品欄位

正式模型放在：

```text
public/models/
```

商品資料：

```json
{
  "model_glb": "YC3536E_1.glb",
  "model_scale": 1.0,
  "model_status": "PROXY_GLB"
}
```

前台邏輯：

- `model_glb` 有值 → `GLTFLoader` 載入 3D GLB。
- 日後取得正式精細建模 GLB 時，可直接用同 SKU 檔名覆蓋 proxy GLB，不需重寫 AR tracking 引擎。

## 目前限制

目前安蘋 GitHub 來源主要仍是商品照片，沒有廠商原始 3D 模型。因此這 6 個檔案是依商品類型建立的 **3D proxy GLB**，目的先解決平面貼圖與轉頭無立體角度的問題；它們不是對真實商品逐毫米還原的建模檔。要做到商品外觀完全一致，仍需要正式 3D 建模或多角度掃描素材。

## 執行

```bash
npm install
npm run dev
```

正式網址：

```text
https://tracyw14108.github.io/wrines-ar-tryon/
```

## 主要結構

```text
src/main-v6.js
public/models/
public/products/products.json
scripts/generate_glb_proxies.py
```

## 尺寸

有可靠尺寸資料的 SKU 使用 `width_mm / height_mm` 進行接近實際比例的顯示；尺寸尚未核實的商品仍標記 `NEEDS_PHYSICAL_SIZE`，不宣稱精準 1:1。
