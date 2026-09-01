-- ============================================================
-- CityOps 2.0 — PostgreSQL Schema
-- Coimbatore synthetic transit operations database
-- ============================================================
-- Notes on deliberate design decisions (see README.txt for full detail):
--   * trip_id (in duties/assignments/conflicts) is a LOGICAL identifier only.
--     There is no trips table in this 12-table version, so it carries no FK.
--   * qualified_routes on crew is comma-separated TEXT by design (hackathon
--     shortcut, not normalized) — e.g. 'CBE01,CBE03,CBE07'.
--   * route_candidates.stop_ids is a Postgres INTEGER[] so candidate paths
--     can be drawn on the map without adding a 13th table.
-- ============================================================

-- Safety: allows re-running this file cleanly against a fresh volume.
DROP TABLE IF EXISTS conflicts CASCADE;
DROP TABLE IF EXISTS assignments CASCADE;
DROP TABLE IF EXISTS duties CASCADE;
DROP TABLE IF EXISTS crew CASCADE;
DROP TABLE IF EXISTS buses CASCADE;
DROP TABLE IF EXISTS route_candidates CASCADE;
DROP TABLE IF EXISTS scenarios CASCADE;
DROP TABLE IF EXISTS route_overlap_scores CASCADE;
DROP TABLE IF EXISTS route_points CASCADE;
DROP TABLE IF EXISTS routes CASCADE;
DROP TABLE IF EXISTS road_segments CASCADE;
DROP TABLE IF EXISTS stops CASCADE;

-- ============================================================
-- ROUTE AGENT
-- ============================================================

-- ---------------------------------------------------------
-- stops
-- ---------------------------------------------------------
CREATE TABLE stops (
    id              INTEGER PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    lat             DECIMAL(9,6) NOT NULL,
    lon             DECIMAL(9,6) NOT NULL,
    is_major_hub    BOOLEAN NOT NULL DEFAULT FALSE,
    is_relief_point BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_stops_lat CHECK (lat BETWEEN -90 AND 90),
    CONSTRAINT chk_stops_lon CHECK (lon BETWEEN -180 AND 180)
);

CREATE INDEX idx_stops_is_major_hub ON stops (is_major_hub);
CREATE INDEX idx_stops_is_relief_point ON stops (is_relief_point);

-- ---------------------------------------------------------
-- road_segments
-- ---------------------------------------------------------
CREATE TABLE road_segments (
    id              INTEGER PRIMARY KEY,
    from_stop_id    INTEGER NOT NULL REFERENCES stops(id),
    to_stop_id      INTEGER NOT NULL REFERENCES stops(id),
    distance_km     DECIMAL(6,2) NOT NULL,
    travel_time_min DECIMAL(6,2) NOT NULL,
    CONSTRAINT chk_segments_distance_positive CHECK (distance_km > 0),
    CONSTRAINT chk_segments_time_positive CHECK (travel_time_min > 0),
    CONSTRAINT chk_segments_no_self_loop CHECK (from_stop_id <> to_stop_id)
);

CREATE INDEX idx_segments_from_stop ON road_segments (from_stop_id);
CREATE INDEX idx_segments_to_stop ON road_segments (to_stop_id);

-- ---------------------------------------------------------
-- routes
-- ---------------------------------------------------------
CREATE TABLE routes (
    id                          INTEGER PRIMARY KEY,
    code                        VARCHAR(20) NOT NULL UNIQUE,
    origin_stop_id              INTEGER NOT NULL REFERENCES stops(id),
    destination_stop_id         INTEGER NOT NULL REFERENCES stops(id),
    distance_km                 DECIMAL(6,2) NOT NULL,
    estimated_travel_time_min   DECIMAL(6,2) NOT NULL,
    operating_start_time        TIME NOT NULL,
    operating_end_time          TIME NOT NULL,
    frequency_min               INTEGER NOT NULL,
    expected_bus_requirement    INTEGER NOT NULL,
    status                      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at                  TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_routes_distance_positive CHECK (distance_km > 0),
    CONSTRAINT chk_routes_time_positive CHECK (estimated_travel_time_min > 0),
    CONSTRAINT chk_routes_frequency_positive CHECK (frequency_min > 0),
    CONSTRAINT chk_routes_bus_requirement_positive CHECK (expected_bus_requirement > 0),
    CONSTRAINT chk_routes_status CHECK (status IN ('ACTIVE', 'PROPOSED', 'SUSPENDED', 'RETIRED')),
    CONSTRAINT chk_routes_origin_dest_diff CHECK (origin_stop_id <> destination_stop_id)
);

CREATE INDEX idx_routes_status ON routes (status);
CREATE INDEX idx_routes_origin ON routes (origin_stop_id);
CREATE INDEX idx_routes_destination ON routes (destination_stop_id);

-- ---------------------------------------------------------
-- route_points
-- ---------------------------------------------------------
CREATE TABLE route_points (
    id              INTEGER PRIMARY KEY,
    route_id        INTEGER NOT NULL REFERENCES routes(id),
    stop_id         INTEGER NOT NULL REFERENCES stops(id),
    sequence_order  INTEGER NOT NULL,
    CONSTRAINT chk_route_points_sequence_positive CHECK (sequence_order >= 0),
    CONSTRAINT uq_route_points_route_sequence UNIQUE (route_id, sequence_order)
);

CREATE INDEX idx_route_points_route ON route_points (route_id);
CREATE INDEX idx_route_points_stop ON route_points (stop_id);

-- ---------------------------------------------------------
-- route_overlap_scores
-- ---------------------------------------------------------
CREATE TABLE route_overlap_scores (
    id                  INTEGER PRIMARY KEY,
    route_a_id          INTEGER NOT NULL REFERENCES routes(id),
    route_b_id          INTEGER NOT NULL REFERENCES routes(id),
    overlap_pct         DECIMAL(5,2) NOT NULL,
    shared_segments     INTEGER NOT NULL,
    overlap_severity    VARCHAR(20) NOT NULL,
    computed_at         TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_overlap_pct_range CHECK (overlap_pct BETWEEN 0 AND 100),
    CONSTRAINT chk_overlap_shared_segments_nonneg CHECK (shared_segments >= 0),
    CONSTRAINT chk_overlap_severity CHECK (overlap_severity IN ('MINIMAL', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
    CONSTRAINT chk_overlap_route_pair_diff CHECK (route_a_id <> route_b_id),
    CONSTRAINT uq_overlap_route_pair UNIQUE (route_a_id, route_b_id)
);

CREATE INDEX idx_overlap_route_a ON route_overlap_scores (route_a_id);
CREATE INDEX idx_overlap_route_b ON route_overlap_scores (route_b_id);

-- ============================================================
-- SCENARIOS (created before route_candidates, which references it)
-- ============================================================

-- ---------------------------------------------------------
-- scenarios
-- ---------------------------------------------------------
CREATE TABLE scenarios (
    id                      INTEGER PRIMARY KEY,
    name                    VARCHAR(100) NOT NULL,
    description             TEXT,
    origin_stop_id          INTEGER NOT NULL REFERENCES stops(id),
    destination_stop_id     INTEGER NOT NULL REFERENCES stops(id),
    proposed_start_time     TIMESTAMP,
    proposed_end_time       TIMESTAMP,
    status                  VARCHAR(20) NOT NULL DEFAULT 'PROPOSED',
    created_at              TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_scenarios_status CHECK (status IN ('PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
    CONSTRAINT chk_scenarios_origin_dest_diff CHECK (origin_stop_id <> destination_stop_id)
);

CREATE INDEX idx_scenarios_status ON scenarios (status);

-- ---------------------------------------------------------
-- route_candidates
-- ---------------------------------------------------------
CREATE TABLE route_candidates (
    id                          INTEGER PRIMARY KEY,
    scenario_id                 INTEGER NOT NULL REFERENCES scenarios(id),
    candidate_code               VARCHAR(20) NOT NULL,
    distance_km                  DECIMAL(6,2) NOT NULL,
    estimated_travel_time_min    DECIMAL(6,2) NOT NULL,
    overlap_pct                  DECIMAL(5,2) NOT NULL,
    coverage_gain_pct            DECIMAL(5,2) NOT NULL,
    overlap_severity             VARCHAR(20) NOT NULL,
    route_score                  DECIMAL(8,2) NOT NULL,
    rank                         INTEGER NOT NULL,
    is_recommended                BOOLEAN NOT NULL DEFAULT FALSE,
    recommendation_reason        TEXT,
    -- stop_ids: ordered path of stop IDs for this candidate, e.g. '{1,4,7,12,15}'.
    -- Not part of the original 12-table spec's column list, but required so the
    -- candidate can actually be drawn on the map (see review notes / README).
    stop_ids                     INTEGER[] NOT NULL,
    CONSTRAINT chk_candidates_distance_positive CHECK (distance_km > 0),
    CONSTRAINT chk_candidates_time_positive CHECK (estimated_travel_time_min > 0),
    CONSTRAINT chk_candidates_overlap_pct_range CHECK (overlap_pct BETWEEN 0 AND 100),
    CONSTRAINT chk_candidates_coverage_gain_range CHECK (coverage_gain_pct BETWEEN 0 AND 100),
    CONSTRAINT chk_candidates_severity CHECK (overlap_severity IN ('MINIMAL', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
    CONSTRAINT chk_candidates_rank_positive CHECK (rank > 0),
    CONSTRAINT chk_candidates_stop_ids_len CHECK (array_length(stop_ids, 1) >= 2),
    CONSTRAINT uq_candidates_scenario_code UNIQUE (scenario_id, candidate_code)
);

CREATE INDEX idx_candidates_scenario ON route_candidates (scenario_id);
CREATE INDEX idx_candidates_is_recommended ON route_candidates (is_recommended);

-- ============================================================
-- FLEET / CREW
-- ============================================================

-- ---------------------------------------------------------
-- buses
-- ---------------------------------------------------------
CREATE TABLE buses (
    id                  INTEGER PRIMARY KEY,
    registration_no     VARCHAR(20) NOT NULL UNIQUE,
    bus_type            VARCHAR(30) NOT NULL,
    capacity            INTEGER NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    available_from      TIMESTAMP,
    available_until     TIMESTAMP,
    current_route_id    INTEGER REFERENCES routes(id),
    created_at          TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_buses_capacity_positive CHECK (capacity > 0),
    CONSTRAINT chk_buses_status CHECK (status IN ('AVAILABLE', 'IN_SERVICE', 'MAINTENANCE', 'RESERVED')),
    CONSTRAINT chk_buses_availability_window CHECK (
        available_from IS NULL OR available_until IS NULL OR available_from < available_until
    )
);

CREATE INDEX idx_buses_status ON buses (status);
CREATE INDEX idx_buses_current_route ON buses (current_route_id);

-- ---------------------------------------------------------
-- crew
-- ---------------------------------------------------------
CREATE TABLE crew (
    id                              INTEGER PRIMARY KEY,
    name                            VARCHAR(100) NOT NULL,
    role                            VARCHAR(20) NOT NULL,
    status                          VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    availability_start              TIMESTAMP,
    availability_end                TIMESTAMP,
    license_type                    VARCHAR(30),
    qualified_routes                TEXT, -- comma-separated route codes, e.g. 'CBE01,CBE03,CBE07'
    max_duty_duration_min           INTEGER NOT NULL,
    max_continuous_driving_min      INTEGER NOT NULL,
    required_rest_min               INTEGER NOT NULL,
    required_break_min              INTEGER NOT NULL,
    current_utilization_pct         DECIMAL(5,2) NOT NULL DEFAULT 0,
    created_at                      TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_crew_role CHECK (role IN ('DRIVER', 'CONDUCTOR')),
    CONSTRAINT chk_crew_status CHECK (status IN ('AVAILABLE', 'ON_DUTY', 'RESTING', 'UNAVAILABLE')),
    CONSTRAINT chk_crew_availability_window CHECK (
        availability_start IS NULL OR availability_end IS NULL OR availability_start < availability_end
    ),
    CONSTRAINT chk_crew_max_duty_positive CHECK (max_duty_duration_min > 0),
    CONSTRAINT chk_crew_max_driving_positive CHECK (max_continuous_driving_min > 0),
    CONSTRAINT chk_crew_required_rest_nonneg CHECK (required_rest_min >= 0),
    CONSTRAINT chk_crew_required_break_nonneg CHECK (required_break_min >= 0),
    CONSTRAINT chk_crew_utilization_range CHECK (current_utilization_pct BETWEEN 0 AND 100)
);

CREATE INDEX idx_crew_status ON crew (status);
CREATE INDEX idx_crew_role ON crew (role);

-- ============================================================
-- SCHEDULING
-- ============================================================

-- ---------------------------------------------------------
-- duties
-- ---------------------------------------------------------
CREATE TABLE duties (
    id                  INTEGER PRIMARY KEY,
    crew_id             INTEGER REFERENCES crew(id),
    bus_id              INTEGER REFERENCES buses(id),
    route_id            INTEGER REFERENCES routes(id),
    trip_id             INTEGER, -- logical identifier only; no trips table exists in this schema version
    start_time          TIMESTAMP NOT NULL,
    end_time            TIMESTAMP NOT NULL,
    assignment_type      VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    start_location_id    INTEGER REFERENCES stops(id),
    end_location_id      INTEGER REFERENCES stops(id),
    relief_point_id      INTEGER REFERENCES stops(id),
    break_duration_min   INTEGER NOT NULL DEFAULT 0,
    status               VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    created_at           TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_duties_time_order CHECK (start_time < end_time),
    CONSTRAINT chk_duties_assignment_type CHECK (assignment_type IN ('NORMAL', 'RELIEF', 'STANDBY')),
    CONSTRAINT chk_duties_break_nonneg CHECK (break_duration_min >= 0),
    CONSTRAINT chk_duties_status CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
);

CREATE INDEX idx_duties_crew ON duties (crew_id);
CREATE INDEX idx_duties_bus ON duties (bus_id);
CREATE INDEX idx_duties_route ON duties (route_id);
CREATE INDEX idx_duties_trip ON duties (trip_id);
CREATE INDEX idx_duties_time_range ON duties (start_time, end_time);
CREATE INDEX idx_duties_status ON duties (status);

-- ---------------------------------------------------------
-- assignments
-- ---------------------------------------------------------
CREATE TABLE assignments (
    id                  INTEGER PRIMARY KEY,
    duty_id             INTEGER REFERENCES duties(id),
    crew_id             INTEGER REFERENCES crew(id),
    bus_id              INTEGER REFERENCES buses(id),
    trip_id             INTEGER, -- logical identifier only; matches duties.trip_id by convention, no FK
    assignment_type      VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    attempt_number        INTEGER NOT NULL,
    outcome              VARCHAR(20) NOT NULL,
    rejection_reason      TEXT,
    created_at           TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_assignments_type CHECK (assignment_type IN ('NORMAL', 'RELIEF', 'STANDBY')),
    CONSTRAINT chk_assignments_attempt_positive CHECK (attempt_number > 0),
    CONSTRAINT chk_assignments_outcome CHECK (outcome IN ('ACCEPTED', 'REJECTED', 'PENDING')),
    CONSTRAINT chk_assignments_rejection_reason_present CHECK (
        outcome <> 'REJECTED' OR rejection_reason IS NOT NULL
    )
);

CREATE INDEX idx_assignments_duty ON assignments (duty_id);
CREATE INDEX idx_assignments_crew ON assignments (crew_id);
CREATE INDEX idx_assignments_bus ON assignments (bus_id);
CREATE INDEX idx_assignments_outcome ON assignments (outcome);

-- ============================================================
-- OPERATIONS
-- ============================================================

-- ---------------------------------------------------------
-- conflicts
-- ---------------------------------------------------------
CREATE TABLE conflicts (
    id                  INTEGER PRIMARY KEY,
    type                VARCHAR(30) NOT NULL,
    severity            VARCHAR(10) NOT NULL,
    related_duty_id     INTEGER REFERENCES duties(id),
    related_route_id    INTEGER REFERENCES routes(id),
    related_trip_id     INTEGER, -- logical identifier only; no trips table exists in this schema version
    related_bus_id      INTEGER REFERENCES buses(id),
    related_crew_id     INTEGER REFERENCES crew(id),
    description         TEXT,
    status               VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    resolution_note      TEXT,
    created_at           TIMESTAMP NOT NULL DEFAULT now(),
    resolved_at          TIMESTAMP,
    CONSTRAINT chk_conflicts_type CHECK (type IN (
        'REST_VIOLATION', 'DUTY_OVERLAP', 'QUALIFICATION_FAILURE',
        'BUS_DOUBLE_BOOKING', 'UNASSIGNED_DUTY', 'ROUTE_OVERLAP'
    )),
    CONSTRAINT chk_conflicts_severity CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    CONSTRAINT chk_conflicts_status CHECK (status IN ('OPEN', 'RESOLVED')),
    CONSTRAINT chk_conflicts_resolution_consistency CHECK (
        (status = 'OPEN' AND resolved_at IS NULL)
        OR (status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL)
    )
);

CREATE INDEX idx_conflicts_type ON conflicts (type);
CREATE INDEX idx_conflicts_severity ON conflicts (severity);
CREATE INDEX idx_conflicts_status ON conflicts (status);
CREATE INDEX idx_conflicts_related_duty ON conflicts (related_duty_id);
CREATE INDEX idx_conflicts_related_crew ON conflicts (related_crew_id);
CREATE INDEX idx_conflicts_related_bus ON conflicts (related_bus_id);
