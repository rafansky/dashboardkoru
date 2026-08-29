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
- Tactical boards use a single `TacticalBoardDocument` (`schemaVersion: 3`) for future 2D and 3D renderers. Positions are pitch metres, never pixels. Earlier documents migrate automatically.
- Phase 1 is complete: `/tactics`, Pydantic validation, SQLite CRUD with optimistic versioning, library, real KORU roster feed, SVG pitch, field views/orientations/overlays, command-based property undo/redo, debounced autosave, local recovery draft, collapsible panels and fullscreen.
- Phase 2 is complete: click/drag players onto the pitch, single/multiple selection, marquee, group move, zoom, pan, touch pinch, responsive mobile workspace, match binding and a persistent manager log split into analysis sessions. Log entries support observations, decisions, adjustments, tasks and outcomes, optional match minute, current scene and selected-player references.
- Phase 3 is complete: the scene timeline is now functional. Managers can capture the active field state, create or duplicate scenes, rename them, set duration/transition/notes, reorder or delete them, reopen any scene and play an interpolated transition to the next one. Scene positions are only overwritten when `Capturar` is used, so experiments do not replace saved movement states accidentally.
- The latest tactical board work adds a perspective projection for `top-to-bottom` and `bottom-to-top`: the pitch is wider near the viewer, narrower at the far end, and the projection preserves drag/drop coordinates and upright player labels. The vertical board was widened and the outside area is now a plain editor background; grass stripes are rendered only inside the pitch surface.
- Latest Git commit: `ead8de4` (`widen near edge of perspective pitch`). The repository is pushed to `origin/main`.
- Scene timeline follow-up is implemented locally and ready to deploy: playback now chains forward through every scene in order with cancellation tokens, scene cards have individual delete controls, and deleting the current scene selects the nearest remaining scene safely. Tests cover chained playback state in the store.
- Phase 4A is complete: each scene has its own `annotations` collection. The left rail now provides arrow, zone and text tools; these render on the 2D pitch (including perspective views), persist with the active scene and are migrated automatically for existing boards. Schema version is now 3.
- Phase 4B adds an annotation manager in the properties panel for the active scene: it lists every arrow, zone and text annotation, supports color changes, text editing and individual deletion. The next refinement is direct selection and repositioning of annotations on the pitch, then export.
- Phase 4C adds direct annotation interaction on the pitch: select any arrow, zone or text with the Select tool, drag it to reposition it, see its cyan selection state and delete it with Delete/Backspace or the selection panel. Annotation rows in the properties panel mirror the active selection.
- Phase 4D adds edit handles: selected arrows and zones show a start and end/corner handle that can be dragged to resize or redirect the annotation. The annotation manager also has a duplicate control; duplicates are offset slightly and selected immediately.
- Phase 4E adds scene export. The download button beside `Capturar` exports a clean 1920px PNG of the visible pitch and active-scene annotations, excluding selection/tirter controls. If a remote avatar blocks canvas export, it falls back to a clean SVG download.
- Phase 5A is complete: a pizarra linked to an imported VPG/PLG match exposes a persistent match dossier. It stores match status, KORU/rival score, lineup, summary, takeaways and tags in SQLite (`match_reports`), through `GET/PUT /api/match-reports`. The dossier is shared by `matchId`, so it is reusable from every board tied to that match. The backend now fully validates and persists phase 4 scene annotations too; this closes the former schema 2/3 save mismatch.
- Phase 5B is complete: `/match-history` is a compact manager history workspace. `GET /api/match-history` assembles dossiers from reports plus every tactical board linked by `matchId`, exposing board/session/note counts and direct links back to source boards. The UI filters by text, competition, status and tags and remains usable on mobile as a stacked list/detail layout. It is linked from both the dashboard navigation and the tactics header.
- Phase 5C is complete: dossier attachments and print export. `match_report_files` relates existing uploaded files to a `matchId` without copying payloads. API: `GET/POST/DELETE /api/match-reports/{match_id}/files`. The history page uploads and attaches files, previews images, links documents/clips, supports detaching safely, includes attachment counts in `GET /api/match-history`, and has a print stylesheet for browser PDF export.
- Phase 6A is complete: each dossier has a persistent opponent scouting and match-plan workspace. `match_plans` stores profile, threats, set pieces, match goals and a checked checklist. API: `GET/PUT /api/match-reports/{match_id}/plan`; the plan is also embedded as `matchPlan` in history results. The history UI has a compact editable form, a five-point starter template, checklist add/remove/check interactions and explicit save.
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

- Next high-value manager phase: richer matchday logging from the tactics board, then staff roles/permissions before sharing beyond the core group.

## Repo / workflow notes

- GitHub repo: `rafansky/dashboardkoru`
- Keep secrets out of the repo.
- Ignore the local SQLite DB and uploads payloads, but keep the placeholder `.gitkeep` files.

## Likely next steps

1. Tactical board Phase 6B: richer live match logging and quick event templates linked to the dossier.
2. Tactical board Phase 7+: lazy-loaded Three.js renderer backed by the same tactical document.
3. Add staff roles/permissions before team sharing is implemented.
