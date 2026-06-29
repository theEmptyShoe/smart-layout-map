import rasterio
import numpy as np
from PIL import Image

with rasterio.open("ndvi.tif") as src:
    rgb = src.read([1, 2, 3])

rgba = np.dstack((
    rgb[0],
    rgb[1],
    rgb[2],
    np.full(rgb[0].shape, 255, dtype=np.uint8)
))

Image.fromarray(rgba, "RGBA").save("data/ndvi.png")
