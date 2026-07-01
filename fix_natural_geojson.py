import json

with open("data/natural.geojson", "r", encoding="utf-8") as f:
    data = json.load(f)

converted = 0

for feature in data["features"]:
    geom = feature["geometry"]

    if geom["type"] == "LineString":
        coords = geom["coordinates"]

        if len(coords) >= 4 and coords[0] == coords[-1]:
            geom["type"] = "Polygon"
            geom["coordinates"] = [coords]
            converted += 1

print(f"Converted {converted} natural.")

with open("data/natural.geojson", "w") as f:
    json.dump(data, f)