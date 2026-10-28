# GPX Dashboard

See everywhere you've run, ridden, hiked or swum: a heatmap of your routes, your personal records, and every activity with its map, elevation, pace and heart rate.

## **→ [Open the dashboard](https://pelunor.github.io/GPX-Dashboard/)**

Free, no account, no sign-up. **Your data never leaves your device:** the website reads your files inside your own browser and uploads nothing.

---

## How to use it

### 1. Download your data from Strava

1. Go to [strava.com](https://www.strava.com) on a computer and log in.
2. Click your profile picture → **Settings** → **My Account**.
3. At the bottom, under **Download or Delete Your Account**, click **Get started**.
4. Under **Download Request**, click **Request your archive**.
5. Strava emails you a download link. It usually takes from a few minutes to a few hours. Download the `.zip` file.

### 2. Load it into the dashboard

1. Open **[pelunor.github.io/GPX-Dashboard](https://pelunor.github.io/GPX-Dashboard/)**.
2. Drag the `.zip` onto the page, or click **Choose .zip or files** and select it. **No need to unzip it.**
3. Wait a few seconds to a minute while your activities are read. That's it.

Next time you open the dashboard on the same browser, your activities are still there. To add new ones later, download a fresh export (or just the new activities' files) and use **Add files**.

### Not on Strava?

Export `.gpx` or `.fit` files from Garmin Connect, Wahoo, Coros, Komoot, etc. and drop them in. Several files at once, or a whole folder, works too.

---

## What you get

| | |
|---|---|
| **Key stats** | Number of activities, total distance, moving time, elevation gain, your longest activity and your biggest climb |
| **Heatmap** | Every route you've done. The brighter the line, the more often you've been there |
| **Speed and gradient maps** | Where you go fast, and where you climb and descend |
| **Routes map** | All activities coloured by sport. Click one to open it |
| **Personal records** | For each sport: longest distance, longest time, biggest climb, fastest average pace or speed |
| **Filters** | Show only some sports, a year, or any date range. Everything updates together |
| **Activity list** | Sort and search all your activities. Click one for its route, elevation, pace/speed and heart-rate charts |

Works on computers and phones, in light and dark mode.

---

## Privacy: is my data safe?

**Yes. Nobody but you can see your activities, including the person who made this site.**

- There is no server and no database. The website is just a page, and your files are opened and processed **by your own browser, on your own device**.
- The page is technically locked so that it **cannot send data anywhere**: its security policy (`connect-src 'none'`) forbids it, and your browser enforces this. The only things it downloads are its own code and the map background images.
- Of everything in your Strava export, it only reads `activities.csv` and the activity files. Your profile, followers, messages and photos are ignored.
- Your activities are saved **only in your browser**, so they're there next time. Click **Clear data** at the top of the dashboard to delete them. Your original files are never changed.
- No accounts, no cookies, no analytics, no tracking.

**One thing to keep in mind:** the maps show exactly where you've been, including where your activities start and end, which is often home. Think twice before sharing a screenshot.

---

## Questions

**It's slow or my browser froze for a moment.**
A few hundred activities take up to a minute to read the first time. After that the dashboard opens instantly.

**Some activities have no map.**
Indoor activities (treadmill, home trainer, gym, pool) have no GPS. They still count in your stats and records.

**My totals are slightly different from Strava's.**
With a Strava export, the dashboard uses Strava's own distance and time figures, so they should match. With loose `.gpx` / `.fit` files it calculates them itself, which can differ a little.

**Does it work in my language?**
The interface is in English. Dates and numbers follow your browser's language. Activity names and sport types are read from Strava exports in English. With other languages the maps and stats still work, but names may show as the sport type.

**Can I use it on my phone?**
Yes. Loading a big Strava export is easier on a computer, though, because of the file size.

---

## For developers

The site is static: HTML, CSS and JavaScript modules with no build step. Libraries (Leaflet, Plotly, fflate) load from public CDNs, pinned with integrity hashes.

Run it locally with any static server, for example:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly from disk doesn't work, because browsers block JavaScript modules on `file://`.

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

Hosting: GitHub Pages, **Settings → Pages → Deploy from a branch → `main` / root**. `.gitignore` excludes activity files and exports, so you can keep your own data in the folder without committing it.

Not affiliated with Strava.
