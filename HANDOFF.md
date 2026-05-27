# Handoff for the next agent

This repo is the KORU eClub dashboard for FC26, meant to unify VPG, VPG Zero, and PLG in one private club site.

## What the app does

- FastAPI backend with a static frontend.
- Live aggregation from:
  - VPG public API
  - PLG / Virtual Pro Network API
- Shows:
  - team summary
  - competition tabs and cards
  - standings
  - next match
  - upcoming and recent matches
  - leaderboards for scorers, assists, and ratings
  - notes
  - file uploads
- Uses local SQLite for notes/files metadata and an `uploads/` folder for stored files.
- Has a private login gate on `/login` with a session cookie and logout button in the dashboard.

## Main files

- `app/main.py`: API routes, uploads, notes, static serving.
- `app/services/dashboard.py`: external API fetch and dashboard normalization.
- `app/settings.py`: URLs, IDs, and source links.
- `static/index.html`: layout shell.
- `static/styles.css`: compact dashboard styling.
- `static/app.js`: rendering and interactions.

## Current design direction

- Compact, dense dashboard.
- Smaller hero and panels.
- More information per screen, less vertical waste.
- Dark modern look with orange accent for KORU.

## Important implementation notes

- The KORU logo in the hero is now the cropped local asset at `static/assets/koru-logo.png`.
- The hero backdrop uses a subtle gradient, not a giant cover image.
- The UI has been intentionally tightened several times to make the page feel higher-resolution and less oversized.
- The dashboard now requires `KORU_ACCESS_PASSWORD`, and the mini PC service is configured with the password and cookie secret in systemd environment variables.

## Deployment notes

- Local dev server has been run on `http://127.0.0.1:8080`.
- The mini PC target now uses `10101` because other services already occupied `80` and `8080`.
- Current mini PC URL on LAN: `http://192.168.1.133:10101`
- The service is already installed and running on the mini PC as `koru-dashboard.service`.
- SSH user on the mini PC is `rafansky`.
- Router port forwarding is already configured from external `10101` to `192.168.1.133:10101`, so the dashboard is now reachable from outside through that port.

## Repo / workflow notes

- GitHub repo: `rafansky/dashboardkoru`
- Keep secrets out of the repo.
- Ignore the local SQLite DB and uploads payloads, but keep the placeholder `.gitkeep` files.

## Likely next steps

1. Add players / squad management.
2. Add calendar and availability.
3. Add staff login and permissions.
4. Add season history and archives.
5. Add richer file/archive storage.
