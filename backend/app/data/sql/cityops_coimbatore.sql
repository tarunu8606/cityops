-- CITYOPS 2.0 COMBINED DATABASE

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

-- ============================================================
-- CityOps 2.0 — Synthetic Seed Data
-- Coimbatore Transit Operations
-- PostgreSQL 16
-- ============================================================

BEGIN;

-- ============================================================
-- STOPS
-- ============================================================

INSERT INTO stops
(id, name, lat, lon, is_major_hub, is_relief_point)
VALUES
(1,  'Gandhipuram',          11.0168, 76.9558, TRUE,  FALSE),
(2,  'Coimbatore Junction',  10.9985, 76.9675, TRUE,  TRUE),
(3,  'Ukkadam',              10.9925, 76.9614, TRUE,  TRUE),
(4,  'Town Hall',            10.9950, 76.9615, FALSE, FALSE),
(5,  'Oppanakara Street',    10.9970, 76.9605, FALSE, FALSE),
(6,  'RS Puram',             11.0050, 76.9500, TRUE,  FALSE),
(7,  'Saibaba Colony',       11.0180, 76.9410, FALSE, FALSE),
(8,  'Vadavalli',             11.0235, 76.9050, TRUE,  TRUE),
(9,  'Marudamalai',           11.0175, 76.8730, FALSE, FALSE),
(10, 'Thudiyalur',            11.0810, 76.9390, TRUE,  TRUE),
(11, 'G.N. Mills',            11.0510, 76.9400, FALSE, FALSE),
(12, 'Sivanandha Colony',     11.0245, 76.9465, FALSE, FALSE),
(13, 'Ganapathy',             11.0410, 76.9840, TRUE,  FALSE),
(14, 'Textool Junction',      11.0470, 76.9855, FALSE, FALSE),
(15, 'Peelamedu',             11.0300, 77.0430, TRUE,  TRUE),
(16, 'PSG Tech',              11.0245, 77.0065, FALSE, FALSE),
(17, 'Hope College',          11.0175, 77.0220, FALSE, FALSE),
(18, 'Airport',               11.0305, 77.0438, TRUE,  FALSE),
(19, 'Codissia',              11.0300, 77.0180, FALSE, FALSE),
(20, 'Singanallur',           11.0005, 77.0285, TRUE,  TRUE),
(21, 'Ondipudur',             10.9935, 77.0440, FALSE, FALSE),
(22, 'Neelambur',             11.0000, 77.0760, TRUE,  TRUE),
(23, 'Irugur',                11.0200, 77.0620, FALSE, FALSE),
(24, 'Podanur',               10.9545, 77.0015, TRUE,  TRUE),
(25, 'Eachanari',             10.9385, 76.9685, FALSE, FALSE),
(26, 'Kuniyamuthur',          10.9520, 76.9520, TRUE,  FALSE),
(27, 'Sundakkamuthur',        10.9480, 76.9280, FALSE, FALSE),
(28, 'Kovaipudur',            10.9430, 76.9180, TRUE,  TRUE),
(29, 'Kovai Medical Center',  11.0260, 76.9480, FALSE, FALSE),
(30, 'Saravanampatti',        11.0790, 77.0020, TRUE,  TRUE),
(31, 'Kalapatti',             11.0610, 77.0500, FALSE, FALSE),
(32, 'Kovilpalayam',          11.1080, 77.0060, FALSE, FALSE),
(33, 'Vilankurichi',          11.0460, 77.0250, FALSE, FALSE),
(34, 'Ramanathapuram',        10.9990, 77.0140, FALSE, FALSE),
(35, 'Sungam',                10.9810, 76.9720, FALSE, FALSE),
(36, 'Kurichi',               10.9450, 76.9820, FALSE, TRUE),
(37, 'Kuniyamuthur Bypass',   10.9610, 76.9430, FALSE, FALSE),
(38, 'KNG Pudur',             11.0180, 76.9200, FALSE, FALSE);

-- ============================================================
-- ROAD SEGMENTS
-- 80 undirected corridors represented as 160 directed segments
-- ============================================================

INSERT INTO road_segments
(id, from_stop_id, to_stop_id, distance_km, travel_time_min)
VALUES
(1,1,2,2.8,9),(2,2,1,2.8,9),
(3,2,3,1.5,6),(4,3,2,1.5,6),
(5,3,4,0.8,4),(6,4,3,0.8,4),
(7,4,5,0.5,3),(8,5,4,0.5,3),
(9,5,2,1.0,4),(10,2,5,1.0,4),
(11,2,6,1.8,7),(12,6,2,1.8,7),
(13,6,7,1.7,7),(14,7,6,1.7,7),
(15,7,12,1.5,6),(16,12,7,1.5,6),
(17,12,1,1.3,5),(18,1,12,1.3,5),
(19,7,8,4.0,12),(20,8,7,4.0,12),
(21,8,9,3.5,11),(22,9,8,3.5,11),
(23,8,38,2.4,8),(24,38,8,2.4,8),
(25,38,11,3.5,11),(26,11,38,3.5,11),
(27,11,10,3.6,12),(28,10,11,3.6,12),
(29,1,13,3.4,11),(30,13,1,3.4,11),
(31,13,14,0.9,4),(32,14,13,0.9,4),
(33,14,30,4.8,15),(34,30,14,4.8,15),
(35,30,32,3.8,12),(36,32,30,3.8,12),
(37,13,15,5.1,17),(38,15,13,5.1,17),
(39,15,18,1.2,5),(40,18,15,1.2,5),
(41,15,16,3.8,12),(42,16,15,3.8,12),
(43,16,17,2.0,7),(44,17,16,2.0,7),
(45,17,19,1.8,7),(46,19,17,1.8,7),
(47,19,33,2.0,7),(48,33,19,2.0,7),
(49,33,15,2.5,9),(50,15,33,2.5,9),
(51,15,20,4.8,15),(52,20,15,4.8,15),
(53,20,21,2.0,7),(54,21,20,2.0,7),
(55,21,22,3.7,12),(56,22,21,3.7,12),
(57,22,31,5.5,17),(58,31,22,5.5,17),
(59,31,23,4.2,13),(60,23,31,4.2,13),
(61,23,15,3.2,11),(62,15,23,3.2,11),
(63,20,34,2.0,7),(64,34,20,2.0,7),
(65,34,2,2.2,8),(66,2,34,2.2,8),
(67,34,35,2.5,9),(68,35,34,2.5,9),
(69,35,3,1.8,7),(70,3,35,1.8,7),
(71,3,24,4.2,13),(72,24,3,4.2,13),
(73,24,25,4.8,15),(74,25,24,4.8,15),
(75,25,36,2.0,7),(76,36,25,2.0,7),
(77,36,24,2.4,8),(78,24,36,2.4,8),
(79,24,37,2.8,9),(80,37,24,2.8,9),
(81,37,26,1.7,6),(82,26,37,1.7,6),
(83,26,27,2.8,9),(84,27,26,2.8,9),
(85,27,28,1.5,6),(86,28,27,1.5,6),
(87,28,8,4.2,13),(88,8,28,4.2,13),
(89,26,3,4.4,14),(90,3,26,4.4,14),
(91,15,20,4.8,15),(92,20,15,4.8,15),
(93,18,19,2.7,9),(94,19,18,2.7,9),
(95,18,31,3.8,12),(96,31,18,3.8,12),
(97,22,23,4.0,13),(98,23,22,4.0,13),
(99,30,11,4.5,14),(100,11,30,4.5,14),
(101,1,29,1.4,5),(102,29,1,1.4,5),
(103,29,12,1.8,7),(104,12,29,1.8,7),
(105,29,6,1.8,7),(106,6,29,1.8,7),
(107,11,13,3.2,10),(108,13,11,3.2,10),
(109,10,30,5.0,16),(110,30,10,5.0,16),
(111,32,10,7.0,22),(112,10,32,7.0,22),
(113,9,38,4.5,14),(114,38,9,4.5,14),
(115,19,20,3.7,12),(116,20,19,3.7,12),
(117,16,29,2.8,9),(118,29,16,2.8,9),
(119,16,33,1.8,6),(120,33,16,1.8,6),
(121,17,20,3.2,10),(122,20,17,3.2,10),
(123,19,15,2.6,9),(124,15,19,2.6,9),
(125,21,23,4.2,13),(126,23,21,4.2,13),
(127,21,34,2.1,7),(128,34,21,2.1,7),
(129,24,26,4.0,13),(130,26,24,4.0,13),
(131,26,35,3.0,10),(132,35,26,3.0,10),
(133,27,37,2.2,7),(134,37,27,2.2,7),
(135,28,37,2.8,9),(136,37,28,2.8,9),
(137,28,38,7.0,22),(138,38,28,7.0,22),
(139,30,15,5.9,18),(140,15,30,5.9,18),
(141,14,16,4.2,13),(142,16,14,4.2,13),
(143,13,17,3.8,12),(144,17,13,3.8,12),
(145,31,15,4.8,15),(146,15,31,4.8,15),
(147,23,20,3.5,11),(148,20,23,3.5,11),
(149,22,20,4.5,14),(150,20,22,4.5,14),
(151,35,24,3.5,11),(152,24,35,3.5,11),
(153,36,37,2.3,8),(154,37,36,2.3,8),
(155,37,8,4.8,15),(156,8,37,4.8,15),
(157,12,38,2.8,9),(158,38,12,2.8,9),
(159,6,1,2.5,8),(160,1,6,2.5,8);

-- ============================================================
-- ROUTES
-- ============================================================

INSERT INTO routes
(id, code, origin_stop_id, destination_stop_id, distance_km,
 estimated_travel_time_min, operating_start_time, operating_end_time,
 frequency_min, expected_bus_requirement, status)
VALUES
(1,'CBE01',1,19,15.8,54,'05:30','22:30',15,6,'ACTIVE'),
(2,'CBE02',3,10,22.4,76,'05:45','22:00',20,5,'ACTIVE'),
(3,'CBE03',6,22,17.8,60,'06:00','21:30',20,5,'ACTIVE'),
(4,'CBE04',8,20,15.2,51,'05:30','22:30',15,6,'ACTIVE'),
(5,'CBE05',24,15,18.5,62,'06:00','22:00',20,5,'ACTIVE'),
(6,'CBE06',10,28,27.5,88,'05:30','21:30',30,4,'ACTIVE'),
(7,'CBE07',30,3,23.8,77,'05:45','22:00',20,5,'ACTIVE'),
(8,'CBE08',22,2,20.4,67,'06:00','21:00',30,4,'ACTIVE'),
(9,'CBE09',28,15,18.0,59,'06:30','20:30',30,3,'PROPOSED'),
(10,'CBE10',13,24,24.0,78,'05:30','22:00',20,5,'ACTIVE');

-- ============================================================
-- ROUTE POINTS
-- ============================================================

INSERT INTO route_points
(id, route_id, stop_id, sequence_order)
VALUES
-- CBE01
(1,1,1,0),(2,1,13,1),(3,1,15,2),(4,1,19,3),

-- CBE02
(5,2,3,0),(6,2,35,1),(7,2,34,2),(8,2,20,3),
(9,2,17,4),(10,2,16,5),(11,2,15,6),(12,2,13,7),
(13,2,11,8),(14,2,10,9),

-- CBE03
(15,3,6,0),(16,3,29,1),(17,3,1,2),(18,3,13,3),
(19,3,15,4),(20,3,20,5),(21,3,21,6),(22,3,22,7),

-- CBE04
(23,4,8,0),(24,4,7,1),(25,4,6,2),(26,4,2,3),
(27,4,34,4),(28,4,20,5),

-- CBE05
(29,5,24,0),(30,5,36,1),(31,5,25,2),(32,5,24,3),
(33,5,3,4),(34,5,2,5),(35,5,13,6),(36,5,15,7),

-- CBE06
(37,6,10,0),(38,6,30,1),(39,6,13,2),(40,6,15,3),
(41,6,20,4),(42,6,34,5),(43,6,35,6),(44,6,3,7),
(45,6,26,8),(46,6,27,9),(47,6,28,10),

-- CBE07
(48,7,30,0),(49,7,14,1),(50,7,13,2),(51,7,1,3),
(52,7,2,4),(53,7,3,5),

-- CBE08
(54,8,22,0),(55,8,21,1),(56,8,20,2),(57,8,15,3),
(58,8,13,4),(59,8,1,5),(60,8,2,6),

-- CBE09
(61,9,28,0),(62,9,27,1),(63,9,26,2),(64,9,37,3),
(65,9,24,4),(66,9,36,5),(67,9,25,6),(68,9,24,7),
(69,9,3,8),(70,9,2,9),(71,9,13,10),(72,9,15,11),

-- CBE10
(73,10,13,0),(74,10,15,1),(75,10,20,2),(76,10,34,3),
(77,10,35,4),(78,10,24,5);

-- ============================================================
-- ROUTE OVERLAP SCORES
-- ============================================================

INSERT INTO route_overlap_scores
(id, route_a_id, route_b_id, overlap_pct, shared_segments,
 overlap_severity)
VALUES
(1,1,2,35.0,2,'MODERATE'),
(2,1,3,42.0,3,'MODERATE'),
(3,1,7,50.0,3,'HIGH'),
(4,2,3,38.0,3,'MODERATE'),
(5,4,8,62.0,4,'HIGH');

-- ============================================================
-- SCENARIOS
-- ============================================================

INSERT INTO scenarios
(id, name, description, origin_stop_id, destination_stop_id,
 proposed_start_time, proposed_end_time, status)
VALUES
(
 1,
 'North-East Corridor Expansion',
 'Evaluate a new corridor connecting Gandhipuram with the eastern employment and airport corridor.',
 1,
 22,
 '2026-09-01 06:00:00',
 '2026-09-01 22:00:00',
 'UNDER_REVIEW'
),
(
 2,
 'South-West Connectivity Improvement',
 'Evaluate alternatives connecting the southern residential corridor with Peelamedu.',
 28,
 15,
 '2026-09-01 06:00:00',
 '2026-09-01 21:00:00',
 'PROPOSED'
);

-- ============================================================
-- ROUTE CANDIDATES
-- ============================================================

INSERT INTO route_candidates
(id, scenario_id, candidate_code, distance_km,
 estimated_travel_time_min, overlap_pct, coverage_gain_pct,
 overlap_severity, route_score, rank, is_recommended,
 recommendation_reason, stop_ids)
VALUES
(
 1,1,'CBE01-A',15.8,42.0,52.0,8.0,'HIGH',78.4,2,FALSE,
 'High coverage but substantial overlap with the existing central corridor.',
 '{1,20,21,22}'
),
(
 2,1,'CBE01-B',13.7,37.0,24.0,15.0,'MODERATE',88.6,1,TRUE,
 'Best balance of coverage gain, travel time and lower redundancy.',
 '{1,13,15,20,21,22}'
),
(
 3,1,'CBE01-C',21.9,55.0,12.0,11.0,'LOW',71.2,3,FALSE,
 'Lowest overlap but excessive distance and operating time.',
 '{1,13,15,23,31,22}'
),
(
 4,2,'CBE02-A',8.1,27.0,34.0,9.0,'MODERATE',81.0,2,FALSE,
 'Good direct coverage but shares the southern corridor.',
 '{28,27,26,24,3,2,13,15}'
),
(
 5,2,'CBE02-B',10.6,33.0,18.0,14.0,'LOW',89.1,1,TRUE,
 'Adds coverage while limiting overlap and keeping the corridor short.',
 '{28,27,26,37,24,3,2,13,15}'
),
(
 6,2,'CBE02-C',17.3,46.0,8.0,10.0,'LOW',70.3,3,FALSE,
 'Low redundancy but inefficient detour.',
 '{28,8,7,6,2,13,15}'
);

-- ============================================================
-- BUSES
-- ============================================================

INSERT INTO buses
(id, registration_no, bus_type, capacity, status,
 available_from, available_until, current_route_id)
VALUES
(1,'TN38AB1001','CITY_STANDARD',52,'IN_SERVICE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',1),
(2,'TN38AB1002','CITY_STANDARD',52,'IN_SERVICE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',2),
(3,'TN38AB1003','CITY_STANDARD',52,'IN_SERVICE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',3),
(4,'TN38AB1004','CITY_STANDARD',52,'IN_SERVICE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',4),
(5,'TN38AB1005','CITY_STANDARD',52,'AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',NULL),
(6,'TN38AB1006','CITY_STANDARD',52,'AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',NULL),
(7,'TN38AB1007','LOW_FLOOR',45,'IN_SERVICE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',5),
(8,'TN38AB1008','LOW_FLOOR',45,'AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',NULL),
(9,'TN38AB1009','CITY_STANDARD',52,'IN_SERVICE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',6),
(10,'TN38AB1010','CITY_STANDARD',52,'IN_SERVICE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',7),
(11,'TN38AB1011','CITY_STANDARD',52,'IN_SERVICE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',8),
(12,'TN38AB1012','LOW_FLOOR',45,'AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',NULL),
(13,'TN38AB1013','CITY_STANDARD',52,'MAINTENANCE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',NULL),
(14,'TN38AB1014','CITY_STANDARD',52,'RESERVED',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',NULL),
(15,'TN38AB1015','LOW_FLOOR',45,'AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',NULL),
(16,'TN38AB1016','CITY_STANDARD',52,'AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',NULL);

-- ============================================================
-- CREW
-- ============================================================

INSERT INTO crew
(id, name, role, status, availability_start, availability_end,
 license_type, qualified_routes, max_duty_duration_min,
 max_continuous_driving_min, required_rest_min, required_break_min,
 current_utilization_pct)
VALUES
(1,'Arun','DRIVER','ON_DUTY',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE01,CBE02,CBE03,CBE04',480,240,480,30,72.00),

(2,'Bala','DRIVER','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE01,CBE05,CBE07',480,240,480,30,55.00),

(3,'Chandran','DRIVER','ON_DUTY',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE02,CBE06,CBE08',480,240,480,30,68.00),

(4,'Dinesh','DRIVER','AVAILABLE',
 '2026-09-01 06:00:00','2026-09-01 22:00:00',
 'HEAVY_MOTOR','CBE03,CBE04,CBE08',480,240,480,30,41.00),

(5,'Elango','DRIVER','RESTING',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE04,CBE05,CBE09',480,240,480,30,62.00),

(6,'Feroz','DRIVER','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE06,CBE07,CBE10',480,240,480,30,48.00),

(7,'Gopal','DRIVER','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE01,CBE03,CBE06',480,240,480,30,44.00),

(8,'Hari','DRIVER','UNAVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE02,CBE05',480,240,480,30,25.00),

(9,'Irfan','DRIVER','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE07,CBE08,CBE10',480,240,480,30,51.00),

(10,'Jagan','DRIVER','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE03,CBE04,CBE09',480,240,480,30,39.00),

(11,'Karthik','DRIVER','ON_DUTY',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE01,CBE02,CBE07',480,240,480,30,76.00),

(12,'Lokesh','DRIVER','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE05,CBE06,CBE10',480,240,480,30,47.00),

(13,'Manoj','DRIVER','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE02,CBE03,CBE08',480,240,480,30,53.00),

(14,'Naveen','DRIVER','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE04,CBE05,CBE09',480,240,480,30,36.00),

(15,'Prakash','CONDUCTOR','UNAVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'CONDUCTOR','CBE01,CBE05,CBE07,CBE06,CBE08',480,240,480,30,40.00),

(16,'Ravi','CONDUCTOR','ON_DUTY',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'CONDUCTOR','CBE01,CBE02,CBE03',480,240,480,30,71.00),

(17,'Sanjay','CONDUCTOR','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'CONDUCTOR','CBE04,CBE05,CBE06',480,240,480,30,48.00),

(18,'Tamil','CONDUCTOR','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'CONDUCTOR','CBE07,CBE08,CBE09',480,240,480,30,42.00),

(19,'Umesh','CONDUCTOR','RESTING',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'CONDUCTOR','CBE02,CBE04,CBE10',480,240,480,30,63.00),

(20,'Vijay','CONDUCTOR','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'CONDUCTOR','CBE03,CBE06,CBE10',480,240,480,30,38.00),

(21,'Waseem','CONDUCTOR','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'CONDUCTOR','CBE01,CBE05,CBE07',480,240,480,30,46.00),

(22,'Yogesh','CONDUCTOR','ON_DUTY',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'CONDUCTOR','CBE06,CBE08,CBE09',480,240,480,30,69.00),

(23,'Zahir','CONDUCTOR','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'CONDUCTOR','CBE02,CBE03,CBE04',480,240,480,30,34.00),

(24,'Ashwin','DRIVER','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE06,CBE08,CBE10',480,240,480,30,31.00),

(25,'Bharath','CONDUCTOR','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'CONDUCTOR','CBE05,CBE07,CBE09',480,240,480,30,29.00),

(26,'Charan','DRIVER','AVAILABLE',
 '2026-09-01 05:00:00','2026-09-01 23:00:00',
 'HEAVY_MOTOR','CBE01,CBE04,CBE09',480,240,480,30,35.00);

-- ============================================================
-- DUTIES
-- ============================================================

INSERT INTO duties
(id, crew_id, bus_id, route_id, trip_id, start_time, end_time,
 assignment_type, start_location_id, end_location_id, relief_point_id,
 break_duration_min, status)
VALUES
(1,1,1,1,1001,'2026-09-01 05:30:00','2026-09-01 09:30:00',
 'NORMAL',1,19,15,30,'COMPLETED'),

(2,2,2,2,1002,'2026-09-01 06:00:00','2026-09-01 10:00:00',
 'NORMAL',3,10,15,30,'IN_PROGRESS'),

(3,3,3,3,1003,'2026-09-01 06:30:00','2026-09-01 10:30:00',
 'NORMAL',6,22,20,30,'IN_PROGRESS'),

(4,4,4,4,1004,'2026-09-01 07:00:00','2026-09-01 11:00:00',
 'NORMAL',8,20,6,30,'SCHEDULED'),

(5,5,7,5,1005,'2026-09-01 07:30:00','2026-09-01 11:30:00',
 'NORMAL',24,15,3,30,'SCHEDULED'),

(6,6,9,6,1006,'2026-09-01 08:00:00','2026-09-01 12:30:00',
 'NORMAL',10,28,20,30,'SCHEDULED'),

(7,11,10,7,1007,'2026-09-01 08:30:00','2026-09-01 12:30:00',
 'NORMAL',30,3,13,30,'SCHEDULED'),

(8,13,11,8,1008,'2026-09-01 09:00:00','2026-09-01 13:00:00',
 'NORMAL',22,2,20,30,'SCHEDULED'),

(9,14,12,9,1009,'2026-09-01 10:00:00','2026-09-01 14:00:00',
 'RELIEF',28,15,26,45,'SCHEDULED'),

(10,10,14,10,1010,'2026-09-01 11:00:00','2026-09-01 15:00:00',
 'NORMAL',13,24,3,30,'SCHEDULED');

-- ============================================================
-- ASSIGNMENTS
-- ============================================================

INSERT INTO assignments
(id, duty_id, crew_id, bus_id, trip_id, assignment_type,
 attempt_number, outcome, rejection_reason)
VALUES
(1,1,1,1,1001,'NORMAL',1,'ACCEPTED',NULL),
(2,2,2,2,1002,'NORMAL',1,'ACCEPTED',NULL),
(3,3,3,3,1003,'NORMAL',1,'ACCEPTED',NULL),
(4,4,4,4,1004,'NORMAL',1,'ACCEPTED',NULL),
(5,5,15,7,1005,'NORMAL',1,'REJECTED',
 'Crew member is unavailable during the requested duty window.');

-- ============================================================
-- CONFLICTS
-- ============================================================

INSERT INTO conflicts
(id, type, severity, related_duty_id, related_route_id,
 related_trip_id, related_bus_id, related_crew_id,
 description, status, resolution_note, resolved_at)
VALUES
(
 1,
 'REST_VIOLATION',
 'HIGH',
 3,
 3,
 1003,
 3,
 3,
 'Crew member has less than the required rest interval between consecutive duties.',
 'OPEN',
 NULL,
 NULL
),
(
 2,
 'BUS_DOUBLE_BOOKING',
 'CRITICAL',
 7,
 7,
 1007,
 10,
 11,
 'Bus 10 is assigned to overlapping operational duties.',
 'OPEN',
 NULL,
 NULL
),
(
 3,
 'DUTY_OVERLAP',
 'HIGH',
 3,
 3,
 1003,
 3,
 3,
 'Crew member has overlapping duty assignments.',
 'OPEN',
 NULL,
 NULL
),
(
 4,
 'QUALIFICATION_FAILURE',
 'MEDIUM',
 5,
 5,
 1005,
 7,
 15,
 'Assigned crew qualification does not match the route requirements.',
 'OPEN',
 NULL,
 NULL
),
(
 5,
 'UNASSIGNED_DUTY',
 'HIGH',
 9,
 9,
 1009,
 12,
 NULL,
 'Relief duty has no valid driver assignment.',
 'OPEN',
 NULL,
 NULL
),
(
 6,
 'ROUTE_OVERLAP',
 'MEDIUM',
 NULL,
 1,
 NULL,
 NULL,
 NULL,
 'Candidate corridor significantly overlaps an existing active route.',
 'OPEN',
 NULL,
 NULL
),
(
 7,
 'DUTY_OVERLAP',
 'LOW',
 10,
 10,
 1010,
 14,
 10,
 'Minor operational overlap requiring schedule adjustment.',
 'RESOLVED',
 'Duty timing adjusted by operations controller.',
 '2026-09-01 16:00:00'
);

COMMIT;
