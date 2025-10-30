from __future__ import annotations
import logging
import time
import signal
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

from backend.config import Config
from backend.models import Base, CoordinateTile, FuelStation, FuelStationPrice, AvgFuelPrice
from .endpoint_connector import EndpointClient
from .tiler import generate_tiles
from .utils import RateLimiter

load_dotenv()

# Basis logging
logging.basicConfig(
    level=getattr(logging, Config.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(message)s",
)

engine = create_engine(Config.db_uri(), pool_pre_ping=True, echo=False, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

_shutdown = False

def handle_sigterm(*_):
    global _shutdown
    _shutdown = True
    logging.info("Stopverzoek ontvangen. Wacht tot einde huidige cyclus...")
signal.signal(signal.SIGTERM, handle_sigterm)

def upsert_station(session, payload: dict):
    s = payload
    station = session.get(FuelStation, s["id"]) or FuelStation(id=s["id"])
    station.title = s.get("title")
    station.type = s.get("type")

    coords = s.get("coordinates") or {}
    station.latitude = coords.get("latitude")
    station.longitude = coords.get("longitude")

    addr = s.get("address") or {}
    station.street_address = addr.get("streetAddress")
    station.postal_code = addr.get("postalCode")
    station.city = addr.get("city")
    station.country = addr.get("country")
    station.iso3_country_code = addr.get("iso3CountryCode")

    session.merge(station)

def insert_prices(session, station_id: str, prices: list[dict]):
    now = datetime.utcnow()
    for p in prices or []:
        rec = FuelStationPrice(
            station_id=station_id,
            fuel_name=p.get("fuelName"),
            fuel_type=p.get("fuelType"),
            value_eur_per_l=p.get("value"),
            currency=p.get("currency"),
            price_tier_value=(p.get("priceTier") or {}).get("value"),
            price_tier_max=(p.get("priceTier") or {}).get("max"),
            collected_at=now,
        )
        session.add(rec)

def ensure_tiles_exist():
    with SessionLocal() as session:
        if session.query(CoordinateTile).count() == 0:
            for (sw_lat, sw_lon, ne_lat, ne_lon) in generate_tiles(
                Config.NL_SW_LAT, Config.NL_SW_LON, Config.NL_NE_LAT, Config.NL_NE_LON,
                Config.TILE_SIZE_LAT, Config.TILE_SIZE_LON,
            ):
                session.add(CoordinateTile(sw_lat=sw_lat, sw_lon=sw_lon, ne_lat=ne_lat, ne_lon=ne_lon))
            session.commit()
            logging.info("Tiles aangemaakt")
        else:
            logging.info("Tiles bestaan al – prima.")

def ingest_cycle():
    """Eén volledige run: tiles → stations → prijzen"""
    Base.metadata.create_all(engine)
    ensure_tiles_exist()

    rate = RateLimiter(per_second=Config.REQUESTS_PER_SECOND)
    client = EndpointClient(rate_limiter=rate)

    all_ids: set[str] = set()
    with SessionLocal() as session:
        tiles = session.query(CoordinateTile).all()
        for idx, t in enumerate(tiles, start=1):
            logging.info(f"Tile {idx}/{len(tiles)}: ({t.sw_lat},{t.sw_lon})→({t.ne_lat},{t.ne_lon})")
            items = client.list_fuel_stations_bbox(t.sw_lat, t.sw_lon, t.ne_lat, t.ne_lon)
            for it in items:
                addr = (it.get("address") or {})
                iso3 = addr.get("iso3CountryCode")
                if Config.COUNTRY_FILTER and iso3 and iso3 != Config.COUNTRY_FILTER:
                    continue
                all_ids.add(it.get("id"))
            t.last_scanned_at = datetime.utcnow()
            session.add(t)
        session.commit()

    logging.info(f"Unieke stations gevonden: {len(all_ids)}")

    processed = 0
    with SessionLocal() as session:
        for sid in sorted(all_ids):
            details = client.get_station_details(sid)
            if not details:
                continue
            upsert_station(session, details)
            insert_prices(session, sid, details.get("prices") or [])
            processed += 1
            if processed % 100 == 0:
                session.commit()
                logging.info(f"{processed} stations verwerkt…")
        session.commit()
    # Bereken en sla gemiddelde prijs per brandstoftype op, gebaseerd op de laatste prijs per station
    with SessionLocal() as session:
        from sqlalchemy import text

        avg_sql = text(
            """
            WITH last AS (
              SELECT p.station_id, p.fuel_type, p.value_eur_per_l
              FROM fuel_station_prices p
              JOIN (
                SELECT station_id, fuel_type, MAX(collected_at) AS max_ts
                FROM fuel_station_prices
                WHERE value_eur_per_l IS NOT NULL AND value_eur_per_l > 0
                GROUP BY station_id, fuel_type
              ) lastp ON lastp.station_id = p.station_id AND (lastp.fuel_type <=> p.fuel_type) AND lastp.max_ts = p.collected_at
            )
            SELECT fuel_type, AVG(value_eur_per_l) AS avg_price, COUNT(*) AS cnt
            FROM last
            GROUP BY fuel_type
            """
        )

        rows = session.execute(avg_sql).mappings().all()
        now = datetime.utcnow()
        for r in rows:
            rec = AvgFuelPrice(
                fuel_type=r["fuel_type"],
                avg_price=r["avg_price"],
                sample_count=r["cnt"],
                run_timestamp=now,
            )
            session.add(rec)
        session.commit()
        logging.info(f"Gemiddelde prijzen opgeslagen ({len(rows)} brandstoftypes).")

    logging.info("Run voltooid!")

def main():
    logging.info("Start ingest-daemon (1 run per 10 minuten)")
    interval = 10 * 60  # <-- 10 minuten tussen runs 
    while not _shutdown:
        start = time.time()
        try:
            ingest_cycle()
        except Exception as e:
            logging.error(f"Fout in ingest-cycle: {e}")
        duration = time.time() - start
        logging.info(f"Cyclus duurde {duration/60:.1f} minuten. Wacht nu 10 minuten...")
        for _ in range(int(interval)):
            if _shutdown:
                break
            time.sleep(1)
    logging.info("Netjes afgesloten.")

if __name__ == "__main__":
    main()
