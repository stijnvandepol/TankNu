from __future__ import annotations

from datetime import datetime
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session

from backend.config import Config
from backend.models import FuelStation

DB_URI = Config.db_uri()
engine = create_engine(DB_URI, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

app = FastAPI(title="Fuel Stations API", version="1.1")

# CORS: standaard permissief voor reads maar geen credentials. In productie: beperk origins via env.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


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


class AvgPriceOut(BaseModel):
    fuel_type: Optional[str] = None
    avg_price: Optional[float] = None
    sample_count: Optional[int] = None
    run_timestamp: datetime
    created_at: datetime


def get_session() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


LATEST_PRICE_SQL = text(
    """
    SELECT p.*
    FROM fuel_station_prices p
    JOIN (
      SELECT station_id, fuel_type, MAX(collected_at) AS max_ts
      FROM fuel_station_prices
      WHERE value_eur_per_l IS NOT NULL
        AND value_eur_per_l > 0
      GROUP BY station_id, fuel_type
    ) last
      ON last.station_id = p.station_id
     AND (last.fuel_type IS NOT DISTINCT FROM p.fuel_type)
     AND last.max_ts = p.collected_at
    WHERE p.station_id = :sid
      AND p.value_eur_per_l IS NOT NULL
      AND p.value_eur_per_l > 0
    ORDER BY p.fuel_type
    """
)

FUEL_ALIASES = {
    "E5": "EURO98",
    "E10": "EURO95",
    "B7": "DIESEL",
    "LPG": "AUTOGAS",
}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/stations/count")
def stations_count(session: Session = Depends(get_session)):
    row = session.execute(text("SELECT COUNT(1) AS c FROM fuel_stations")).mappings().first()
    return {"count": row["c"] if row else 0}


@app.get("/stations/nearby", response_model=List[StationOut])
def stations_nearby(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(10.0, gt=0, le=100),
    fuel_type: Optional[str] = Query(
        None,
        description="EURO95/E10, EURO98/E5, DIESEL/B7, AUTOGAS/LPG",
    ),
    max_price: Optional[float] = Query(None, gt=0),
    price_tier_max: Optional[int] = Query(None, ge=1, le=3),
    limit: int = Query(50, gt=0, le=500),
    include_prices: bool = Query(True),
    session: Session = Depends(get_session),
):
    ft = FUEL_ALIASES.get(fuel_type.upper(), fuel_type.upper()) if fuel_type else None

    dist_sql = text(
        """
        SELECT * FROM (
            SELECT
                fs.*,
                (6371 * ACOS(
                    LEAST(
                        1,
                        COS(RADIANS(:lat))
                        * COS(RADIANS(fs.latitude))
                        * COS(RADIANS(fs.longitude) - RADIANS(:lon))
                        + SIN(RADIANS(:lat))
                        * SIN(RADIANS(fs.latitude))
                    )
                )) AS distance_km
            FROM fuel_stations fs
            WHERE fs.latitude IS NOT NULL
              AND fs.longitude IS NOT NULL
        ) sub
        WHERE distance_km <= :radius
        ORDER BY distance_km ASC
        LIMIT :limit
        """
    )

    rows = session.execute(
        dist_sql,
        {"lat": lat, "lon": lon, "radius": radius_km, "limit": limit},
    ).mappings().all()

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
            prices = session.execute(
                LATEST_PRICE_SQL, {"sid": st.id}
            ).mappings().all()

            # filter in-Python om extra SQL-joins te voorkomen
            if ft or max_price is not None or price_tier_max is not None:
                filtered: List[PriceOut] = []
                for p in prices:
                    val = p["value_eur_per_l"]
                    if not val or val <= 0:
                        continue
                    if ft and p["fuel_type"] != ft:
                        continue
                    if max_price is not None and val > max_price:
                        continue
                    if price_tier_max is not None:
                        tier_val = p["price_tier_value"]
                        if tier_val is not None and tier_val > price_tier_max:
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
    fuel_type: str = Query(
        "EURO95",
        description="EURO95/E10, EURO98/E5, DIESEL/B7, AUTOGAS/LPG",
    ),
    price_tier_max: Optional[int] = Query(None, ge=1, le=3),
    limit: int = Query(10, gt=1, le=100),
    session: Session = Depends(get_session),
):
    ft = FUEL_ALIASES.get(fuel_type.upper(), fuel_type.upper())

    sql = text(
        """
        WITH nearest AS (
            SELECT * FROM (
                SELECT
                    fs.id, fs.title, fs.type,
                    fs.latitude, fs.longitude,
                    fs.street_address, fs.postal_code, fs.city, fs.country, fs.iso3_country_code,
                    (6371 * ACOS(
                        LEAST(
                            1,
                            COS(RADIANS(:lat))
                            * COS(RADIANS(fs.latitude))
                            * COS(RADIANS(fs.longitude) - RADIANS(:lon))
                            + SIN(RADIANS(:lat))
                            * SIN(RADIANS(fs.latitude))
                        )
                    )) AS distance_km
                FROM fuel_stations fs
                WHERE fs.latitude IS NOT NULL
                  AND fs.longitude IS NOT NULL
            ) sub
            WHERE distance_km <= :radius
        ),
        latest AS (
            SELECT p.*
            FROM fuel_station_prices p
            JOIN (
                SELECT station_id, MAX(collected_at) AS max_ts
                FROM fuel_station_prices
                WHERE fuel_type = :ft
                  AND value_eur_per_l IS NOT NULL
                  AND value_eur_per_l > 0
                GROUP BY station_id
            ) last
              ON last.station_id = p.station_id
             AND p.collected_at = last.max_ts
            WHERE p.fuel_type = :ft
              AND p.value_eur_per_l IS NOT NULL
              AND p.value_eur_per_l > 0
        )
        SELECT
            n.*,
            l.fuel_type,
            l.value_eur_per_l,
            l.currency,
            l.price_tier_value,
            l.price_tier_max,
            l.collected_at
        FROM nearest n
        JOIN latest l ON l.station_id = n.id
        WHERE (:tier_max IS NULL OR l.price_tier_value <= :tier_max)
        ORDER BY l.value_eur_per_l ASC, n.distance_km ASC
        LIMIT :limit
        """
    )

    rows = session.execute(
        sql,
        {
            "lat": lat,
            "lon": lon,
            "radius": radius_km,
            "ft": ft,
            "tier_max": price_tier_max,
            "limit": limit,
        },
    ).mappings().all()

    out: List[StationOut] = []
    for r in rows:
        out.append(
            StationOut(
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
                latest_prices=[
                    PriceOut(
                        fuel_name=None,
                        fuel_type=r["fuel_type"],
                        value_eur_per_l=r["value_eur_per_l"],
                        currency=r["currency"],
                        price_tier_value=r["price_tier_value"],
                        price_tier_max=r["price_tier_max"],
                        collected_at=r["collected_at"],
                    )
                ],
            )
        )

    return out


@app.get("/stations/search", response_model=List[StationOut])
def stations_search(
    city: Optional[str] = None,
    country_iso3: Optional[str] = None,
    brand: Optional[str] = Query(None, description="bv. Q8, ESSO"),
    limit: int = Query(100, gt=1, le=500),
    include_prices: bool = Query(False),
    session: Session = Depends(get_session),
):
    q = session.query(FuelStation)
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
        out_item = StationOut(
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
            prices = session.execute(
                LATEST_PRICE_SQL, {"sid": st.id}
            ).mappings().all()
            out_item.latest_prices = [PriceOut(**p) for p in prices]

        results.append(out_item)

    return results


@app.get("/stations/{station_id}", response_model=StationOut)
def get_station(
    station_id: str,
    session: Session = Depends(get_session),
):
    st = session.get(FuelStation, station_id)
    if not st:
        raise HTTPException(status_code=404, detail="Station not found")

    prices = session.execute(
        LATEST_PRICE_SQL, {"sid": station_id}
    ).mappings().all()
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


@app.get("/avg-prices/latest", response_model=List[AvgPriceOut])
def avg_prices_latest(session: Session = Depends(get_session)):
    sql = text(
        """
        SELECT
            ap.fuel_type,
            ap.avg_price,
            ap.sample_count,
            ap.run_timestamp,
            ap.created_at
        FROM avg_fuel_prices ap
        JOIN (
          SELECT fuel_type, MAX(run_timestamp) AS max_run
          FROM avg_fuel_prices
          GROUP BY fuel_type
        ) last
          ON last.fuel_type IS NOT DISTINCT FROM ap.fuel_type
         AND last.max_run = ap.run_timestamp
        """
    )

    rows = session.execute(sql).mappings().all()
    return [AvgPriceOut(**r) for r in rows]


@app.get("/avg-prices/history", response_model=List[AvgPriceOut])
def avg_prices_history(
    fuel_type: Optional[str] = Query(None),
    session: Session = Depends(get_session),
):
    if fuel_type:
        sql = text(
            """
            SELECT fuel_type, avg_price, sample_count, run_timestamp, created_at
            FROM avg_fuel_prices
            WHERE fuel_type = :ft
            ORDER BY run_timestamp DESC
            """
        )
        rows = session.execute(sql, {"ft": fuel_type}).mappings().all()
    else:
        sql = text(
            """
            SELECT fuel_type, avg_price, sample_count, run_timestamp, created_at
            FROM avg_fuel_prices
            ORDER BY run_timestamp DESC
            """
        )
        rows = session.execute(sql).mappings().all()

    return [AvgPriceOut(**r) for r in rows]
