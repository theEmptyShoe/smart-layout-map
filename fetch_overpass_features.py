import requests  # type: ignore
import time
import json

# Load bounds from JSON file
with open("data/bounds.json", "r") as f:
    coords = json.load(f)

# Overpass wants: lat lon lat lon ...
poly_str = " ".join(f"{lat} {lon}" for lon, lat in coords)

queries = {
    "roads":     '["highway"]',
    "buildings": '["building"]',
    "leisure":   '["leisure"]',
    "landuse":   '["landuse"]',
    "amenities": '["amenity"]',
    "natural":   '["natural"]',
}

OVERPASS_URL = "https://overpass.kumi.systems/api/interpreter"


def osm_to_geojson(elements):
    nodes = {e["id"]: e for e in elements if e["type"] == "node"}
    features = []

    for el in elements:
        props = el.get("tags", {}).copy()
        props["osm_id"] = el["id"]
        props["osm_type"] = el["type"]

        if el["type"] == "node" and "tags" in el:
            features.append({
                "type": "Feature",
                "properties": props,
                "geometry": {
                    "type": "Point",
                    "coordinates": [el["lon"], el["lat"]]
                }
            })

        elif el["type"] == "way" and "nodes" in el:
            way_coords = []

            for nid in el["nodes"]:
                if nid in nodes:
                    n = nodes[nid]
                    way_coords.append([n["lon"], n["lat"]])

            if len(way_coords) >= 2:
                geom_type = "Polygon" if way_coords[0] == way_coords[-1] else "LineString"
                geometry = {
                    "type": geom_type,
                    "coordinates": [way_coords] if geom_type == "Polygon" else way_coords
                }

                features.append({
                    "type": "Feature",
                    "properties": props,
                    "geometry": geometry
                })

    return {
        "type": "FeatureCollection",
        "features": features
    }


for name, tag_filter in queries.items():
    print(f"Fetching {name}...")

    query = f"""
    [out:json][timeout:60];
    (
      node{tag_filter}(poly:"{poly_str}");
      way{tag_filter}(poly:"{poly_str}");
    );
    out body;
    >;
    out skel qt;
    """

    resp = requests.post(OVERPASS_URL, data={"data": query})

    if resp.status_code != 200:
        print(f"ERROR {resp.status_code} for {name}")
        continue

    data = resp.json()
    geojson = osm_to_geojson(data["elements"])

    with open(f"data/{name}.geojson", "w") as f:
        json.dump(geojson, f, indent=2)

    print(f"Saved {len(geojson['features'])} features -> data/{name}.geojson")

    time.sleep(5)

print("Done.")
