import os

from sqlalchemy import create_engine

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:cityops123@localhost:5433/cityops"
)


def get_engine():
    return create_engine(DATABASE_URL)
