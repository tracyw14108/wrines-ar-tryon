# W.RINES AR Try-On — Ear v4

目前已包含：
- 手機／電腦瀏覽器開啟前鏡頭
- MediaPipe Face Landmarker 單臉偵測
- 多 SKU 正式安蘋耳環切換
- 左耳／右耳／雙耳切換
- 耳環大小與垂直位置微調
- 耳垂近似定位與左右轉頭補償
- 截圖／分享試戴畫面
- 商品實際尺寸欄位 `width_mm / height_mm`
- AR 商品 PNG 採 `rembg + OpenCV` 去背流程，只保留主要飾品主體

## v4 掛戴真實感

v4 不再把透明 PNG 的上緣直接貼在耳朵旁，而改為每款商品設定自己的穿耳／接觸 pivot：

- `product_type`：`stud` / `drop`
- `pivot_x` / `pivot_y`：商品圖內的穿耳點
- `wear_scale`：各款實戴比例修正
- `contact_shadow`：耳垂接觸陰影
- `sway`：垂墜耳環的微擺動強度

同時加入：
- 耳垂錨點平滑，降低鏡頭追蹤抖動
- 左右轉頭時的遠近縮放
- 遠側耳環水平透視壓縮
- 垂墜耳環依頭部移動產生微幅慣性擺動
- 接觸點淡陰影，降低「圖片浮在耳朵旁」的貼圖感

## 商品圖 QA

已將 `C747` 從 AR 商品池移除，原因是目前來源圖為模特配戴情境圖，包含耳朵／側臉，不符合 AR 純商品圖標準。

目前 AR 只保留 6 款乾淨商品來源：
- YC4413E_1
- YC3536E_1
- YC5295E_1
- YC9561E
- YC8320E_1
- EH-4520

同步腳本也會清除已從 catalog 排除的舊 PNG，避免污染圖再次留在前台。

## 執行

```bash
npm install
npm run dev
```

正式測試網址：

```text
https://tracyw14108.github.io/wrines-ar-tryon/
```

## 商品資料

```text
public/products/
public/products/products.json
data/anpin-ar-products.json
scripts/build_products.py
```

## 尺寸

有可靠尺寸資料的 SKU 使用 `width_mm / height_mm` 進行接近實際比例的顯示；尺寸尚未核實的商品會標記 `NEEDS_PHYSICAL_SIZE`，不宣稱精準 1:1。
