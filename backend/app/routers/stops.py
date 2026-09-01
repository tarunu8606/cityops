from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db

router = APIRouter(prefix="/stops", tags=["stops"])


@router.get("", response_model=list[schemas.StopRead])
def list_stops(db: Session = Depends(get_db)):
    return db.query(models.Stop).all()


@router.get("/{stop_id}", response_model=schemas.StopRead)
def get_stop(stop_id: int, db: Session = Depends(get_db)):
    stop = db.get(models.Stop, stop_id)
    if not stop:
        raise HTTPException(404, "Stop not found")
    return stop


@router.post("", response_model=schemas.StopRead, status_code=201)
def create_stop(payload: schemas.StopCreate, db: Session = Depends(get_db)):
    stop = models.Stop(**payload.model_dump())
    db.add(stop)
    db.commit()
    db.refresh(stop)
    return stop
