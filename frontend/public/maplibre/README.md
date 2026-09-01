These two files are a straight copy of `maplibre-gl-worker.mjs` and
`maplibre-gl-shared.mjs` from `node_modules/maplibre-gl/dist/`.

MapLibre v6 loads its tile-parsing worker as a separate ESM chunk at
runtime. Next's webpack build doesn't resolve that chunk automatically —
the map silently never finishes loading (no tiles, no console error). The
fix is `maplibregl.setWorkerUrl(...)` pointed at a statically-served copy
(see `app/map/page.tsx`), so these files need to exist here rather than
only in `node_modules`.

If `maplibre-gl` is upgraded in `package.json`, re-copy both files from
the new `node_modules/maplibre-gl/dist/`:

```
cp node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs public/maplibre/
cp node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs public/maplibre/
```
