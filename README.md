# Transit Tracker

A live map of buses and trains across New York State, for commuters. New Jersey and other states come later.

## Plan

1. **Live data** (done): collect real-time feeds and serve every vehicle's position from one API.
2. **The map** (done): moving dots for every vehicle, more detail when zoomed in, tap a dot for its route and next stops.
3. **Launch**: public website (done), then the iPhone app in [`mobile/`](mobile/README.md).

## Running the server

Needs [Node.js](https://nodejs.org) 22 or newer.

```powershell
cd server
npm install
copy .env.example .env   # then add your MTA Bus Time key to .env
npm start
```

The first start downloads the MTA schedules (about a minute). Then open:

- http://localhost:3000/api/vehicles: every vehicle. Add `?bbox=west,south,east,north` to get only what's on screen, or `?mode=subway,rail,bus`.
- http://localhost:3000/api/alerts: which lines have delays, suspensions or service changes right now. Add `?lines=mta-subway:A,mta-bus:M15` for the full alerts on those lines, including planned work starting in the next 3 days. They come from the MTA's service alert feed, which needs no key.
- http://localhost:3000/api/health: whether each feed is working.

Run the tests with `npm test`.

## Running the map

With the server running in one window, open a second PowerShell window:

```powershell
cd web
npm install
npm run dev
```

Then open http://localhost:5173. Dots are colored by line and appear once you zoom in to about city level. Zoom in further to see each vehicle's line and the direction it's heading, and tap one for its route and next stops. The map follows the vehicle you tap until you drag it. **Lines** opens a legend of every line color, where you can tap lines to show only those. The map is light by day and dark after sunset in New York; add `?theme=dark` or `?theme=light` to the address to force one. The share button on a train's, bus's or line's card copies a link (or opens the share sheet on phones) that opens the map on it, such as `/?line=mta-subway:A&station=A38`; a link to a train whose trip has ended opens its line. When a link is pasted into a chat or post, the server fills its preview with what it shows and the picture in `web/public/og-image.png`. The street map comes from [OpenFreeMap](https://openfreemap.org), which is free and needs no key.

## Putting it online

The site runs free on [Render](https://render.com) as one service: the server serves both the map and the live data, so there is one address and nothing to wire together. `render.yaml` describes it.

1. Sign up at https://dashboard.render.com/register with **GitHub**, and allow Render to see this repository.
2. Click **New** > **Blueprint**, pick `transit-tracker`, and enter your MTA Bus Time key when it asks for `MTA_BUSTIME_KEY`.
3. Click **Deploy Blueprint**. The first build takes about five minutes. The site is then at the `onrender.com` address shown on the service's page.

Every push to `main` redeploys it. A free Render service goes to sleep after 15 minutes with no visitors and takes about a minute to wake up and load the schedules. To keep it awake, add a free monitor at [UptimeRobot](https://uptimerobot.com) that opens `https://<your address>/api/health` every 5 minutes. Render's free hours cover one service running all month.

The free plan has 512 MB of memory; the server uses about 250 MB with every New York feed loaded.

## The iPhone app

`mobile/` is the iPhone app, built with Expo and using the same server. [mobile/README.md](mobile/README.md) has every step from trying it on your phone for free to submitting it to the App Store, all from Windows.

## Where the positions come from

| Feed | Source | Position |
| --- | --- | --- |
| MTA subway | MTA GTFS-Realtime, no key needed | Estimated |
| LIRR, Metro-North | MTA GTFS-Realtime, no key needed | GPS when the feed has it, otherwise estimated |
| MTA buses | MTA Bus Time positions and arrival predictions, free key in `MTA_BUSTIME_KEY` | GPS |

Subway trains don't report GPS. The server takes each train's predicted arrival at its next stop, works out when it left the stop before, and places it that far along the real track shape from the MTA schedule. Positions are recalculated on every request, so trains keep moving between feed updates. Each vehicle has `"source": "gps"` or `"source": "estimated"` so the map can show the difference.

To add an agency, add an entry to `server/src/feeds.ts`.
