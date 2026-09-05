import * as maplibregl from "maplibre-gl";

// MapLibre v6 loads its tile-parsing worker as a separate ESM chunk that
// Next's webpack build doesn't resolve automatically (the map silently
// never finishes loading — no tiles, no error). Point it at a static copy
// instead of the node_modules path; see public/maplibre/README.md for how
// those two files are kept in sync. Any page constructing a maplibregl.Map
// should import this module first, purely for its side effect.
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
