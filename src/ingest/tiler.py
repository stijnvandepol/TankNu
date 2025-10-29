from __future__ import annotations
from typing import Iterator


def generate_tiles(sw_lat: float, sw_lon: float, ne_lat: float, ne_lon: float, size_lat: float, size_lon: float) -> Iterator[tuple[float, float, float, float]]:
    lat = sw_lat
    while lat < ne_lat:
        next_lat = min(lat + size_lat, ne_lat)
        lon = sw_lon
        while lon < ne_lon:
            next_lon = min(lon + size_lon, ne_lon)
            yield (lat, lon, next_lat, next_lon)
            lon = next_lon
        lat = next_lat