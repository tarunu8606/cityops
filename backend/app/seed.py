from datetime import datetime, timedelta

from . import models
from .db import Base, SessionLocal, engine


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(models.Stop).first():
            print("Already seeded, skipping.")
            return

        stop_names = [
            "Central Station", "Market Square", "Riverside Park", "Tech Park",
            "Old Town", "Harbor View", "University Gate", "Hilltop",
            "East Terminal", "West Terminal", "North Bridge", "South Mall",
            "Airport Road", "Lakeside", "City Hall",
        ]
        stops = []
        for i, name in enumerate(stop_names):
            s = models.Stop(name=name, lat=12.90 + i * 0.01, lng=77.50 + i * 0.012)
            db.add(s)
            stops.append(s)
        db.flush()

        def route(name, indices):
            r = models.Route(name=name)
            db.add(r)
            db.flush()
            for seq, idx in enumerate(indices):
                db.add(
                    models.RouteStop(
                        route_id=r.id, stop_id=stops[idx].id, sequence_index=seq
                    )
                )
            return r

        r1 = route("Downtown Loop", [0, 1, 2, 3, 4])
        r2 = route("Riverside Express", [2, 3, 5, 6, 7])
        r3 = route("North Line", [8, 9, 10, 11])
        r4 = route("South Connector", [4, 5, 12, 13])
        r5 = route("Airport Shuttle", [0, 1, 14])
        r6 = route("Cross Town", [7, 8, 9, 12])
        db.flush()

        buses = []
        for i in range(1, 7):
            b = models.Bus(
                plate_number=f"CTY-{100 + i}",
                capacity=40,
                status="maintenance" if i == 6 else "active",
            )
            db.add(b)
            buses.append(b)
        db.flush()

        crew = []
        for i in range(1, 9):
            c = models.Crew(name=f"Driver {i}", role="driver", phone=f"555-01{i:02d}")
            db.add(c)
            crew.append(c)
        db.flush()

        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

        def trip(route_, bus_, driver_, start_h, start_m, end_h, end_m, day_offset=0):
            start = today + timedelta(days=day_offset, hours=start_h, minutes=start_m)
            end = today + timedelta(days=day_offset, hours=end_h, minutes=end_m)
            db.add(
                models.Trip(
                    route_id=route_.id,
                    bus_id=bus_.id,
                    driver_id=driver_.id,
                    start_time=start,
                    end_time=end,
                )
            )

        # Normal trips
        trip(r1, buses[0], crew[1], 6, 0, 8, 0)
        trip(r2, buses[1], crew[2], 7, 0, 9, 30)
        trip(r3, buses[2], crew[3], 9, 0, 11, 0)
        trip(r4, buses[3], crew[4], 13, 0, 15, 0)
        trip(r5, buses[4], crew[5], 15, 0, 16, 30)
        trip(r6, buses[0], crew[6], 17, 0, 19, 0)

        # Deliberate rest-violation pair: Driver 1 gets only 6 hours between
        # shifts (below the 8h minimum) so the rest-check demo has real data.
        trip(r1, buses[1], crew[0], 14, 0, 22, 0)
        trip(r2, buses[2], crew[0], 4, 0, 6, 0, day_offset=1)

        db.commit()
        print("Seed complete: 15 stops, 6 routes, 6 buses, 8 crew, 8 trips.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
