# W.RINES AR Try-On — Ear v1

第一版已包含：
- 手機／電腦瀏覽器開啟前鏡頭
- MediaPipe Face Landmarker 單臉偵測
- 一款示範耳環跟著左右臉側移動
- 左耳／右耳／雙耳切換
- 耳環大小與垂直位置微調

## 執行

```bash
npm install
npm run dev
```

電腦使用：

```text
http://localhost:5173
```

手機正式測試請部署到 HTTPS 網址。

## 換成正式耳環

目前示範圖：

```text
public/products/demo-earring.svg
```

正式版可改用透明背景 PNG，並修改 `src/main.js` 的 `earring.src`。

下一階段：耳垂位置精準校準、1:1 真實尺寸、頭部左右轉透視縮放、遮擋、商品選擇器、截圖。
