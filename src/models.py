from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy import String, Float, Integer, DateTime, ForeignKey, UniqueConstraint, Index
from datetime import datetime   

class Base(DeclarativeBase):
    pass

class CoordinateTile(Base):
    __tablename__ = "coordinate_tiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sw_lat: Mapped[float] = mapped_column(Float, nullable=False)
    sw_lon: Mapped[float] = mapped_column(Float, nullable=False)
    ne_lat: Mapped[float] = mapped_column(Float, nullable=False)
    ne_lon: Mapped[float] = mapped_column(Float, nullable=False)
    last_scanned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


    __table_args__ = (
        UniqueConstraint("sw_lat", "sw_lon", "ne_lat", "ne_lon", name="uq_tile_bbox"),
    )

class FuelStation(Base):
    __tablename__ = "fuel_stations"

    id: Mapped[str] = mapped_column(String(128), primary_key=True) # bv. "xavvy_M|BEL|20711"
    title: Mapped[str | None] = mapped_column(String(128))
    type: Mapped[str | None] = mapped_column(String(64))

    # Locatie
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)

    # Adres
    street_address: Mapped[str | None] = mapped_column(String(256))
    postal_code: Mapped[str | None] = mapped_column(String(32))
    city: Mapped[str | None] = mapped_column(String(128))
    country: Mapped[str | None] = mapped_column(String(128))
    iso3_country_code: Mapped[str | None] = mapped_column(String(8), index=True)

    # Meta
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    prices = relationship("FuelStationPrice", back_populates="station", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_station_loc", "latitude", "longitude"),
    )

class FuelStationPrice(Base):
    __tablename__ = "fuel_station_prices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    station_id: Mapped[str] = mapped_column(String(128), ForeignKey("fuel_stations.id", ondelete="CASCADE"), index=True)

    fuel_name: Mapped[str | None] = mapped_column(String(128))
    fuel_type: Mapped[str | None] = mapped_column(String(64), index=True)

    value_eur_per_l: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str | None] = mapped_column(String(8))
    price_tier_value: Mapped[int | None] = mapped_column(Integer)
    price_tier_max: Mapped[int | None] = mapped_column(Integer)

    # Timestamp van opname (wanneer wij het zagen)
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    station = relationship("FuelStation", back_populates="prices")

    __table_args__ = (
        Index("idx_station_fueltype_time", "station_id", "fuel_type", "collected_at"),
    )