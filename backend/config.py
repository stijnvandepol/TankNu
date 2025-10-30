import os

class Config:
    POSTGRES_HOST = os.getenv("POSTGRES_HOST")
    POSTGRES_PORT = int(os.getenv("POSTGRES_PORT"))
    POSTGRES_DATABASE = os.getenv("POSTGRES_DB")
    POSTGRES_USER = os.getenv("POSTGRES_USER")
    POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD")

    NL_SW_LAT = 50.750384
    NL_SW_LON = 3.3316001
    NL_NE_LAT = 53.6316
    NL_NE_LON = 7.2275102

    TILE_SIZE_LAT = 0.20
    TILE_SIZE_LON = 0.30

    # throttle / ingest cadence / filtering
    REQUESTS_PER_SECOND = 20
    LOG_LEVEL = "INFO"
    COUNTRY_FILTER = ""
    INGEST_INTERVAL_MINUTES = 60 
    SCHEDULER_SLEEP_CHUNK_SECONDS = 60


    @staticmethod
    def db_uri() -> str:
        user = Config.POSTGRES_USER
        pwd = Config.POSTGRES_PASSWORD
        host = Config.POSTGRES_HOST
        port = Config.POSTGRES_PORT
        db = Config.POSTGRES_DATABASE
        return f"postgresql+psycopg2://{user}:{pwd}@{host}:{port}/{db}"
