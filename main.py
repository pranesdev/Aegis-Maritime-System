import json
from shapely.geometry import shape, Point

# load boundary file
with open("boundary.geojson") as f:
    data = json.load(f)

boundary = shape(data["features"][0]["geometry"])

# example GPS (replace with real data later)
lat = 9.2
lon = 79.5

point = Point(lon, lat)

distance = point.distance(boundary)

print("Distance:", distance)

if distance < 0.01:
    print("⚠️ ALERT: Near boundary!")
else:
    print("✅ Safe")
