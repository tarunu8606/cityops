from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db

router = APIRouter(prefix="/trips", tags=["trips"])


@router.get("", response_model=list[schemas.TripRead])
def list_trips(db: Session = Depends(get_db)):
    return db.query(models.Trip).all()


@router.get("/{trip_id}", response_model=schemas.TripRead)
def get_trip(trip_id: int, db: Session = Depends(get_db)):
    trip = db.get(models.Trip, trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    return trip


@router.post("", response_model=schemas.TripRead, status_code=201)
def create_trip(payload: schemas.TripCreate, db: Session = Depends(get_db)):
    # NOTE: no rest/conflict validation yet — that's added in Phase 3
    # via validation_service. This endpoint is raw CRUD for Phase 1 only.
    trip = models.Trip(**payload.model_dump())
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return trip
