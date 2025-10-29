import os

class Config:
    """
    Statische configuratie.
    Alle instellingen kunnen hier direct worden aangepast.
    """

    # Database instellingen
    MYSQL_HOST = os.getenv("MYSQL_HOST")
    MYSQL_PORT = int(os.getenv("MYSQL_PORT"))
    MYSQL_DATABASE = os.getenv("MYSQL_DATABASE")
    MYSQL_USER = os.getenv("MYSQL_USER")
    MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD")

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

    @staticmethod
    def db_uri() -> str:
        return (
            f"mysql+pymysql://{Config.MYSQL_USER}:{Config.MYSQL_PASSWORD}"
            f"@{Config.MYSQL_HOST}:{Config.MYSQL_PORT}/{Config.MYSQL_DATABASE}"
        )
