import os

class Config:
    """
    Statische configuratie.
    Alle instellingen kunnen hier direct worden aangepast.
    """

    # Database instellingen (Postgres)
    POSTGRES_HOST = os.getenv("POSTGRES_HOST", "127.0.0.1")
    POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
    POSTGRES_DATABASE = os.getenv("POSTGRES_DB")
    POSTGRES_USER = os.getenv("POSTGRES_USER")
    POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD")

    # Nederlandse bounding box
    NL_SW_LAT = 50.750384
    NL_SW_LON = 3.3316001
    NL_NE_LAT = 53.6316
    NL_NE_LON = 7.2275102

    # Tile-grootte
    TILE_SIZE_LAT = 0.20
    TILE_SIZE_LON = 0.30

    # Overige instellingen
    REQUESTS_PER_SECOND = 20     # snelheid van API-verzoeken (Default 20, duurt ongeveer 5 minuten)
    LOG_LEVEL = "INFO"            # of DEBUG, WARNING, ERROR
    COUNTRY_FILTER = "NLD"        # gebruik None om alle landen toe te staan
    # Ingest interval (in minuten). Standaard elk uur.
    INGEST_INTERVAL_MINUTES = int(os.getenv("INGEST_INTERVAL_MINUTES", "60"))

    # Retentie voor raw price records (dagen). Alle prijsrecords ouder dan deze
    # waarde worden opgeruimd, behalve de laatste prijs per station+fuel_type.
    PRICE_RETENTION_DAYS = int(os.getenv("PRICE_RETENTION_DAYS", "7"))
    # Scheduler sleep chunk (in seconden). De scheduler slaapt in blokken van
    # maximaal deze grootte zodat we niet elke seconde wakker worden. Standaard 60s.
    SCHEDULER_SLEEP_CHUNK_SECONDS = int(os.getenv("SCHEDULER_SLEEP_CHUNK_SECONDS", "60"))

    @staticmethod
    def db_uri() -> str:
    # SQLAlchemy connection string for PostgreSQL using psycopg2
        user = Config.POSTGRES_USER or ""
        pwd = Config.POSTGRES_PASSWORD or ""
        host = Config.POSTGRES_HOST or "127.0.0.1"
        port = Config.POSTGRES_PORT or 5432
        db = Config.POSTGRES_DATABASE or ""
        return f"postgresql+psycopg2://{user}:{pwd}@{host}:{port}/{db}"
