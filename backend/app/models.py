from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime
from sqlalchemy.orm import relationship

from .db import Base


class Stop(Base):
    __tablename__ = "stops"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)


class Route(Base):
    __tablename__ = "routes"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    stops = relationship(
        "RouteStop",
        back_populates="route",
        order_by="RouteStop.sequence_index",
        cascade="all, delete-orphan",
    )


class RouteStop(Base):
    __tablename__ = "route_stops"
    id = Column(Integer, primary_key=True)
    route_id = Column(Integer, ForeignKey("routes.id"), nullable=False)
    stop_id = Column(Integer, ForeignKey("stops.id"), nullable=False)
    sequence_index = Column(Integer, nullable=False)

    route = relationship("Route", back_populates="stops")
    stop = relationship("Stop")


class Bus(Base):
    __tablename__ = "buses"
    id = Column(Integer, primary_key=True)
    plate_number = Column(String, nullable=False)
    capacity = Column(Integer, nullable=False)
    status = Column(String, nullable=False, default="active")


class Crew(Base):
    __tablename__ = "crew"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    role = Column(String, nullable=False, default="driver")
    phone = Column(String, nullable=True)


class Trip(Base):
    __tablename__ = "trips"
    id = Column(Integer, primary_key=True)
    route_id = Column(Integer, ForeignKey("routes.id"), nullable=False)
    bus_id = Column(Integer, ForeignKey("buses.id"), nullable=False)
    driver_id = Column(Integer, ForeignKey("crew.id"), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)

    route = relationship("Route")
    bus = relationship("Bus")
    driver = relationship("Crew")
