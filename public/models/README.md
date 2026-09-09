# W.RINES GLB 模型資產

此資料夾放正式耳環 `.glb` 模型。

命名建議：直接使用 SKU，例如：

```text
YC3536E_1.glb
YC5295E_1.glb
```

再於 `public/products/products.json` 對應商品加入：

```json
{
  "model_glb": "YC3536E_1.glb",
  "model_scale": 1.0
}
```

前台規則：

- 有 `model_glb`：載入真正 3D GLB 模型。
- 沒有 `model_glb`：使用程式內建 3D proxy 暫代，不再把 2D PNG 當作試戴物件貼到臉上。

建模規格建議：

- 正面朝向鏡頭。
- 商品中心置於模型中心附近。
- 垂墜款保持垂直 Y 軸方向。
- 單位與實際尺寸比例一致最佳。
- 左右耳對稱款可共用同一 GLB，由前台鏡像處理。
