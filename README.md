# W.RINES AR Try-On — Ear v2

目前已包含：
- 手機／電腦瀏覽器開啟前鏡頭
- MediaPipe Face Landmarker 單臉偵測
- 多 SKU 正式安蘋耳環切換
- 左耳／右耳／雙耳切換
- 耳環大小與垂直位置微調
- 耳垂近似定位與左右轉頭補償
- 截圖／分享試戴畫面
- 商品實際尺寸欄位 `width_mm / height_mm`
- AR 商品 PNG 採 `rembg + OpenCV` 去背流程，只保留主要飾品主體，移除背景、陰影與旁邊雜物

## 執行

```bash
npm install
npm run dev
```

電腦使用：

```text
http://localhost:5173
```

正式測試網址：

```text
https://tracyw14108.github.io/wrines-ar-tryon/
```

## 商品資料

商品圖與 catalog：

```text
public/products/
public/products/products.json
```

來源資料：

```text
data/anpin-ar-products.json
```

同步腳本：

```text
scripts/build_products.py
```

同步流程會重新下載商品來源圖，以 `rembg` 去除背景，再以 OpenCV 連通區塊分析保留單一主要飾品主體，最後輸出透明 PNG。

## 尺寸

有可靠尺寸資料的 SKU 使用 `width_mm / height_mm` 進行接近實際比例的顯示；尺寸尚未核實的商品會標記 `NEEDS_PHYSICAL_SIZE`，不宣稱精準 1:1。

## Asset QA

2026-09-09：7 款 AR 耳環已重新執行 subject-only 去背與商品圖同步，並重新部署 GitHub Pages。
