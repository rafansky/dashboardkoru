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
  - Rankings y ELO with trend chips and 14-day mini history sparklines
  - tactical board editor and manager analysis workspace at `/tactics` (Phase 2)
- Uses local SQLite for notes/files metadata and an `uploads/` folder for stored files.
- Has a private login gate on `/login` with a session cookie and logout button in the dashboard.

## Main files

- `app/main.py`: API routes, uploads, notes, static serving.
- `app/services/dashboard.py`: external API fetch and dashboard normalization.
- `app/settings.py`: URLs, IDs, and source links.
- `static/index.html`: layout shell.
- `static/styles.css`: compact dashboard styling.
- `static/app.js`: rendering and interactions.
- `app/tactics_models.py`: validated, versioned tactical document contract.
- `static/tactics/`: modular editor state, geometry, API client and SVG renderer.
- `static/tactics.html`: tactical editor shell.

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
- The active dashboard password has been rotated to the latest value and is stored only in the mini PC service environment, not in the repo.
- Rankings/ELO are generated internally from VPG/PLG data. Player rating is normalized before ELO so total rating values do not inflate the ranking.
- ELO snapshots are persisted daily in SQLite (`elo_snapshots`). The API attaches `eloDelta`, `trends`, and per-player/per-team `history` arrays so the frontend can render sparklines. With only one snapshot the deltas stay at `0`; they become useful after future daily refreshes.
- Tactical boards use a single `TacticalBoardDocument` (`schemaVersion: 2`) for future 2D and 3D renderers. Positions are pitch metres, never pixels. Phase 1 documents migrate automatically.
- Phase 1 is complete: `/tactics`, Pydantic validation, SQLite CRUD with optimistic versioning, library, real KORU roster feed, SVG pitch, field views/orientations/overlays, command-based property undo/redo, debounced autosave, local recovery draft, collapsible panels and fullscreen.
- Phase 2 is complete: click/drag players onto the pitch, single/multiple selection, marquee, group move, zoom, pan, touch pinch, responsive mobile workspace, match binding and a persistent manager log split into analysis sessions. Log entries support observations, decisions, adjustments, tasks and outcomes, optional match minute, current scene and selected-player references.
- Phase 3 is complete: the scene timeline is now functional. Managers can capture the active field state, create or duplicate scenes, rename them, set duration/transition/notes, reorder or delete them, reopen any scene and play an interpolated transition to the next one. Scene positions are only overwritten when `Capturar` is used, so experiments do not replace saved movement states accidentally.
- The latest tactical board work adds a perspective projection for `top-to-bottom` and `bottom-to-top`: the pitch is wider near the viewer, narrower at the far end, and the projection preserves drag/drop coordinates and upright player labels. The vertical board was widened and the outside area is now a plain editor background; grass stripes are rendered only inside the pitch surface.
- Latest Git commit: `ead8de4` (`widen near edge of perspective pitch`). The repository is pushed to `origin/main`.
- Managers can create reusable KORU or rival players with name, dorsal, position and an optional uploaded face. Profiles persist in SQLite (`tactical_players`) and use the existing uploads service. KORU tactical markers are always white with orange trim.
- Tactical IDs use a UUID fallback because the public deployment currently runs over plain HTTP, where browsers do not expose `crypto.randomUUID()`. Keep the cache-version query on the tactical entry module when changing startup code.
- The 3D button, drawing tools and playback controls are intentionally disabled until their corresponding phases; they do not simulate functionality.
- Tests use standard-library `unittest` and Node's native test runner. Run the commands documented in `README.md`.

## Deployment notes

- Local dev server has been run on `http://127.0.0.1:8080`.
- The mini PC target now uses `10101` because other services already occupied `80` and `8080`.
- Current mini PC URL on LAN: `http://192.168.1.133:10101`
- The service is already installed and running on the mini PC as `koru-dashboard.service`.
- SSH user on the mini PC is `rafansky`.
- Router port forwarding is already configured from external `10101` to `192.168.1.133:10101`, so the dashboard is now reachable from outside through that port.
- Deployment is done from PowerShell with `scripts/deploy_remote.ps1`, passing the SSH user, mini PC password, dashboard password, and `-Port 10101`.

## Next phase

- Phase 4 should turn the tactical board into a complete manager drawing tool: interactive arrows and movement paths, zones/rectangles, freehand or text annotations, distance/angle guides, and a compact style toolbar. These objects should be saved per scene and included in playback/export.
- After the drawing layer, the next high-value step is a match-history workflow: attach a tactical document to a match, store lineups and decisions, and expose a searchable history of sessions and scenes.

## Repo / workflow notes

- GitHub repo: `rafansky/dashboardkoru`
- Keep secrets out of the repo.
- Ignore the local SQLite DB and uploads payloads, but keep the placeholder `.gitkeep` files.

## Likely next steps

1. Tactical board Phase 4: arrows, zones, drawing objects, text, measurement and contextual properties.
2. Tactical board Phase 5: formations, layers, groups, copy/paste and full shortcut system.
3. Add a dedicated match dossier view that groups boards, sessions, files and post-match conclusions by `matchId`.
4. Tactical board Phase 7+: lazy-loaded Three.js renderer backed by the same tactical document.
5. Add staff roles/permissions before team sharing is implemented.
