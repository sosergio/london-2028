# London 2028 map

Static GitHub Pages site (https://sosergio.github.io/london-2028/). Read `INSTRUCTIONS.md` before any change: it is the build brief, data schema and the list of features to keep.

- `index.html` is the page (markup and CSS), `js/` the MapLibre map and panel code; `data/` holds all data (CSV + JSON).
- The repository is public: never add personal details (names, home address, employer, health).
- Keep the site static and paths relative.
- Scripts are cache-busted automatically (an inline script in `index.html` adds the page's Last-Modified time to every `js/` URL via an import map); data is fetched with `cache: 'no-cache'`. Add any new module to the `mods` list there.
