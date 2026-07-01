from pathlib import Path
import cv2
import json

# Configuration
INPUT_DIR = Path("data/ndvi_imgs")
OUTPUT_DIR = Path("data/ndvi_imgs_hd")
BOUNDS = Path("data/bounds.json")

UPSCALE = 4
OUTPUT_DIR.mkdir(exist_ok=True)

# Read bounds (only to verify)
with open(BOUNDS) as f:
    bounds = json.load(f)
print("Bounds loaded:")
print(bounds)

# Process images
for img_path in sorted(INPUT_DIR.glob("*.png")):
    img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
    if img is None: continue

    h, w = img.shape[:2]
    new_w = w * UPSCALE
    new_h = h * UPSCALE

    # High-quality upscaling
    img = cv2.resize(
        img,
        (new_w, new_h),
        interpolation=cv2.INTER_LANCZOS4
    )

    # Slight smoothing
    img = cv2.GaussianBlur(
        img,
        (3, 3),
        sigmaX=0.8
    )

    out_file = OUTPUT_DIR / img_path.name
    cv2.imwrite(str(out_file), img)
    print(f"{img_path.name}: {w}x{h} -> {new_w}x{new_h}")

print("\nFinished.")