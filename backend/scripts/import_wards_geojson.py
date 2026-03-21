from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


from sqlalchemy import select

from app.db.session import SessionLocal, init_db
from app.models.entities import City, Ward


def _sanitize_id(text: str) -> str:
    s = "".join(ch if ch.isalnum() else "_" for ch in (text or "").strip().upper()).strip("_")
    return s or "UNKNOWN"


def _iter_coords(geom: dict[str, Any]) -> list[list[list[tuple[float, float]]]]:
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not coords:
        return []
    if gtype == "Polygon":
        # polygon -> [rings]
        return [[[(float(x), float(y)) for x, y in ring] for ring in coords]]
    if gtype == "MultiPolygon":
        # multipolygon -> [polygon[rings]]
        polys = []
        for poly in coords:
            polys.append([[(float(x), float(y)) for x, y in ring] for ring in poly])
        return polys
    return []


def _ring_centroid(ring: list[tuple[float, float]]) -> tuple[float, float]:
    # Planar centroid (lon,lat). Good enough for small areas.
    if not ring:
        return (0.0, 0.0)
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    a = 0.0
    cx = 0.0
    cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    a *= 0.5
    if abs(a) < 1e-12:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return (sum(xs) / len(xs), sum(ys) / len(ys))
    cx /= 6.0 * a
    cy /= 6.0 * a
    return (cx, cy)


def _polygon_wkt(rings: list[list[tuple[float, float]]]) -> str:
    def fmt_ring(r: list[tuple[float, float]]) -> str:
        if not r:
            return ""
        if r[0] != r[-1]:
            r = r + [r[0]]
        return "(" + ", ".join(f"{x} {y}" for x, y in r) + ")"

    parts = [fmt_ring(r) for r in rings if r]
    if not parts:
        return ""
    return "POLYGON(" + ", ".join(parts) + ")"


def _multipolygon_wkt(polys: list[list[list[tuple[float, float]]]]) -> str:
    parts = []
    for rings in polys:
        poly = _polygon_wkt(rings)
        if poly.startswith("POLYGON(") and poly.endswith(")"):
            parts.append("(" + poly[len("POLYGON(") : -1] + ")")
    if not parts:
        return ""
    return "MULTIPOLYGON(" + ", ".join(parts) + ")"


def _geometry_wkt(geom: dict[str, Any]) -> str:
    polys = _iter_coords(geom)
    gtype = geom.get("type")
    if gtype == "Polygon" and polys:
        return _polygon_wkt(polys[0])
    if gtype == "MultiPolygon" and polys:
        return _multipolygon_wkt(polys)
    return ""


def _centroid_latlon(geom: dict[str, Any]) -> tuple[float | None, float | None]:
    polys = _iter_coords(geom)
    if not polys:
        return (None, None)
    # Use outer ring of largest polygon by ring area magnitude.
    best = None
    best_area = -1.0
    for rings in polys:
        if not rings or not rings[0]:
            continue
        ring = rings[0]
        # area proxy
        area = 0.0
        if ring[0] != ring[-1]:
            ring = ring + [ring[0]]
        for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
            area += x0 * y1 - x1 * y0
        area = abs(area) / 2.0
        if area > best_area:
            best_area = area
            best = rings[0]
    if not best:
        return (None, None)
    cx, cy = _ring_centroid(best)
    # WKT uses lon lat; we store centroid_lat/lon.
    return (cy, cx)


def _prop(props: dict[str, Any], key: str) -> str:
    if not key:
        return ""
    v = props.get(key)
    return "" if v is None else str(v)


def main() -> int:
    parser = argparse.ArgumentParser(description="Import ward polygons from GeoJSON into wards table.")
    parser.add_argument("--geojson", required=True, help="Path to ward GeoJSON file.")
    parser.add_argument("--city-id", default="DELHI", help="City id (default: DELHI).")
    parser.add_argument("--city-name", default="Delhi", help="City display name (default: Delhi).")
    parser.add_argument("--state-name", default="Delhi", help="State name (default: Delhi).")
    parser.add_argument("--timezone", default="Asia/Kolkata", help="Timezone (default: Asia/Kolkata).")
    parser.add_argument("--id-prop", default="ward_id", help="GeoJSON properties key for ward id (default: ward_id).")
    parser.add_argument("--name-prop", default="ward_name", help="GeoJSON properties key for ward name (default: ward_name).")
    args = parser.parse_args()

    path = Path(args.geojson)
    if not path.exists():
        raise SystemExit(f"GeoJSON not found: {path}")

    init_db()
    db = SessionLocal()
    try:
        city_id = _sanitize_id(args.city_id)
        city = db.get(City, city_id)
        if city is None:
            city = City(city_id=city_id, city_name=args.city_name, state_name=args.state_name, timezone=args.timezone)
            db.add(city)
            db.commit()

        payload = json.loads(path.read_text(encoding="utf-8"))
        feats = payload.get("features") if isinstance(payload, dict) else None
        if not isinstance(feats, list):
            raise SystemExit("Invalid GeoJSON: expected FeatureCollection with features[]")

        created = 0
        updated = 0
        skipped = 0
        for feat in feats:
            if not isinstance(feat, dict):
                continue
            geom = feat.get("geometry") or {}
            props = feat.get("properties") or {}
            if not isinstance(geom, dict) or not isinstance(props, dict):
                continue

            raw_id = _prop(props, args.id_prop) or _prop(props, "ward") or _prop(props, "name") or ""
            raw_name = _prop(props, args.name_prop) or raw_id or "Ward"
            ward_id = _sanitize_id(raw_id) if raw_id else ""
            if not ward_id:
                skipped += 1
                continue

            wkt = _geometry_wkt(geom)
            c_lat, c_lon = _centroid_latlon(geom)
            if not wkt or c_lat is None or c_lon is None or any(math.isnan(v) for v in (c_lat, c_lon)):
                skipped += 1
                continue

            row = db.get(Ward, ward_id)
            if row is None:
                row = Ward(
                    ward_id=ward_id,
                    city_id=city_id,
                    ward_name=str(raw_name).strip() or ward_id,
                    population=0,
                    sensitive_sites_count=0,
                    centroid_lat=float(c_lat),
                    centroid_lon=float(c_lon),
                    geom_wkt=wkt,
                )
                db.add(row)
                created += 1
            else:
                row.city_id = city_id
                row.ward_name = str(raw_name).strip() or row.ward_name
                row.centroid_lat = float(c_lat)
                row.centroid_lon = float(c_lon)
                row.geom_wkt = wkt
                db.add(row)
                updated += 1

        db.commit()
        total = created + updated
        print(f"Imported wards: {total} (created={created}, updated={updated}, skipped={skipped})")

        # Helpful validation query.
        count = db.scalars(select(Ward).where(Ward.city_id == city_id)).all()
        print(f"Wards in DB for city {city_id}: {len(count)}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())

