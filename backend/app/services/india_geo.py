from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import settings


def _point_in_ring(lat: float, lon: float, ring: list[list[float]]) -> bool:
    inside = False
    for i in range(len(ring)):
        j = (i - 1) % len(ring)
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersect = (yi > lat) != (yj > lat) and lon < ((xj - xi) * (lat - yi) / ((yj - yi) or 1e-12)) + xi
        if intersect:
            inside = not inside
    return inside


def _point_in_polygon(lat: float, lon: float, polygon: list[list[list[float]]]) -> bool:
    if not polygon:
        return False
    if not _point_in_ring(lat, lon, polygon[0]):
        return False
    for hole in polygon[1:]:
        if _point_in_ring(lat, lon, hole):
            return False
    return True


def _point_in_geometry(lat: float, lon: float, geometry: dict[str, Any]) -> bool:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if gtype == "Polygon":
        return _point_in_polygon(lat, lon, coords)
    if gtype == "MultiPolygon":
        return any(_point_in_polygon(lat, lon, poly) for poly in coords)
    return False


def _bbox_for_geometry(geometry: dict[str, Any]) -> tuple[float, float, float, float] | None:
    min_lon = min_lat = float("inf")
    max_lon = max_lat = float("-inf")

    def walk(coords: Any) -> None:
        nonlocal min_lon, min_lat, max_lon, max_lat
        if isinstance(coords, (list, tuple)) and coords and isinstance(coords[0], (int, float)):
            lon, lat = float(coords[0]), float(coords[1])
            min_lon = min(min_lon, lon)
            min_lat = min(min_lat, lat)
            max_lon = max(max_lon, lon)
            max_lat = max(max_lat, lat)
            return
        if isinstance(coords, (list, tuple)):
            for item in coords:
                walk(item)

    walk(geometry.get("coordinates"))
    if min_lon == float("inf"):
        return None
    return (min_lon, min_lat, max_lon, max_lat)


def _decode_arc(topology: dict[str, Any], arc_index: int) -> list[list[float]]:
    arcs = topology.get("arcs") or []
    transform = topology.get("transform") or {}
    scale = transform.get("scale") or [1, 1]
    translate = transform.get("translate") or [0, 0]

    reverse = arc_index < 0
    idx = ~arc_index if reverse else arc_index
    raw_arc = arcs[idx]

    x = 0
    y = 0
    points: list[list[float]] = []
    for dx, dy in raw_arc:
        x += dx
        y += dy
        lon = translate[0] + x * scale[0]
        lat = translate[1] + y * scale[1]
        points.append([lon, lat])
    if reverse:
        points.reverse()
    return points


def _join_arcs(topology: dict[str, Any], arc_refs: list[int]) -> list[list[float]]:
    ring: list[list[float]] = []
    for ref in arc_refs:
        part = _decode_arc(topology, int(ref))
        if ring and part:
            ring.extend(part[1:])
        else:
            ring.extend(part)
    return ring


def _topo_geometry_to_geojson(topology: dict[str, Any], geometry: dict[str, Any]) -> dict[str, Any]:
    gtype = geometry.get("type")
    if gtype == "Polygon":
        coords = [_join_arcs(topology, ring_refs) for ring_refs in (geometry.get("arcs") or [])]
        return {"type": "Polygon", "coordinates": coords}
    if gtype == "MultiPolygon":
        polys = []
        for poly_refs in geometry.get("arcs") or []:
            polys.append([_join_arcs(topology, ring_refs) for ring_refs in poly_refs])
        return {"type": "MultiPolygon", "coordinates": polys}
    return {"type": gtype or "GeometryCollection", "coordinates": []}


def _normalized_feature(feature: dict[str, Any]) -> dict[str, Any]:
    props = feature.get("properties") or {}
    geometry = feature.get("geometry") or {}
    district = (
        props.get("district")
        or props.get("Name")
        or props.get("name")
        or feature.get("id")
    )
    state = props.get("state") or props.get("State") or props.get("st_nm")
    district_id = props.get("district_id") or props.get("d_id_11") or props.get("dt_code") or feature.get("id")
    state_code = props.get("state_code") or props.get("st_code")
    return {
        "type": "Feature",
        "properties": {
            **props,
            "district": district,
            "state": state,
            "district_id": district_id,
            "state_code": state_code,
        },
        "geometry": geometry,
        "bbox": _bbox_for_geometry(geometry),
    }


def _features_from_topology(path: Path) -> list[dict[str, Any]]:
    topology = json.loads(path.read_text(encoding="utf-8-sig"))
    objects = topology.get("objects") or {}
    if not objects:
        return []
    collection = next(iter(objects.values()))
    features: list[dict[str, Any]] = []
    for geom in collection.get("geometries") or []:
        geo = _topo_geometry_to_geojson(topology, geom)
        props = geom.get("properties") or {}
        features.append(
            _normalized_feature(
                {
                    "type": "Feature",
                    "properties": {
                        **props,
                        "district": props.get("district"),
                        "state": props.get("st_nm"),
                        "district_id": props.get("dt_code"),
                        "state_code": props.get("st_code"),
                    },
                    "geometry": geo,
                }
            )
        )
    return features


def _features_from_geojson(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if payload.get("type") != "FeatureCollection":
        return []
    return [_normalized_feature(feature) for feature in (payload.get("features") or []) if isinstance(feature, dict)]


@lru_cache(maxsize=1)
def india_district_features() -> list[dict[str, Any]]:
    topo_path = Path(settings.india_districts_topojson_path)
    if topo_path.is_file():
        return _features_from_topology(topo_path)

    up_geojson_path = Path(settings.up_districts_geojson_path)
    if up_geojson_path.is_file():
        return _features_from_geojson(up_geojson_path)

    return []


def find_district_for_point(lat: float, lon: float) -> dict[str, Any] | None:
    for feature in india_district_features():
        bbox = feature.get("bbox")
        if bbox:
            min_lon, min_lat, max_lon, max_lat = bbox
            if lon < min_lon or lon > max_lon or lat < min_lat or lat > max_lat:
                continue
        if _point_in_geometry(lat, lon, feature.get("geometry") or {}):
            return feature
    return None


def district_feature_collection(feature: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "name": f"{feature['properties'].get('district', 'district')}_{feature['properties'].get('state', 'state')}",
        "features": [
            {
                "type": "Feature",
                "properties": feature.get("properties") or {},
                "geometry": feature.get("geometry") or {},
            }
        ],
    }


def district_virtual_grid(feature: dict[str, Any], grid_size: int = 25) -> dict[str, Any]:
    geometry = feature.get("geometry") or {}
    bbox = feature.get("bbox") or _bbox_for_geometry(geometry)
    if not bbox:
        return {"type": "FeatureCollection", "features": []}
    min_lon, min_lat, max_lon, max_lat = bbox
    n = max(1, int(grid_size ** 0.5))
    lon_step = (max_lon - min_lon) / n
    lat_step = (max_lat - min_lat) / n
    district = str((feature.get("properties") or {}).get("district") or "district")
    state = str((feature.get("properties") or {}).get("state") or "state")
    features: list[dict[str, Any]] = []
    idx = 1
    for r in range(n):
        for c in range(n):
            south = min_lat + r * lat_step
            north = south + lat_step
            west = min_lon + c * lon_step
            east = west + lon_step
            center_lat = (south + north) / 2.0
            center_lon = (west + east) / 2.0
            inside = _point_in_geometry(center_lat, center_lon, geometry)
            coords = [[west, south], [east, south], [east, north], [west, north], [west, south]]
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "ward_id": f"{district.upper().replace(' ', '_')}_GRID_{idx:03d}",
                        "ward_name": f"{district} Grid {idx}",
                        "district": district,
                        "state": state,
                        "centroid_lat": center_lat,
                        "centroid_lon": center_lon,
                        "inside_boundary": inside,
                    },
                    "geometry": {"type": "Polygon", "coordinates": [coords]},
                }
            )
            idx += 1
    return {"type": "FeatureCollection", "name": f"{district}_virtual_grid", "features": features}
