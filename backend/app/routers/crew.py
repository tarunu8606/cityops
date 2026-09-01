from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db

router = APIRouter(prefix="/crew", tags=["crew"])


@router.get("", response_model=list[schemas.CrewRead])
def list_crew(db: Session = Depends(get_db)):
    return db.query(models.Crew).all()


@router.get("/{crew_id}", response_model=schemas.CrewRead)
def get_crew(crew_id: int, db: Session = Depends(get_db)):
    crew = db.get(models.Crew, crew_id)
    if not crew:
        raise HTTPException(404, "Crew not found")
    return crew


@router.post("", response_model=schemas.CrewRead, status_code=201)
def create_crew(payload: schemas.CrewCreate, db: Session = Depends(get_db)):
    crew = models.Crew(**payload.model_dump())
    db.add(crew)
    db.commit()
    db.refresh(crew)
    return crew
