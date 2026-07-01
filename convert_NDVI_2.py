import os
import numpy as np
import rasterio
from PIL import Image

INPUT_FOLDER = "NDVI"
OUTPUT_FOLDER = "data/ndvi_imgs"

os.makedirs(OUTPUT_FOLDER, exist_ok=True)

def ndvi_to_rgba(ndvi):
    ndvi = ndvi.astype(np.float32)

    # Invalid pixels
    valid = np.isfinite(ndvi)

    ndvi = np.clip(ndvi, 0, 0.8)
    norm = ndvi / 0.8

    r = np.interp(norm, [0, 0.35, 0.65, 1], [200, 255, 100, 0])
    g = np.interp(norm, [0, 0.35, 0.65, 1], [0, 200, 255, 180])
    b = np.interp(norm, [0, 0.35, 0.65, 1], [0, 0, 0, 0])

    r[~valid] = 0
    g[~valid] = 0
    b[~valid] = 0

    a = np.where(valid, 255, 0)
    rgba = np.stack([r, g, b, a], axis=-1).astype(np.uint8)
    return rgba

for year in range(2005, 2027):
    tif_path = os.path.join(INPUT_FOLDER, f"NDVI_{year}.tif")

    if not os.path.exists(tif_path):
        print(f"Missing: {tif_path}")
        continue

    with rasterio.open(tif_path) as src:
        ndvi = src.read(1)

    rgba = ndvi_to_rgba(ndvi)
    out_path = os.path.join(
        OUTPUT_FOLDER,
        f"NDVI_{year}.png"
    )

    Image.fromarray(rgba, "RGBA").save(out_path)
    print(f"Saved {out_path}")

print("Done.")
