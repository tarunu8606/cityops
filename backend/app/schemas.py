from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict


class StopBase(BaseModel):
    name: str
    lat: float
    lng: float


class StopCreate(StopBase):
    pass


class StopRead(StopBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class RouteCreate(BaseModel):
    name: str
    stop_ids: List[int]


class RouteStopRead(BaseModel):
    sequence_index: int
    stop: StopRead
    model_config = ConfigDict(from_attributes=True)


class RouteRead(BaseModel):
    id: int
    name: str
    stops: List[RouteStopRead]
    model_config = ConfigDict(from_attributes=True)


class BusBase(BaseModel):
    plate_number: str
    capacity: int
    status: str = "active"


class BusCreate(BusBase):
    pass


class BusRead(BusBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class CrewBase(BaseModel):
    name: str
    role: str = "driver"
    phone: Optional[str] = None


class CrewCreate(CrewBase):
    pass


class CrewRead(CrewBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class TripBase(BaseModel):
    route_id: int
    bus_id: int
    driver_id: int
    start_time: datetime
    end_time: datetime


class TripCreate(TripBase):
    pass


class TripRead(TripBase):
    id: int
    model_config = ConfigDict(from_attributes=True)
