# ⚔ Torn Rank Wars

A live tracker for [Torn](https://www.torn.com)'s **Ranked Wars** — unofficial fan tool built on the official Torn API v2.

![stack](https://img.shields.io/badge/runtime-node_18+-green) ![deps](https://img.shields.io/badge/dependencies-zero-brightgreen)

## Features

- **Live Wars** — every ongoing & scheduled ranked war on Torn: both faction scores, chains, target %, dominance bar, war countdowns. Auto-refreshes (10–60 s, configurable).
- **War Room** — pick any war for a big scoreboard (scores, target, lead, end-of-war countdown), a score-progression chart, and **both rosters** with live statuses: hospital/jail timers, traveling, last action, wall defenders, revivers. Filter to *attackable* players (okay or leaving hospital <10 min).
- **Squad matchups + FF Scouter member cards** — the Hit Club also lists **your own faction's members** with their FF Scouter estimates, and shows how many enemy members fall in each member's stat range. Clicking a member opens an **FF Scouter card popup**: their estimate, stat detail/source, status, and a ready-to-work list of **opponents in stat range for that specific member** (est, level, live hospital timer, ⚔ attack link, + list).
- **Your faction's war, automatically** — your faction is detected from your key (`/faction/basic`); your current ranked war is read straight from `/faction/wars` (authoritative even when the global list lags), badged **YOUR WAR** everywhere, and the Hit Club locks onto it with the opponent auto-selected as the target side (with a one-click switch-back if you browse another war).
- **The Hit Club** — powered by **FF Scouter**: fair-fight + battle-stat estimates for every enemy member, a *weakest → strongest* target ladder, and a **stat-range target matcher** — soft / fair / tough presets anchored to *your own* estimate (auto-detected from your key via `/user/basic` + FF Scouter) or a custom min–max range (accepts `250m`, `2.5b`, `1.2t`…). One button adds every matching member to the hit list (P1–P3 priorities, notes, claims, ⚔ attack links, Discord copy; in-range rows highlighted). Saved per war in localStorage.
- **FF Scouter integration** — checks/registers your key with [ffscouter.com](https://ffscouter.com) (with the required data-policy consent step), scouts **both war rosters** (your squad + the enemy) in batched requests (≤205 ids/call), shows per-member: FF multiplier, estimated total (log-scale color bar), exact STR/DEF/SPD/DEX when faction spies exist (otherwise the stat distribution), and data source/age. Results cached ~6 h locally and 5 min server-side to respect their 20 req/min limit.
- **History & Reports** — pull the ranked-war history of any faction, then open the full **war report**: per-member scores, attacks, rank movement (e.g. *Silver 3 ▲ Silver 2*), respect/points/item rewards.
- **Demo mode** — explore everything with simulated data, no API key needed.
- **Your faction** — pin your faction ID (or auto-detect from your key) to get a `YOU` badge and auto-selection of your war.

## Run it

```bash
node server.js
# → http://localhost:3000
```

Zero dependencies — any Node 18+ works. Then:

1. Get an API key: Torn → **Preferences → API keys** → create a **Public** key (it's enough for every feature).
2. Paste it into the key field and hit **Save** (stored only in your browser's localStorage).

## Deploy (Render.com, free)

The ZIP / repo is deploy-ready (zero dependencies, honors `PORT` + `0.0.0.0`):

1. Push this folder to a GitHub repo (or use the ZIP contents).
2. On [render.com](https://render.com): **New → Web Service → connect the repo**.
3. Render auto-detects `render.yaml` / `package.json` — runtime **Node**, build *(none needed)*, start `node server.js`, health check `/api/ping`.
4. Deploy. Works on the free plan (the service sleeps when idle; first request wakes it).

## Architecture

```
server.js          zero-dependency Node server
 ├─ serves ./public (static frontend)
 └─ /api/torn      allow-listed proxy to https://api.torn.com/v2/…
                   (10 s server cache, key never logged, 12 s timeout)
public/
 ├─ index.html     shell
 ├─ styles.css     dark Torn-style theme
 └─ app.js         vanilla-JS single-page app (no frameworks, no CDNs)
```

### Torn API endpoints used (all v2, all *Public* key level)

| Endpoint | Used for |
| --- | --- |
| `GET /faction/warfareranked` | global list of ongoing/scheduled ranked wars |
| `GET /faction/wars` | fallback: your faction's current war |
| `GET /faction/{id}/members` | rosters with live status (`striptags=true`) |
| `GET /faction/{id}/rankedwars` | war history of a faction |
| `GET /faction/{warId}/rankedwarreport` | finished-war report incl. member scores |
| `GET /faction/basic` | detect the key owner's faction |

**FF Scouter** (via `ffscouter.com/api/v1`, proxied through `/api/ffscouter`): `get-stats` (batched stat estimates), `check-key`, `register` — your Torn key must be registered once with FF Scouter; the app does it in-tab with your consent.

### Notes & limits

- Torn's API does **not** expose live *per-member* war scores (faction totals only while a war runs). Member-level scores appear in the finished-war report.
- The proxy caches for 10 s and the default poll is 15 s → a handful of requests/minute, far inside Torn's rate limits.
- The score-progression chart samples data while the War Room is open (stored per-war in localStorage).
- Runs inside sandboxed preview iframes: storage falls back to in-memory there (state resets on reload). Opened in a normal browser tab, everything persists via localStorage.
- Unofficial fan tool — not affiliated with Torn or Chedburn.
