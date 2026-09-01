from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db

router = APIRouter(prefix="/routes", tags=["routes"])


@router.get("", response_model=list[schemas.RouteRead])
def list_routes(db: Session = Depends(get_db)):
    return db.query(models.Route).all()


@router.get("/{route_id}", response_model=schemas.RouteRead)
def get_route(route_id: int, db: Session = Depends(get_db)):
    route = db.get(models.Route, route_id)
    if not route:
        raise HTTPException(404, "Route not found")
    return route


@router.post("", response_model=schemas.RouteRead, status_code=201)
def create_route(payload: schemas.RouteCreate, db: Session = Depends(get_db)):
    route = models.Route(name=payload.name)
    db.add(route)
    db.flush()
    for idx, stop_id in enumerate(payload.stop_ids):
        db.add(
            models.RouteStop(route_id=route.id, stop_id=stop_id, sequence_index=idx)
        )
    db.commit()
    db.refresh(route)
    return route
