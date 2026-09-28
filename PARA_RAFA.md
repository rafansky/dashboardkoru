# Para Rafa

Actualización — 28 de septiembre de 2026: gestión de plantilla más sencilla.

- `/gestion-plantilla` abre directamente el calendario de asistencia, por semanas o por mes.
- Cada jugador/día permite elegir verde «Está», rojo «No está» o amarillo «Está, pero no jugó». Gris significa «Sin marcar» y no cuenta como falta. El calendario guarda al elegir.
- `* Añadir jugador` está visible en el calendario y la plantilla. `−` retira un jugador con confirmación, conservando su historial; para recuperarlo, filtra por Inactivos y cambia su ficha a Activo.
- El historial anterior con filtros y estadísticas sigue en «Historial detallado». Las observaciones y el resto de datos se conservan.
- Verde registra presencia sin inventar que jugó. Amarillo registra presencia sin participación. La agenda y el once siguen en «Día de partido».
- Verificado con 3 pruebas de lógica del calendario, 4 pruebas API y 2 recorridos de navegador, incluyendo móvil, persistencia al recargar y retirada sin pérdida del historial. Las pruebas usan una instancia aislada.
- Los cambios de la pizarra táctica que ya existían en el directorio de trabajo se han dejado aparte de este cambio.

Actualización — 28 de septiembre de 2026: fichas individuales de jugadores.

- Cada jugador tiene una ficha propia accesible con «Ver ficha» desde Plantilla o pulsando su nombre en Asistencia. Un jugador nuevo obtiene su ficha al guardarse.
- La ficha reúne datos personales, notas del capitán, historial de asistencia/participación/titularidades y anotaciones independientes con fecha que se pueden añadir y borrar.
- Las estadísticas públicas que ya consume el dashboard se enlazan por `sourceKey`, nombre o alias: VPG aporta partidos, goles, asistencias, rating, ELO e historial disponible. La ficha enseña la fecha de actualización y el enlace a la fuente.
- Si no hay coincidencia o la liga no publica estadísticas individuales, la ficha lo explica y no muestra cifras inventadas. PLG no expone aún estadísticas individuales en la fuente conectada.
- Verificado mediante 5 pruebas backend, 3 de lógica de calendario y 2 recorridos E2E aislados que cubren la apertura y visualización de la ficha.

Actualización — 28 de septiembre de 2026: PDF de fichas de jugador.

- Dentro de cada ficha aparece «Crear PDF». Abre una vista previa A4 limpia, diseñada como ficha oficial de KORU con logo, foto o dorsal, datos, estadísticas, notas, anotaciones e historial reciente.
- Desde esa vista se pulsa «Guardar como PDF»: usa el diálogo nativo del navegador, así que se puede revisar primero el resultado y elegir impresora o archivo PDF sin instalar nada.
- La información se genera desde la ficha abierta, incluidos los datos VPG disponibles, y las URL de fotos se aceptan únicamente si son HTTP/HTTPS.
- Verificado en navegador con una prueba E2E que abre la ficha, lanza la vista previa y comprueba el contenido de KORU y estadísticas.

Actualización — 28 de septiembre de 2026: acceso HTTPS público.

- KORU conserva el puerto público `10101`, ahora detrás de Caddy con certificado TLS válido de DuckDNS. La dirección de acceso es `https://loschupapostes.duckdns.org:10101/login`.
- El proceso de KORU ya no está publicado directamente: escucha en una interfaz privada de Docker en el puerto interno `10102`; Caddy es el único punto de entrada web público.
- Comprobado extremo a extremo: KORU interno, proxy Caddy y dominio DuckDNS responden con `200` y validación TLS correcta.

Fecha de cierre: 31 de agosto de 2026

He revisado el proyecto completo en el miniPC, he terminado las fases funcionales que quedaban documentadas y he dejado la pizarra tactica cerrada hasta la fase 18. Este archivo va incluido en el mismo commit y push a `main` del remoto configurado, `rafansky/dashboardkoru`.

## Que he terminado

- Visor publico completo en 2D y 3D para los enlaces `/watch/{token}`.
- Seguimiento del ponente en tiempo real: vista 2D/3D, escena, capas, arrastre de jugadores/balon y reproduccion animada.
- Opcion **Vista libre** para que el espectador deje de seguir la camara/vista del manager sin perder la conexion.
- Captura desde el visor: SVG en 2D y PNG en 3D.
- Captura PNG de la escena desde el editor cuando se trabaja en 3D.
- Grabacion de la secuencia completa de escenas en WebM o MP4, respetando duracion, velocidad y transicion. Si el navegador no dispone de grabacion, descarga un JSON tactico recuperable.
- Restauracion automatica de vista, paneles, herramienta y seleccion al terminar o fallar una grabacion.

## Como esta hecho

- El editor mantiene el WebSocket de espectadores que ya existia y anade un canal autenticado de control para el manager.
- Los fotogramas de arrastre y reproduccion son efimeros: se envian con limitacion de frecuencia, pero no se guardan continuamente en SQLite. El autosave normal sigue siendo quien persiste la pizarra y conserva el control de versiones.
- El backend valida cada estado en directo con el mismo modelo Pydantic que una pizarra guardada, limita el mensaje a 512 KiB y comprueba sesion, origen y existencia de la pizarra.
- El visor reutiliza los renderers 2D/3D del editor, pero el 3D se instancia sin edicion. Solo permite orbitar y cambiar el encuadre.
- La grabacion usa el canvas WebGL de Three.js, `captureStream` y `MediaRecorder`; no necesita servidor de video ni servicios externos.

## Seguridad y robustez

- El enlace publico ya no entrega `matchId`, sesiones de analisis ni metadatos internos. Solo recibe lo necesario para dibujar la pizarra.
- Los avatares remotos solo se descargan desde el CDN VPG permitido; se comprueba la firma real PNG/JPEG/GIF/WebP/AVIF, se rechaza SVG y se limita a 8 MiB.
- Las imagenes subidas se validan por contenido real, no solo por extension o `Content-Type`.
- Todas las subidas tienen limite configurable mediante `KORU_MAX_UPLOAD_MB` y un parcial se elimina si supera el limite o no es valido.
- Se anadieron cabeceras de seguridad y un limite temporal de ocho intentos fallidos de login por cliente en cinco minutos.
- `KORU_DB_PATH` permite aislar la base de datos en tests o despliegues especiales.

## Limpieza que he realizado

- Habia 134 archivos AppleDouble `._*`, incluso dentro de `.git`, que producian errores. Se han quitado del proyecto y ahora `.gitignore` excluye `._*` y `.DS_Store`.
- La copia recuperable esta en `/home/rafansky/koru-appledouble-quarantine-20260831.tar.gz`.
- Dos MP4 falsos creados por pruebas antiguas se movieron a `/home/rafansky/koru-test-artifacts-quarantine-20260831/`.
- Los tests ahora sustituyen base de datos, uploads, clips e imagenes por rutas temporales, de modo que no vuelven a ensuciar los datos reales.
- No se han versionado la base SQLite, uploads, resultados de Playwright, `node_modules` ni secretos.

## Comprobaciones hechas

- 23 pruebas Python: correctas.
- 19 pruebas JavaScript de modelo, store y geometria: correctas.
- 8 recorridos Playwright E2E: correctos en escritorio y movil, incluida la vista 3D, directo publico, captura, grabacion e historial.
- Compilacion Python y sintaxis JavaScript: correctas.
- `pip check`: sin dependencias rotas.
- `npm audit --omit=dev`: cero vulnerabilidades conocidas.
- `git diff --check`: limpio.
- `git fsck --full`: sin corrupcion; solo aparece un commit colgante antiguo e inofensivo.

Playwright 1.62 necesita Node 20 o posterior. El Node global del miniPC es 18, asi que la prueba final se ejecuto de forma aislada con Node 22. Esto no afecta a produccion porque la aplicacion servida no necesita Node.

## Que tienes que hacer manana en macOS

En tu clon del Mac:

```bash
git switch main
git pull --ff-only
```

Si quieres repetir las pruebas, usa Node 20 o posterior:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm ci
python -m unittest discover -s tests -p 'test_*.py'
npm run test:tactics
```

Para el E2E hay que arrancar una instancia de prueba en el puerto 10102 y definir `KORU_E2E_PASSWORD`; las instrucciones completas estan en `README.md`.

## Queda algo

No queda ninguna fase funcional pendiente de la hoja de ruta tactica actual. El proyecto queda operativo y desplegado en el servicio `koru-dashboard.service` del miniPC.

Solo quedan decisiones futuras, no trabajo incompleto:

- configurar `KORU_CLIPS_DIR` y `KORU_IMAGES_DIR` cuando el disco externo exista y este realmente montado;
- decidir si algun dia hacen falta cuentas individuales, roles de staff o salas colaborativas persistentes, porque eso implica redisenar la autenticacion multiusuario;
- recoger correcciones de uso real de los managers, que pueden entrar como mejoras nuevas sobre esta base cerrada.

No he incluido la password activa ni el secreto de sesion en Git; siguen viviendo solo en la configuracion del servicio del miniPC.

Aviso de seguridad: durante la comprobacion del servicio, `systemctl` imprimio sus variables de entorno en el registro local de esta sesion de Codex. No se han subido al repositorio ni aparecen en los commits, pero conviene rotar manana `KORU_ACCESS_PASSWORD` y `KORU_AUTH_SECRET` en la unidad de systemd y reiniciar el servicio.
