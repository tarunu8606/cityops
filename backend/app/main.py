from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import Base, engine
from .routers import buses, crew, routes, stops, trips

Base.metadata.create_all(bind=engine)

app = FastAPI(title="CityOps API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stops.router)
app.include_router(routes.router)
app.include_router(buses.router)
app.include_router(crew.router)
app.include_router(trips.router)


@app.get("/health")
def health():
    return {"status": "ok"}
