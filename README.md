# Activity Dashboard

A private dashboard for your Strava export, or any `.gpx` / `.fit` files: a heatmap of everywhere you've been, speed and gradient maps, personal records, key stats and every activity with its route, elevation, pace and heart rate.

**Your data never leaves your browser.** The site is just static files. When you load your activities they're read and processed on your own device, and nothing is uploaded.

## Features

- **Load anything:** drop in the Strava export `.zip` as is, its folder, or loose `.gpx`, `.fit`, `.gpx.gz` and `.fit.gz` files. Drag and drop works too.
- **Key stats:** activities, distance, moving time, elevation gain, longest activity and biggest climb.
- **Maps:** heatmap (how often you've passed each street), speed, gradient, and all routes coloured by sport (click one to open it).
- **Personal records per sport:** longest distance, longest time, biggest climb, fastest average.
- **Filters:** by sport, by year or by a custom date range. Everything updates together.
- **Activity table:** sortable and searchable. Click a row for its route map and elevation, pace/speed and heart-rate profiles.
- **Remembers your data in this browser**, so you don't reload files on every visit. *Clear data* wipes it.
- Works on phones, with light and dark mode.

## Get your data from Strava

1. On strava.com: **Settings → My Account → Download or Delete Your Account → Get started → Request your archive**.
2. Strava emails you a link to a `.zip` (it can take a few hours).
3. Open the dashboard and drop the `.zip` in. No need to unzip it.

When the export includes Strava's `activities.csv`, the dashboard uses its activity names, sport types and Strava's own distance and time figures, so totals match what you see on Strava. Activities without a GPS file, such as gym sessions, still count in the stats.

## Privacy

- No server, no accounts, no analytics, no cookies.
- The page's Content-Security-Policy sets `connect-src 'none'` and `form-action 'none'`, so the browser itself prevents the page from sending your data anywhere. The only network requests are for the page's code (Leaflet, Plotly and fflate from public CDNs, pinned with integrity hashes) and the map tiles (Esri, OpenStreetMap).
- From a Strava export, only `activities.csv` and the activity files are read. Your profile, followers, messages and photos are ignored.
- Parsed data is stored in your browser's IndexedDB, on your device only.
- `.gitignore` excludes activity files and exports, so you can keep your data next to the code without committing it.

## Run it locally

Any static file server works. With Python:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly from disk doesn't work, because browsers block JavaScript modules on `file://`.

## Host it on GitHub Pages

1. Create a new **empty** repository on GitHub (no README, no licence).
2. Push this folder to it (see the commands GitHub shows for "push an existing repository").
3. In the repository, go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then branch `main` and folder `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/<repository-name>/`.

## Project layout

```
index.html        page structure + Content-Security-Policy
css/style.css     styles (light/dark tokens)
js/app.js         UI: loading, filters, stats, table, detail view
js/parse.js       Strava export / zip / GPX / CSV reading
js/fit.js         small FIT decoder (no dependency)
js/metrics.js     per-activity stats and compact tracks
js/map.js         Leaflet maps (heatmap, speed, gradient, routes)
js/charts.js      Plotly profile charts
js/store.js       IndexedDB persistence
```

No build step: edit the files and reload.
