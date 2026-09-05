import os
import re

from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:cityops123@localhost:5433/cityops"
)

_TABLE_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def get_engine():
    return create_engine(DATABASE_URL, pool_pre_ping=True)


def next_id(conn, table: str) -> int:
    """Compute the next hand-assigned integer PK for `table`.

    This schema uses plain `INTEGER PRIMARY KEY` with no sequence/default
    on any table (seed data hand-assigns every id), so application code
    that inserts new rows has to pick an id itself. Call this with the
    same connection/transaction the INSERT will run in, so the id it
    returns can't be raced by a concurrent insert in between.
    """
    if not _TABLE_NAME_RE.match(table):
        raise ValueError(f"Invalid table name: {table!r}")
    return conn.execute(
        text(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {table}")
    ).scalar_one()
