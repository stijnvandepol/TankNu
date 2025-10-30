from __future__ import annotations

from typing import Optional
from urllib.parse import quote

import requests
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)


class EndpointError(Exception):
    pass


class EndpointClient:
    BASE = "https://api.anwb.nl"

    def __init__(self, rate_limiter=None) -> None:
        self.sess = requests.Session()
        self.sess.headers.update(
            {
                "Accept": "application/json",
                "User-Agent": "fuel-station-ingest/1.0",
            }
        )
        self.rate = rate_limiter

    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        if self.rate:
            self.rate.wait()

        url = f"{self.BASE}{path}"
        try:
            resp = self.sess.get(url, params=params, timeout=15)
        except requests.RequestException as e:
            raise EndpointError(f"request failed: {e}") from e

        if not resp.ok:
            raise EndpointError(f"http {resp.status_code}")

        try:
            data = resp.json()
        except ValueError as e:
            raise EndpointError("invalid json") from e

        if not isinstance(data, dict):
            raise EndpointError("unexpected payload")

        return data

    @retry(
        reraise=True,
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
        retry=retry_if_exception_type(EndpointError),
    )
    def list_fuel_stations_bbox(
        self, sw_lat: float, sw_lon: float, ne_lat: float, ne_lon: float
    ) -> list[dict]:
        params = {
            "bounding-box-filter": f"{sw_lat},{sw_lon},{ne_lat},{ne_lon}",
            "type-filter": "FUEL_STATION",
        }
        data = self._get("/routing/points-of-interest/v3/all", params=params)
        value = data.get("value")
        return value if isinstance(value, list) else []

    @retry(
        reraise=True,
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
        retry=retry_if_exception_type(EndpointError),
    )
    def get_station_details(self, station_id: str) -> Optional[dict]:
        if not station_id:
            return None

        path = f"/routing/points-of-interest/v3/details/FUEL_STATION/{quote(station_id, safe='')}"
        data = self._get(path)
        value = data.get("value")
        return value if isinstance(value, dict) else None
