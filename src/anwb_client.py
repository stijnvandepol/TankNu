from __future__ import annotations
import requests
from typing import Optional
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

class AnwbError(Exception):
    """Custom exception for ANWB API errors."""
    pass


class AnwbClient:
    BASE = "https://api.anwb.nl"

    def __init__(self, rate_limiter=None):
        """Maak een ANWB client aan zonder API key."""
        self.sess = requests.Session()
        self.sess.headers.update({
            "Accept": "application/json",
            "User-Agent": "fuel-station-ingest/1.0",
        })
        self.rate = rate_limiter

    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        """Doe een GET-request met retries en simpele rate limiting."""
        if self.rate:
            self.rate.wait()

        url = f"{self.BASE}{path}"
        resp = self.sess.get(url, params=params, timeout=30)

        if not resp.ok:
            raise AnwbError(f"HTTP {resp.status_code}: {resp.text[:200]}")

        return resp.json()

    @retry(
        reraise=True,
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
        retry=retry_if_exception_type(AnwbError)
    )
    def list_fuel_stations_bbox(self, sw_lat: float, sw_lon: float, ne_lat: float, ne_lon: float) -> list[dict]:
        """Geef een lijst met tankstations binnen een bounding box."""
        params = {
            "bounding-box-filter": f"{sw_lat},{sw_lon},{ne_lat},{ne_lon}",
            "type-filter": "FUEL_STATION",
        }
        data = self._get("/routing/points-of-interest/v3/all", params=params)
        return data.get("value", [])

    @retry(
        reraise=True,
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
        retry=retry_if_exception_type(AnwbError)
    )
    def get_station_details(self, station_id: str) -> Optional[dict]:
        """Geef details van één specifiek tankstation."""
        path = f"/routing/points-of-interest/v3/details/FUEL_STATION/{requests.utils.quote(station_id, safe='')}"
        data = self._get(path)
        return data.get("value")
