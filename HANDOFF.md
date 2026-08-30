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
  - tactical board editor and manager analysis workspace at `/tactics` (through Phase 8B)
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
- Phase 6B is complete: quick live match logging is available in a pizarra linked to a match. `match_events` stores goal, conceded goal, substitution, card, tactical adjustment or note with optional minute. API: `GET/POST/DELETE /api/match-reports/{match_id}/events`; the pizarra has six one-click event actions plus optional minute/note and safe deletion, while `/match-history` renders the event timeline inside each dossier.
- Managers can create reusable KORU or rival players with name, dorsal, position and an optional uploaded face. Profiles persist in SQLite (`tactical_players`) and use the existing uploads service. KORU tactical markers are always white with orange trim.
- Tactical IDs use a UUID fallback because the public deployment currently runs over plain HTTP, where browsers do not expose `crypto.randomUUID()`. Keep the cache-version query on the tactical entry module when changing startup code.
- The drawing tools and scene playback are functional. Only the 3D button remains intentionally disabled until its renderer phase.
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

- Phase 12: export sequences, sharing and staff roles.

## Repo / workflow notes

- GitHub repo: `rafansky/dashboardkoru`
- Keep secrets out of the repo.
- Ignore the local SQLite DB and uploads payloads, but keep the placeholder `.gitkeep` files.

## Likely next steps

1. Tactical board Phase 12: export sequences and sharing.
2. Tactical board Phase 13+: staff roles and collaborative workspaces.
3. Add staff roles/permissions before team sharing is implemented; keep 3D/video work for later phases.

## Relevo - Auditoria integral posterior a Fase 8B

Fecha: 2026-08-30

- Se corrigio el refresco del inspector: ahora los datos del elemento seleccionado se actualizan cuando cambia el documento aunque la seleccion siga siendo la misma.
- Las anotaciones se pueden seleccionar pulsando su nombre en la lista; al borrarlas se limpia tambien la seleccion.
- Una pizarra antigua o incompleta sin escenas se recupera en el cliente con una `Escena base` utilizable.
- El backend rechaza estados de escena duplicados, coordenadas de escena fuera del campo y anotaciones duplicadas.
- Las pizarras nuevas usan por defecto la perspectiva vertical `top-to-bottom`, que aprovecha mejor el movil y coincide con la vista solicitada por KORU. Las pizarras existentes no cambian.
- FastAPI se actualizo a `0.136.1` para mantener compatibilidad con Pydantic 2.13 y eliminar los avisos masivos de esquema.
- Se incorporo Playwright con pruebas E2E de escritorio, movil, paneles y seleccion de anotaciones. Ejecutar `npm run test:tactics:e2e` con un servidor local y `KORU_E2E_BASE_URL`/`KORU_E2E_PASSWORD` si no se usan los valores de desarrollo.
- `node_modules`, resultados y reportes de Playwright estan excluidos de Git y del archivo de despliegue.
- Ajuste posterior de anotaciones: flechas y zonas muestran previsualizacion en tiempo real al moverlas o redimensionarlas. Las flechas usan trazo `3.4px`, punta mayor con el color propio de cada flecha y tiradores mas pequenos para no ocultarla. La prueba E2E verifica que las coordenadas SVG cambian antes de soltar el raton.
# Relevo - Fase 7A: Alineaciones reutilizables

Fecha: 2026-08-29

- Ultimo commit previsto: `add reusable lineup templates`.
- La pizarra incorpora el bloque **Alineaciones** en el panel izquierdo: guardar once KORU actual, elegir/cargar y borrar plantillas.
- Persistencia: tabla SQLite `tactical_lineup_templates`; API `GET/POST/DELETE /api/tactical-lineup-templates`.
- Cada plantilla conserva nombre, sistema, dorsal, avatar, `rosterKey` y posicion de los jugadores. Al cargar se reemplazan solo los jugadores del equipo local y se actualizan los estados de todas las escenas; no se tocan rival, balon, anotaciones, analisis ni dibujo.
- Validacion incluida en `tests/test_tactics_api.py::test_lineup_template_crud`.
- Siguiente fase sugerida: convocatoria por partido y disponibilidad de jugadores, reutilizando las alineaciones guardadas y enlazandolas al informe de partido.
# Relevo - Fase 7B: Convocatoria y disponibilidad

Fecha: 2026-08-29

- Ultimo commit previsto: `add match callup availability`.
- Una pizarra vinculada muestra **Convocatoria**: permite registrar disponibilidad por jugador KORU (`available`, `doubtful`, `unavailable`, `called`) y una nota opcional.
- Persistencia: `match_callups`, con clave primaria `(match_id, roster_key)`. API `GET/PUT/DELETE /api/match-reports/{match_id}/callups`.
- `GET /api/match-history` incluye `callups` y `callupCount`, listo para mostrar disponibilidad en la futura mejora del historial.
- Al cargar una alineacion reutilizable en una pizarra vinculada se rellena la convocatoria textual del informe con el once; el manager debe pulsar **Guardar informe** para persistirlo.
- Siguiente fase sugerida: calendario/convocatoria central con filtros de respuesta y una vista resumen por partido en `/match-history`.
# Relevo - Fase 8A: Biblioteca táctica

Fecha: 2026-08-29

- Ultimo commit previsto: `add tactical play library`.
- Biblioteca táctica persistente en la barra izquierda: guardar la pizarra actual como jugada, filtrar por categoría, crear una copia limpia desde ella y borrar plantillas.
- Persistencia: tabla `tactical_play_templates`. API `GET /api/tactical-play-templates`, `GET/DELETE /api/tactical-play-templates/{id}`, `POST /api/tactical-play-templates`.
- Una jugada conserva documento táctico (jugadores, campo, flechas, anotaciones y escenas), pero al guardarse se limpian análisis y metadatos. Al usarla genera una nueva pizarra sin `matchId` y con bitácora nueva, dejando la maestra intacta.
- Siguiente fase sugerida: formaciones rápidas base (`4-2-3-1`, `4-3-3`, `3-5-2`, etc.) que se puedan completar con una alineación guardada.
# Relevo - Fase 11: Fichas graficas de alineacion

Fecha: 2026-08-30

- El boton de imagen de la cabecera abre una ficha de alineacion 16:9 para compartir. Toma los jugadores KORU visibles en el campo, con su dorsal y posicion.
- Se pueden completar rival, competicion, sistema y banquillo. Descarga PNG a 1920x1080; si la conversion no esta disponible, descarga SVG como respaldo.
- La prueba E2E abre la ficha y valida que la descarga se inicia con el nombre esperado.

# Relevo - Fase 10: Trayectorias de movimiento

Fecha: 2026-08-30

- Cada escena puede guardar trayectorias de varios puntos vinculadas a un jugador o al balon (`movementPaths`). El esquema tactico ahora es la version 4 y migra automaticamente las pizarras anteriores.
- Flujo: selecciona un jugador o balon, pulsa el icono de ruta en la barra izquierda, marca los puntos del recorrido y confirma. El panel derecho permite cambiar el color o eliminar cada trayectoria.
- Las rutas usan una linea gruesa discontinua, puntos intermedios y flecha final; se incluyen en exportacion y se ocultan con la capa de anotaciones durante presentacion.
- El boton de confirmar/cancelar bloquea el evento del campo para evitar anadir un punto accidental. `Enter` confirma y `Esc` descarta un borrador. E2E cubre crear y confirmar una ruta.

# Relevo - Fase 9: Capas y modo presentacion

Fecha: 2026-08-30

- La pizarra incluye controles temporales de visibilidad para KORU, rival, balon, nombres, anotaciones y lineas del campo. No modifican el documento ni generan guardado.
- El boton de monitor de la cabecera, el boton **Explicar jugada** y la tecla `P` activan un modo presentacion que oculta cabecera, paneles, herramientas y linea de tiempo; el campo se ajusta a toda la pantalla disponible.
- El dock flotante conserva los interruptores de capa, permite restablecerlos y salir; `Esc` tambien sale de presentacion.
- La cobertura E2E comprueba la entrada, ocultar anotaciones y la salida del modo. Siguiente fase sugerida: movimientos con varios puntos y reproduccion de trayectorias.

# Relevo - Fase 8B: Formaciones rápidas

Fecha: 2026-08-30

- Ultimo commit previsto: `add quick formation presets`.
- La barra izquierda incluye **Formación rápida**: `4-2-3-1`, `4-3-3`, `4-4-2`, `3-5-2` y `5-2-1-2`.
- Aplicar una formación sustituye solo los jugadores KORU por puestos vacíos (`POR`, `DFC`, etc.), conserva rival/elementos/anotaciones y actualiza todas las escenas.
- Si se carga una alineación mientras hay puestos de formación, sus jugadores ocupan esos puntos por coincidencia de posición, completando los restantes en orden. Sin puestos de formación, conserva las coordenadas guardadas por la alineación.
- Siguiente fase sugerida: capas de visibilidad para mostrar/ocultar equipos, nombres, balón y anotaciones durante una explicación.

# Relevo - Correccion de arranque y seleccion

Fecha: 2026-08-30

- La seleccion rectangular solo aparece tras un arrastre intencional de 7 px. Se cancela al perder foco, ocultar la pagina, recibir `pointercancel` o cambiar de pantalla completa, por lo que ya no queda un rectangulo abierto al maximizar el campo.
- Entrar en `/tactics` sin parametro recupera la ultima pizarra utilizada o, si no hay preferencia local, la pizarra guardada mas reciente. El boton **Nueva pizarra** sigue creando un documento vacio de forma explicita.
- La carga inicial usa resultados independientes: un fallo del dashboard externo ya no impide cargar pizarras, jugadores, alineaciones o biblioteca tactica.
- Cobertura E2E: umbral y cancelacion del rectangulo, recuperacion de la pizarra y jugador guardados, escritorio, movil, flechas, trayectorias y exportacion grafica.

# Relevo - Fase 12: Perfil acumulado de rival

Fecha: 2026-08-30

- El historial de partidos incorpora un perfil persistente por rival: sistema habitual, estilo, fortalezas, debilidades, balon parado, notas de jugadores y etiquetas.
- Desde cualquier expediente se puede guardar el perfil y pulsar **Usar en plan** para copiarlo al plan del partido actual. Los antecedentes del mismo rival quedan visibles y permiten navegar entre partidos.
- Persistencia: tabla `opponent_profiles`; API `GET` y `PUT /api/opponent-profiles`. La identidad se normaliza sin distinguir mayusculas o espacios repetidos para evitar duplicados.
- Cobertura: API valida actualizacion sin duplicar perfiles y E2E guarda un perfil y lo aplica al plan de partido.

# Relevo - Seleccion multiple y borrado

Fecha: 2026-08-30

- En la pizarra, `Ctrl + clic` (tambien `Cmd` en macOS) suma o quita jugadores, balones, flechas, zonas y textos de la seleccion. `Supr`/`Backspace` borra todo el conjunto seleccionado.
- El borrado admite selecciones mixtas de entidades y anotaciones en una sola operacion. Las filas del panel de anotaciones respetan el mismo modificador.
- E2E cubre seleccionar dos anotaciones con Ctrl y borrarlas sin eliminar al jugador del campo.

# Relevo - Fase 13: Video, clips y notas temporizadas

Fecha: 2026-08-30

- Cada expediente de partido dispone ahora de **Video y clips** en `/match-history`: se puede subir un MP4/WebM o registrar una URL directa a un archivo de video.
- El reproductor incluye linea de tiempo, reproducir/pausar y saltos de -10, -5, +5 y +10 segundos. Desde el segundo actual se pueden crear notas, enlazarlas opcionalmente a una pizarra y volver a ese instante con un clic.
- Persistencia: tablas `match_video_clips` y `match_video_notes`; API `GET/POST/DELETE /api/match-reports/{match_id}/clips` y `POST/DELETE /api/match-reports/{match_id}/clips/{clip_id}/notes`.
- Los ficheros se separan automaticamente por tipo: los videos usan `CLIPS_DIR` y las imagenes `IMAGES_DIR`. Por defecto son `uploads/clipskoru` y `uploads/imageneskoru`; las URL publicas son `/clipskoru/...` y `/imageneskoru/...`.
- En el mini PC no se detecto todavia el disco externo ni los puntos `/clipskoru` y `/imageneskoru`. Cuando este montado de verdad, configurar el servicio con `KORU_CLIPS_DIR=/clipskoru` y `KORU_IMAGES_DIR=/imageneskoru`; no crear esas rutas sobre el disco del sistema como sustituto.
- Cobertura: API para clip, nota y subida de video al directorio de clips; E2E para controles del reproductor y anotacion temporal.

# Relevo - Fase 14: Enlace de espectador para ponencias

Fecha: 2026-08-30

- Desde la cabecera de una pizarra guardada, el boton de pantalla compartida crea y copia un enlace privado de solo lectura (`/watch/{token}`).
- El visitante ve una pantalla limpia con el campo, jugadores, balon, flechas, zonas, trayectorias y escenas, sin contraseña general, paneles ni herramientas de edicion.
- El visor consulta la pizarra cada segundo. El guardado automatico del editor hace que los movimientos y cambios lleguen a los espectadores durante la ponencia; la escena activa se guarda en `document.metadata.activeSceneIndex` para que todos vean la misma.
- Persistencia: `tactical_share_links` guarda un hash SHA-256 del token, nunca el enlace en claro. Solo el endpoint publico de lectura conoce ese token y las APIs de edicion siguen requiriendo la sesion del manager.
- Siguiente mejora posible: WebSocket para sincronizacion cuadro a cuadro durante animaciones y un visor de clips integrado en la misma sala.
- Correccion posterior: se versionaron las URLs de `app.js` y `api.js` para evitar que los navegadores mantengan en cache una version anterior sin `createShareLink`.

# Relevo - Fase 15: Sincronizacion WebSocket del espectador

Fecha: 2026-08-30

- El visor de `/watch/{token}` ya no depende de una consulta cada segundo: abre un WebSocket de solo lectura en `/ws/tactical/{token}`.
- Al conectar recibe la pizarra actual y cada guardado del manager se emite de inmediato a todos los espectadores conectados a esa pizarra, incluyendo cambios de escena, jugadores, balon, flechas, zonas y anotaciones.
- El visor muestra estado de conexion, reconecta automaticamente tras un corte y conserva un refresco HTTP de respaldo cada cinco segundos si no recibe mensajes.
- El WebSocket valida el token privado antes de aceptar la conexion. Los visitantes no pueden enviar cambios ni acceder a las APIs autenticadas.
- Cobertura: la prueba API conecta un espectador, comprueba el estado inicial y verifica que recibe una actualizacion posterior al guardar desde el manager; se mantienen las 19 pruebas de logica y las pruebas E2E existentes.
- El enlace de espectador se sigue generando desde el boton de compartir de la cabecera. Para una ponencia, el manager mantiene abierta la pizarra y los espectadores entran con el mismo enlace.
- Siguiente fase sugerida: sincronizar tambien el estado efimero de arrastre y la reproduccion cuadro a cuadro, sin esperar al guardado automatico.

# Relevo - Fase 16: Vista 3D equivalente a la pizarra 2D

Fecha: 2026-08-30

- La pizarra incorpora un modo **3D** basado en Three.js local, sin depender de CDN. El modo 2D sigue siendo la vista de edicion y el 3D es una vista de inspeccion/presentacion: ambos leen el mismo documento y las mismas coordenadas, por lo que cambiar de vista no mueve jugadores, balon ni anotaciones.
- Se representan campo con perspectiva, lineas, areas, porterias, jugadores KORU/rival, dorsales, caras configuradas, balon realista, flechas, zonas, textos y trayectorias de movimiento. Las capas de presentacion y la reproduccion de escenas se reflejan tambien en 3D.
- En 3D: arrastrar rota la camara, rueda/pellizco hace zoom, boton derecho desplaza y **Encajar campo** recupera un encuadre completo adaptado a escritorio o movil. La seleccion admite clic y Ctrl/Cmd/Shift; la edicion de objetos permanece en 2D para evitar desplazamientos accidentales.
- En movil, la cabecera conserva accesibles los botones de paneles y el selector 2D/3D; los controles secundarios se ocultan para mantener una interfaz util en 390 px.
- Se han incluido `three.module.min.js`, `three.core.min.js` y `OrbitControls.js` en `static/vendor/three/` para que la vista funcione tambien en el mini PC sin internet.
- La vista 3D tambien permite editar: arrastra jugadores o balon directamente sobre el campo, con seleccion multiple mediante Ctrl/Cmd/Shift. El renderer convierte el punto del plano 3D a coordenadas tacticas, usa el mismo comando de movimiento que 2D y conserva deshacer/rehacer y guardado.
- Las anotaciones tambien se pueden seleccionar y desplazar en 3D: flechas, zonas y textos se mueven como un bloque y se guardan con la misma accion de mover anotacion que en 2D.
- Al activar 3D se recalcula la camara si el canvas cambia de relacion de aspecto, evitando que el primer arrastre quede desalineado despues de abrir la vista o cambiar a movil.
- Cobertura: 19 pruebas de logica y 7 E2E pasan. Las nuevas pruebas comprueban canvas no vacio en escritorio/movil, encuadre, interaccion real de camara, equivalencia 2D/3D y reproduccion de escenas.
- Siguiente fase sugerida: sincronizar la vista 3D en el visor publico de espectador y exportar una captura/video de la pizarra desde el modo presentacion.
