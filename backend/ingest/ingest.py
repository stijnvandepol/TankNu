from __future__ import annotations

import logging
import time
import signal
from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from backend.config import Config
from backend.models import (
    Base,
    CoordinateTile,
    FuelStation,
    FuelStationPrice,
    AvgFuelPrice,
)
from .endpoint_connector import EndpointClient
from .tiler import generate_tiles
from .utils import RateLimiter


# logging setup
logging.basicConfig(
    level=getattr(logging, Config.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(message)s",
)

# db setup
engine = create_engine(
    Config.db_uri(),
    pool_pre_ping=True,
    echo=False,
    future=True,
)
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)

_shutdown = False


def _handle_sigterm(*_):
    global _shutdown
    _shutdown = True
    logging.info("Stop aangevraagd; afronden en afsluiten.")
signal.signal(signal.SIGTERM, _handle_sigterm)


def _upsert_station(session, payload: dict) -> None:
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


def _insert_prices(session, station_id: str, prices: Iterable[dict], run_ts: datetime) -> None:
    for p in prices or []:
        rec = FuelStationPrice(
            station_id=station_id,
            fuel_name=p.get("fuelName"),
            fuel_type=p.get("fuelType"),
            value_eur_per_l=p.get("value"),
            currency=p.get("currency"),
            price_tier_value=(p.get("priceTier") or {}).get("value"),
            price_tier_max=(p.get("priceTier") or {}).get("max"),
            collected_at=run_ts,
        )
        try:
            session.add(rec)
            session.flush()
        except Exception:
            session.rollback()
            logging.debug("Dubbele prijs, overgeslagen.")


def _ensure_tiles_exist() -> None:
    with SessionLocal() as session:
        exists = session.query(CoordinateTile.id).first()
        if exists:
            return

        tiles = generate_tiles(
            Config.NL_SW_LAT,
            Config.NL_SW_LON,
            Config.NL_NE_LAT,
            Config.NL_NE_LON,
            Config.TILE_SIZE_LAT,
            Config.TILE_SIZE_LON,
        )
        for (sw_lat, sw_lon, ne_lat, ne_lon) in tiles:
            session.add(
                CoordinateTile(
                    sw_lat=sw_lat,
                    sw_lon=sw_lon,
                    ne_lat=ne_lat,
                    ne_lon=ne_lon,
                )
            )
        session.commit()
        logging.info("Tiles aangemaakt.")


def _collect_station_ids(client: EndpointClient) -> list[str]:
    ids: set[str] = set()

    with SessionLocal() as session:
        tiles = session.query(CoordinateTile).all()
        total = len(tiles)

        for idx, t in enumerate(tiles, start=1):
            if _shutdown:
                break

            logging.info(f"Scan tile {idx}/{total}")
            items = client.list_fuel_stations_bbox(
                t.sw_lat,
                t.sw_lon,
                t.ne_lat,
                t.ne_lon,
            )

            for it in items:
                addr = it.get("address") or {}
                iso3 = addr.get("iso3CountryCode")

                if Config.COUNTRY_FILTER and iso3 and iso3 != Config.COUNTRY_FILTER:
                    continue

                sid = it.get("id")
                if sid:
                    ids.add(sid)

            t.last_scanned_at = datetime.utcnow()
            session.add(t)

        session.commit()

    logging.info(f"{len(ids)} stations gevonden.")
    return sorted(ids)


def _store_station_batch(client: EndpointClient, station_ids: list[str], run_ts: datetime) -> None:
    processed = 0
    with SessionLocal() as session:
        for sid in station_ids:
            if _shutdown:
                break

            details = client.get_station_details(sid)
            if not details:
                continue

            _upsert_station(session, details)
            _insert_prices(session, sid, details.get("prices") or [], run_ts)
            processed += 1

            if processed % 100 == 0:
                session.commit()
                logging.info(f"{processed} stations verwerkt.")

        session.commit()

    logging.info(f"Totaal verwerkt: {processed} stations.")


def _store_avg_prices() -> None:
    now = datetime.utcnow()

    with SessionLocal() as session:
        avg_sql = text(
            """
            WITH last AS (
              SELECT p.station_id, p.fuel_type, p.value_eur_per_l
              FROM fuel_station_prices p
              JOIN (
                SELECT station_id, fuel_type, MAX(collected_at) AS max_ts
                FROM fuel_station_prices
                WHERE value_eur_per_l IS NOT NULL
                  AND value_eur_per_l > 0
                GROUP BY station_id, fuel_type
              ) lastp
                ON lastp.station_id = p.station_id
               AND (lastp.fuel_type IS NOT DISTINCT FROM p.fuel_type)
               AND lastp.max_ts = p.collected_at
            )
            SELECT fuel_type,
                   AVG(value_eur_per_l) AS avg_price,
                   COUNT(*) AS cnt
            FROM last
            GROUP BY fuel_type
            """
        )

        rows = session.execute(avg_sql).mappings().all()

        for r in rows:
            session.add(
                AvgFuelPrice(
                    fuel_type=r["fuel_type"],
                    avg_price=r["avg_price"],
                    sample_count=r["cnt"],
                    run_timestamp=now,
                )
            )

        session.commit()

    logging.info("Gemiddelden opgeslagen.")


def _cleanup_old_prices(cutoff_ts: datetime) -> None:
    with SessionLocal() as session:
        try:
            cleanup_sql = text(
                """
                DELETE FROM fuel_station_prices
                WHERE collected_at < :cutoff
                """
            )
            session.execute(cleanup_sql, {"cutoff": cutoff_ts})
            session.commit()
            logging.info("Oude prijzen verwijderd (alleen huidige run bewaard).")
        except Exception as e:
            session.rollback()
            logging.error(f"Opruimfout: {e}")


def run_ingest_once() -> None:
    rate = RateLimiter(per_second=Config.REQUESTS_PER_SECOND)
    client = EndpointClient(rate_limiter=rate)

    run_ts = datetime.utcnow()

    station_ids = _collect_station_ids(client)
    _store_station_batch(client, station_ids, run_ts)
    _store_avg_prices()
    _cleanup_old_prices(run_ts)


def _sleep_interval(total_seconds: float) -> None:
    chunk = max(1, Config.SCHEDULER_SLEEP_CHUNK_SECONDS)
    remaining = total_seconds
    while remaining > 0 and not _shutdown:
        t = min(chunk, remaining)
        time.sleep(t)
        remaining -= t


def _next_run_at_half_past(now: datetime) -> datetime:
    target = now.replace(minute=30, second=0, microsecond=0)
    if now >= target:
        target = target + timedelta(hours=1)
    return target


def main() -> None:
    logging.info("Ingest start.")

    Base.metadata.create_all(engine)
    _ensure_tiles_exist()

    if not _shutdown:
        try:
            logging.info("Run start.")
            start_ts = time.time()
            run_ingest_once()
            logging.info(f"Run klaar in {(time.time() - start_ts):.1f}s.")
        except Exception as e:
            logging.error(f"Ingest fout: {e}")

    while not _shutdown:
        now = datetime.utcnow()
        next_run = _next_run_at_half_past(now)

        wait_seconds = (next_run - now).total_seconds()
        logging.info(
            f"Volgende run om {next_run.isoformat()}Z (in {wait_seconds/60:.1f} min)."
        )

        _sleep_interval(wait_seconds)

        if _shutdown:
            break

        try:
            logging.info("Run start.")
            start_ts = time.time()
            run_ingest_once()
            logging.info(f"Run klaar in {(time.time() - start_ts):.1f}s.")
        except Exception as e:
            logging.error(f"Ingest fout: {e}")

    logging.info("Ingest gestopt.")


if __name__ == "__main__":
    main()
