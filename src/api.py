from __future__ import annotations
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from datetime import datetime

from .config import Config
from .models import FuelStation

DB_URI = Config.db_uri()
engine = create_engine(DB_URI, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

app = FastAPI(title="Fuel Stations API", version="1.1")

# --- CORS (pas origins aan voor productie) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Schemas ----------
class PriceOut(BaseModel):
    fuel_name: Optional[str] = None
    fuel_type: Optional[str] = None
    value_eur_per_l: Optional[float] = None
    currency: Optional[str] = None
    price_tier_value: Optional[int] = None
    price_tier_max: Optional[int] = None
    collected_at: datetime

class StationOut(BaseModel):
    id: str
    title: Optional[str] = None
    type: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    street_address: Optional[str] = None
    postal_code: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    iso3_country_code: Optional[str] = None
    distance_km: Optional[float] = None
    latest_prices: Optional[List[PriceOut]] = None

# ---------- Helpers ----------

def get_session():
    return SessionLocal()

# subquery om per fuel_type de laatste prijs te pakken voor één station
LATEST_PRICE_SQL = text(
    """
    SELECT p.* FROM fuel_station_prices p
    JOIN (
      SELECT station_id, fuel_type, MAX(collected_at) AS max_ts
      FROM fuel_station_prices
      GROUP BY station_id, fuel_type
    ) last ON last.station_id = p.station_id
          AND (last.fuel_type <=> p.fuel_type)
          AND last.max_ts = p.collected_at
    WHERE p.station_id = :sid
    ORDER BY p.fuel_type
    """
)

# alias mapping: veelgebruikte labels → interne codes
FUEL_ALIASES = {
    "E5": "EURO98",     # in praktijk vaak 98 (E5)
    "E10": "EURO95",
    "B7": "DIESEL",
    "LPG": "AUTOGAS",
}

# ---------- Endpoints ----------

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/stations/{station_id}", response_model=StationOut)
def get_station(station_id: str):
    with get_session() as s:
        st = s.get(FuelStation, station_id)
        if not st:
            raise HTTPException(status_code=404, detail="Station not found")
        prices = s.execute(LATEST_PRICE_SQL, {"sid": station_id}).mappings().all()
        latest_prices = [PriceOut(**row) for row in prices]
        return StationOut(
            id=st.id,
            title=st.title,
            type=st.type,
            latitude=st.latitude,
            longitude=st.longitude,
            street_address=st.street_address,
            postal_code=st.postal_code,
            city=st.city,
            country=st.country,
            iso3_country_code=st.iso3_country_code,
            latest_prices=latest_prices,
        )

@app.get("/stations/nearby", response_model=List[StationOut])
def stations_nearby(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(10.0, gt=0, le=100),
    fuel_type: Optional[str] = Query(None, description="Filter op fuel_type, bv. EURO95, DIESEL, AUTOGAS of alias E5/E10/B7/LPG"),
    max_price: Optional[float] = Query(None, gt=0),
    price_tier_max: Optional[int] = Query(None, ge=1, le=3),
    limit: int = Query(50, gt=0, le=500),
    include_prices: bool = Query(True),
):
    """Vind stations binnen straal, sorteer op afstand. Optionele filters op brandstof/prijs/tier."""
    if fuel_type:
        fuel_type = FUEL_ALIASES.get(fuel_type.upper(), fuel_type.upper())
    with get_session() as s:
        # Haversine in MySQL (kilometers)
        dist_sql = text(
            """
            SELECT 
              fs.*, 
              (6371 * ACOS(
                LEAST(1, COS(RADIANS(:lat))*COS(RADIANS(fs.latitude))*COS(RADIANS(fs.longitude)-RADIANS(:lon))
                     + SIN(RADIANS(:lat))*SIN(RADIANS(fs.latitude))
                )
              )) AS distance_km
            FROM fuel_stations fs
            WHERE fs.latitude IS NOT NULL AND fs.longitude IS NOT NULL
            HAVING distance_km <= :radius
            ORDER BY distance_km ASC
            LIMIT :limit
            """
        )
        rows = s.execute(dist_sql, {"lat": lat, "lon": lon, "radius": radius_km, "limit": limit}).mappings().all()

        results: List[StationOut] = []
        for row in rows:
            st = StationOut(
                id=row["id"],
                title=row["title"],
                type=row["type"],
                latitude=row["latitude"],
                longitude=row["longitude"],
                street_address=row["street_address"],
                postal_code=row["postal_code"],
                city=row["city"],
                country=row["country"],
                iso3_country_code=row["iso3_country_code"],
                distance_km=float(row["distance_km"]) if row["distance_km"] is not None else None,
            )

            if include_prices:
                prices = s.execute(LATEST_PRICE_SQL, {"sid": st.id}).mappings().all()
                if fuel_type or max_price is not None or price_tier_max is not None:
                    filtered = []
                    for p in prices:
                        if fuel_type and p["fuel_type"] != fuel_type:
                            continue
                        if max_price is not None and p["value_eur_per_l"] is not None and p["value_eur_per_l"] > max_price:
                            continue
                        if price_tier_max is not None and p["price_tier_value"] is not None and p["price_tier_value"] > price_tier_max:
                            continue
                        filtered.append(PriceOut(**p))
                    st.latest_prices = filtered
                else:
                    st.latest_prices = [PriceOut(**p) for p in prices]

            results.append(st)
        return results

@app.get("/stations/cheapest", response_model=List[StationOut])
def stations_cheapest(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(10.0, gt=0, le=100),
    fuel_type: str = Query("EURO95", description="Brandstofcode of alias (EURO95/E10, EURO98/E5, DIESEL/B7, AUTOGAS/LPG)"),
    price_tier_max: Optional[int] = Query(None, ge=1, le=3),
    limit: int = Query(10, gt=1, le=100),
):
    """Goedkoopste stations binnen straal voor opgegeven brandstof. Sorteert op prijs, dan afstand."""
    ft = FUEL_ALIASES.get(fuel_type.upper(), fuel_type.upper())
    with get_session() as s:
        sql = text(
            """
            WITH nearest AS (
              SELECT 
                fs.id, fs.title, fs.type, fs.latitude, fs.longitude,
                fs.street_address, fs.postal_code, fs.city, fs.country, fs.iso3_country_code,
                (6371 * ACOS(
                  LEAST(1, COS(RADIANS(:lat))*COS(RADIANS(fs.latitude))*COS(RADIANS(fs.longitude)-RADIANS(:lon))
                       + SIN(RADIANS(:lat))*SIN(RADIANS(fs.latitude))
                  )
                )) AS distance_km
              FROM fuel_stations fs
              WHERE fs.latitude IS NOT NULL AND fs.longitude IS NOT NULL
              HAVING distance_km <= :radius
            ), latest AS (
              SELECT p.* FROM fuel_station_prices p
              JOIN (
                SELECT station_id, MAX(collected_at) AS max_ts
                FROM fuel_station_prices
                WHERE fuel_type = :ft
                GROUP BY station_id
              ) last ON last.station_id = p.station_id AND p.collected_at = last.max_ts
              WHERE p.fuel_type = :ft
            )
            SELECT n.*, l.fuel_type, l.value_eur_per_l, l.currency, l.price_tier_value, l.price_tier_max, l.collected_at
            FROM nearest n
            JOIN latest l ON l.station_id = n.id
            WHERE (:tier_max IS NULL OR l.price_tier_value <= :tier_max)
            ORDER BY l.value_eur_per_l ASC, n.distance_km ASC
            LIMIT :limit
            """
        )
        rows = s.execute(sql, {"lat": lat, "lon": lon, "radius": radius_km, "ft": ft, "tier_max": price_tier_max, "limit": limit}).mappings().all()
        out: List[StationOut] = []
        for r in rows:
            st = StationOut(
                id=r["id"],
                title=r["title"],
                type=r["type"],
                latitude=r["latitude"],
                longitude=r["longitude"],
                street_address=r["street_address"],
                postal_code=r["postal_code"],
                city=r["city"],
                country=r["country"],
                iso3_country_code=r["iso3_country_code"],
                distance_km=float(r["distance_km"]) if r["distance_km"] is not None else None,
                latest_prices=[PriceOut(
                    fuel_name=None,
                    fuel_type=r["fuel_type"],
                    value_eur_per_l=r["value_eur_per_l"],
                    currency=r["currency"],
                    price_tier_value=r["price_tier_value"],
                    price_tier_max=r["price_tier_max"],
                    collected_at=r["collected_at"],
                )]
            )
            out.append(st)
        return out

@app.get("/stations/search", response_model=List[StationOut])
def stations_search(
    city: Optional[str] = None,
    country_iso3: Optional[str] = None,
    brand: Optional[str] = Query(None, description="Zoek op titel/merk, bv. Q8, ESSO"),
    limit: int = Query(100, gt=1, le=500),
    include_prices: bool = Query(False),
):
    from sqlalchemy import select
    with get_session() as s:
        q = s.query(FuelStation)
        if city:
            q = q.filter(FuelStation.city.ilike(f"%{city}%"))
        if country_iso3:
            q = q.filter(FuelStation.iso3_country_code == country_iso3)
        if brand:
            q = q.filter(FuelStation.title.ilike(f"%{brand}%"))
        q = q.limit(limit)
        items = q.all()

        results: List[StationOut] = []
        for st in items:
            out = StationOut(
                id=st.id,
                title=st.title,
                type=st.type,
                latitude=st.latitude,
                longitude=st.longitude,
                street_address=st.street_address,
                postal_code=st.postal_code,
                city=st.city,
                country=st.country,
                iso3_country_code=st.iso3_country_code,
            )
            if include_prices:
                prices = s.execute(LATEST_PRICE_SQL, {"sid": st.id}).mappings().all()
                out.latest_prices = [PriceOut(**p) for p in prices]
            results.append(out)
        return results