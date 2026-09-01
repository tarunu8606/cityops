from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db

router = APIRouter(prefix="/buses", tags=["buses"])


@router.get("", response_model=list[schemas.BusRead])
def list_buses(db: Session = Depends(get_db)):
    return db.query(models.Bus).all()


@router.get("/{bus_id}", response_model=schemas.BusRead)
def get_bus(bus_id: int, db: Session = Depends(get_db)):
    bus = db.get(models.Bus, bus_id)
    if not bus:
        raise HTTPException(404, "Bus not found")
    return bus


@router.post("", response_model=schemas.BusRead, status_code=201)
def create_bus(payload: schemas.BusCreate, db: Session = Depends(get_db)):
    bus = models.Bus(**payload.model_dump())
    db.add(bus)
    db.commit()
    db.refresh(bus)
    return bus
