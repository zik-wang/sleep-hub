import re
from collections import defaultdict

path = r"d:\pro222\sleep-hub\plugins\ld2410c_3d\HLK-LD2410C.step"
text = open(path, encoding="utf-8", errors="ignore").read()
print("chars", len(text))

pts = []
for m in re.finditer(
    r"CARTESIAN_POINT\(\s*'[^']*'\s*,\s*\(\s*([^)]+)\)\s*\)", text
):
    parts = [p.strip() for p in m.group(1).split(",")]
    if len(parts) != 3:
        continue
    try:
        x, y, z = (float(p.replace(" ", "")) for p in parts)
    except ValueError:
        continue
    pts.append((x, y, z))

print("npoints", len(pts))
xs, ys, zs = zip(*pts)
print("bbox X", min(xs), max(xs), "span", max(xs) - min(xs))
print("bbox Y", min(ys), max(ys), "span", max(ys) - min(ys))
print("bbox Z", min(zs), max(zs), "span", max(zs) - min(zs))

# densest cluster: ignore far construction points
def span_of(vals, lo, hi):
    sel = [v for v in vals if lo <= v <= hi]
    return (min(sel), max(sel), max(sel) - min(sel), len(sel)) if sel else None

print("X around 150-180", span_of(xs, 140, 200))
print("Y around 20-80", span_of(ys, 20, 90))

seen = []
for m in re.finditer(r"PRODUCT\(\s*'([^']*)'\s*,\s*'([^']*)'", text):
    a = m.group(1)
    if a not in seen:
        seen.append(a)
print("PRODUCTS", seen)

# P1 header placements already known; reprint nearby AXIS points
print("--- P1 header axes ---")
m = re.search(
    r"PRODUCT\('P1','P1'.*?SHAPE_REPRESENTATION\('',\((#\d+(?:,#\d+)*)\)",
    text,
    re.S,
)
print("P1 match", bool(m))
if m:
    print(m.group(1)[:200])

# CIRCLE radii (holes)
radii = []
for m in re.finditer(r"CIRCLE\(\s*'[^']*'\s*,\s*#\d+\s*,\s*([0-9.E+-]+)\)", text):
    radii.append(float(m.group(1)))
from collections import Counter
print("circle radii top", Counter(round(r, 3) for r in radii).most_common(12))
print("ncircles", len(radii))
