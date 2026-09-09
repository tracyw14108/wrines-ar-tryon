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
- `products.json` 若有 `model_glb`，會直接載入 `public/models/` 中的正式 GLB。
- 尚未有 GLB 的 SKU，使用 3D proxy 暫代，不再把商品 PNG 當成試戴物件貼到臉上。

## GLB 商品欄位

正式模型放在：

```text
public/models/
```

商品資料可加入：

```json
{
  "model_glb": "YC3536E_1.glb",
  "model_scale": 1.0
}
```

前台邏輯：

- `model_glb` 有值 → `GLTFLoader` 載入真正 3D 模型。
- `model_glb` 無值 → 使用 3D proxy 幾何模型。

## 目前限制

目前安蘋 GitHub 來源主要仍是商品照片，沒有廠商原始 3D 模型，因此現階段已完成的是 **GLB 架構與 3D tracking 引擎**；要讓每一款看起來完全等同實際商品，仍需為該 SKU 建立真正 GLB。

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
```

## 尺寸

有可靠尺寸資料的 SKU 使用 `width_mm / height_mm` 進行接近實際比例的顯示；尺寸尚未核實的商品仍標記 `NEEDS_PHYSICAL_SIZE`，不宣稱精準 1:1。
