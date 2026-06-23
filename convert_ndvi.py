import rasterio
import rasterio.mask
import numpy as np
import json
from PIL import Image

# Load polygon coords from bounds.json
with open("data/bounds.json") as f:
    coords = json.load(f)

# Ensure polygon is closed
if coords[0] != coords[-1]:
    coords.append(coords[0])

# Convert to GeoJSON geometry
shapes = [{
    "type": "Polygon",
    "coordinates": [coords]
}]

# Mask raster to polygon
with rasterio.open("RoyalPark_NDVI.tif") as src:
    out_image, out_transform = rasterio.mask.mask(
        src,
        shapes,
        crop=True,
        filled=False
    )

    bounds = rasterio.transform.array_bounds(
        out_image.shape[1],
        out_image.shape[2],
        out_transform
    )

data = out_image[0].data.astype(np.float32)
valid = ~np.ma.getmaskarray(out_image[0])

data[~valid] = np.nan

# Normalize
norm = np.clip(data, 0, 0.8) / 0.8

# Color ramp
r = np.interp(norm, [0, 0.35, 0.65, 1], [200, 255, 100, 0])
g = np.interp(norm, [0, 0.35, 0.65, 1], [0, 200, 255, 180])
b = np.interp(norm, [0, 0.35, 0.65, 1], [0, 0, 0, 0])

r = np.nan_to_num(r, nan = 0)
g = np.nan_to_num(g, nan = 0)
b = np.nan_to_num(b, nan = 0)

a = valid.astype(np.uint8) * 255

rgba = np.stack([r,g,b,a], axis=-1).astype(np.uint8)
rgba[~valid] = [0, 0, 0, 0]

Image.fromarray(rgba, "RGBA").save("data/ndvi.png")

with open("data/ndvi_bounds.json", "w") as f:
    json.dump([
        [bounds[1], bounds[0]],   # south west
        [bounds[3], bounds[2]]    # north east
    ], f)

print("Done")
