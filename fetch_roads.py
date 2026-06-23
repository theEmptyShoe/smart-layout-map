"""
fetch_roads.py
Run once with: python fetch_roads.py
Saves road data from OpenStreetMap into data/roads.json
Boundary is loaded from data/bounds.json — no hardcoding needed.
"""

import json
import os
import urllib.request
import urllib.parse

bounds_path = os.path.join('data', 'bounds.json')

with open(bounds_path) as f:
    geojson = json.load(f)

# GeoJSON coordinates are [lng, lat] — flip to [lat, lng] for consistency
raw_coords = geojson['features'][0]['geometry']['coordinates'][0]
BOUNDARY = [[lat, lng] for lng, lat in raw_coords]

def inside_boundary(lat, lng, eps = 1e-9):
    """Ray-casting point-in-polygon with floating point tolerance."""
    inside = False
    j = len(BOUNDARY) - 1
    for i in range(len(BOUNDARY)):
        yi, xi = BOUNDARY[i]
        yj, xj = BOUNDARY[j]
        if (yi > lat) != (yj > lat):
            if lng < (xj - xi) * (lat - yi) / (yj - yi) + xi + eps:
                inside = not inside
        j = i
    return inside

def segment_intersection(p1, p2, p3, p4):
    """
    Returns the exact intersection point of line segment p1->p2 with p3->p4,
    or None if they don't cross within both segments.
    """
    lat1, lng1 = p1
    lat2, lng2 = p2
    lat3, lng3 = p3
    lat4, lng4 = p4

    denom = (lat1-lat2)*(lng3-lng4) - (lng1-lng2)*(lat3-lat4)
    if abs(denom) < 1e-8:
        return None  # Parallel lines

    t = ((lat1-lat3)*(lng3-lng4) - (lng1-lng3)*(lat3-lat4)) / denom
    u = -((lat1-lat2)*(lng1-lng3) - (lng1-lng2)*(lat1-lat3)) / denom  # FIXED: was mixing lat*lat and lng*lng

    if 0.0 <= t <= 1.0 and 0.0 <= u <= 1.0:
        return [lat1 + t * (lat2 - lat1), lng1 + t * (lng2 - lng1)]

    return None

def find_boundary_crossing(p1, p2):
    """Finds where the line between p1 and p2 crosses the boundary edge."""
    for i in range(len(BOUNDARY) - 1):
        pt = segment_intersection(p1, p2, BOUNDARY[i], BOUNDARY[i+1])
        if pt:
            return pt
    return None

def clip_road(geometry):
    """
    Clips a road to the boundary using exact line intersection.
    Roads that cross in and out become multiple segments, each ending
    precisely at the boundary edge — nothing is just dropped.
    """
    segments = []
    current  = []
    points   = [[p['lat'], p['lon']] for p in geometry]

    for i, pt in enumerate(points):
        is_inside = inside_boundary(pt[0], pt[1])

        if is_inside:
            # If previous point was outside, add the exact crossing-in point first
            if i > 0 and not inside_boundary(points[i-1][0], points[i-1][1]):
                crossing = find_boundary_crossing(points[i-1], pt)
                if crossing:
                    current.append(crossing)
            current.append(pt)
        else:
            # If previous point was inside, add the exact crossing-out point then close segment
            if i > 0 and inside_boundary(points[i-1][0], points[i-1][1]):
                crossing = find_boundary_crossing(points[i-1], pt)
                if crossing:
                    current.append(crossing)
                if len(current) > 1:
                    segments.append(current)
                current = []

    if len(current) > 1:
        segments.append(current)

    return segments

def fetch_roads():
    poly  = ' '.join(f'{p[0]} {p[1]}' for p in BOUNDARY)
    query = f'[out:json];way[highway](poly:"{poly}");out geom;'
    url   = 'https://overpass-api.de/api/interpreter?data=' + urllib.parse.quote(query)

    print('Fetching road data from OpenStreetMap...')

    req = urllib.request.Request(url, headers={'User-Agent': 'SAP-GreenAudit/1.0'})
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())

    return data['elements']

def main():
    elements = fetch_roads()

    all_segments = []
    for way in elements:
        if 'geometry' not in way:
            continue
        all_segments.extend(clip_road(way['geometry']))

    out_path = os.path.join('data', 'roads.json')
    with open(out_path, 'w') as f:
        json.dump(all_segments, f, indent=2)

    print(f'Done. {len(all_segments)} road segments saved to {out_path}')


if __name__ == '__main__':
    main()
