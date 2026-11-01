# Player of the Week · KORU · fórmula v2

## Cambio del 1 de noviembre de 2026

La participación se determina exclusivamente por partidos y alineaciones. Los abandonos por fallos del juego hacen que la duración registrada no sea fiable: no se lee para contar apariciones, decidir candidatos, ponderar notas ni desempatar.

La semana incluye PLG/VPN, VPG y VPG Zero. Se distinguen tres cifras de equipo: partidos jugados, informes completos que puntúan e informes pendientes. Cada jugador muestra sus apariciones sobre los encuentros de KORU, sus partidos puntuados y sus partidos pendientes. Un informe ausente no demuestra que un jugador no participase.

La comprobación real de la semana del 26 de octubre al 1 de noviembre devuelve 16 partidos de KORU: 4 PLG y 12 VPG. Hay 11 informes completos (4 PLG y 7 VPG) y 5 pendientes. Andyelmessy figura en 16 alineaciones: 11 notas puntuadas y 5 pendientes; su rendimiento es 71,9.

## Participación y cálculo

- Una aparición equivale a figurar una vez en la alineación de un partido jugado. Se deduplican partidos y jugadores por identificador de plataforma.
- Un encuentro programado sin confirmación de que se haya jugado no cuenta como ausencia ni aumenta el denominador de partidos jugados. Los forfeits se excluyen.
- La nota EA debe ser numérica, mayor que cero, como máximo 10 y tener una posición reconocida. Las notas a cero, ausentes o no válidas dejan el informe pendiente.
- Si algún jugador de KORU tiene una nota pendiente, se conserva la alineación completa para contar apariciones pero ese informe no puntúa para nadie hasta completarse. No se penaliza con un cero y no se puntúa un encuentro para unos compañeros y para otros no.
- No se requieren totales de acciones para contar una aparición. Las acciones no intervienen en el criterio común de PLG/VPG.
- Para ser candidato hay que aparecer al menos en el 50 % de los partidos jugados por KORU, redondeando hacia arriba, y tener alguna nota válida en informes completos. La lista es provisional mientras falten informes.
- Se compara cada nota con las notas válidas de la misma posición y plataforma en los partidos completos de esa semana, incluyendo rivales. VPG y VPG Zero comparten la fuente VPG; PLG tiene su propio grupo. No se mezclan las escalas entre proveedores.
- Se usa el percentil con empates por rango medio: `100 × (valores menores + 0.5 × valores iguales) / tamaño del grupo`. Con menos de cuatro muestras, el percentil es 50.
- Cada roja resta 8 puntos a esa actuación, con suelo cero. Las amarillas no penalizan.
- El rendimiento semanal es la media aritmética de los puntos por partido completo. La media EA también es por partido, excluyendo informes pendientes. Cada actuación puntuada tiene el mismo peso.

```
participación mínima = ceil(partidos jugados por KORU × 0.50)
partido = max(0, percentil EA por posición y plataforma - 8 × rojas)
rendimiento = suma(puntos de partidos completos) / partidos puntuados
```

Sin actuaciones puntuables se devuelve una nota desconocida, no un cero. La versión queda identificada como `koru-potw-v2-appearances`. Los snapshots de votaciones existentes se conservan; las clasificaciones sin votación se recalculan con la regla nueva. Los datos actuales y los cambios respecto al snapshot pueden consultarse por separado.

## Importación y vinculación de jugadores

VPN aporta el calendario completo de la liga y los informes individuales de las páginas públicas. Las ligas y temporadas se detectan desde la ficha del club. Cada encuentro conserva la semana asignada en la primera importación, aunque se aplace después.

VPG aporta sus ligas activas, calendarios completos y estadísticas individuales mediante `/public/matches/{id}/data/`. Se recorren todas las páginas con `offset`, siguiendo `count`: el proveedor puede devolver solo 30 filas aunque se pidan más. Un bucle de páginas repetidas se detecta como error de fuente, en vez de presentar un total incompleto como definitivo.

Los IDs de partido están separados por plataforma para impedir colisiones. Para unir al mismo jugador entre plataformas se usan su nombre exacto o sus identificadores públicos de juego. Por ejemplo, las cuentas de Maroto, Rafansky y Zamora se vinculan mediante los IDs EA/PSN que publica VPG y los que publica VPN. Una coincidencia ambigua no se fusiona. De los perfiles de VPG solo se guardan ID, usuario y gamertags necesarios para esa vinculación; no se guardan sus demás campos.

La tarea de fondo se ejecuta cada 15 minutos. El botón Sincronizar puede adelantarla, con una consulta como máximo cada minuto por proceso. Los informes recientes se vuelven a consultar para recuperar notas pendientes o correcciones; los antiguos se mantienen en caché. Si una fuente falla, sus datos previos se conservan y se muestra el aviso. PLG y VPG se actualizan de forma independiente para conservar lo que sí está disponible.

## Votación

Tras el ?ltimo partido previsto y 12 horas de margen, una semana reciente puede abrir una votación de 48 horas, siempre que todos los informes están completos y existan al menos dos candidatos. Los pendientes bloquean la apertura automática y manual. Las semanas históricas completas pueden abrirse manualmente.

El ?rea del capitán requiere una clave privada distinta de la contraseña compartida del dashboard. Se consulta en el servidor, bajo el mismo entorno y base de datos que el servicio:

```
python -m app.potw --manager-key
```

También se puede configurar con `KORU_POTW_MANAGER_KEY`. Cada participante recibe un enlace personal generado por el capitán. El sistema no envía mensajes. Quien tenga el enlace puede usar esa papeleta: hay que enviarlo solo a su destinatario. Reemitirlo invalida el enlace anterior sin borrar el voto.

Se reparten 3, 2 y 1 puntos entre candidatos distintos, sin autovotos. Si hay menos de tres candidatos disponibles se rellenan los puestos posibles. Se puede cambiar la selección hasta el cierre; cuenta ?nicamente la ?ltima papeleta de cada jugador. Las elecciones individuales no se publican y los resultados agregados permanecen ocultos hasta cerrar.

```
cuórum = max(3, ceil(censo / 2))
apoyo = 100 × puntos recibidos / (papeletas válidas de otros jugadores × 3)
final = 0.80 × rendimiento + 0.20 × apoyo
```

Sin cuórum decide el rendimiento. La papeleta del propio candidato se excluye de su máximo posible, por lo que votar no diluye el apoyo que recibe. El MVP estadístico se muestra aparte. Desempate: puntos finales, rendimiento y partidos jugados; si persiste se comparte el premio. El ID solo estabiliza el orden visual.

La candidatura, versión, estadísticas y censo se congelan al abrir. Una corrección posterior en la fuente se avisa sin reescribir una elección ya iniciada. La fecha límite se valida en el servidor dentro de una transacción SQLite. Las respuestas de papeleta no se almacenan en caché y no envían referencias del enlace.

## Operación

- Los cambios de esquema son aditivos. El caché original VPN sigue disponible para las estadísticas PLG del dashboard. Las nuevas tablas VPG son `potw_vpg_fixtures`, `potw_vpg_reports` y `potw_vpg_users`.
- La API general exige el acceso privado del dashboard. Solo la papeleta personal y sus recursos son accesibles mediante un token. La administración exige también la clave del capitán. En la base se guardan hashes de los tokens, no los enlaces completos.
- `KORU_POTW_AUTO_SYNC=false` desactiva el bucle de fondo para pruebas. `python -m app.potw --sync` consulta ambas fuentes una vez. El proceso necesita seguir ejecutándose para la sincronización automática.
- Conservar copias de SQLite y archivos. No subir bases, contraseñas, enlaces de voto ni perfiles de prueba a GitHub.

## Verificación

Se han probado la invariancia al modificar o quitar duraciones, la media simple por partido, la participación del 50 %, la separación por plataforma, los duplicados, las notas pendientes, los informes ausentes, la paginación VPG y la vinculación de identidades. Los casos anteriores de papeletas, autovotos, sustitución, cuórum, cierre y snapshots siguen cubiertos.

```
.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
node --test tests/tactics-geometry.test.js tests/tactics-store.test.js tests/tactics-model.test.js tests/squad-calendar.test.js
```

Para E2E usar una base nueva y descartable en cada ejecución, nunca la del club:

```powershell
$env:KORU_DB_PATH = Join-Path $PWD ("artifacts/potw-test-" + [guid]::NewGuid() + ".db")
$env:KORU_ACCESS_PASSWORD = "test-password"
$env:KORU_POTW_AUTO_SYNC = "false"
$env:KORU_POTW_MANAGER_KEY = "e2e-captain-key"
.\.venv\Scripts\python.exe tests/seed_potw_e2e.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 10103
```

En otra terminal:

```powershell
$env:KORU_E2E_BASE_URL = "http://127.0.0.1:10103"
$env:KORU_E2E_PASSWORD = "test-password"
$env:KORU_POTW_MANAGER_KEY = "e2e-captain-key"
npx.cmd playwright test tests/potw-e2e.spec.js --workers=1
```

Las pruebas abren y cierran elecciones ficticias; para repetirlas hay que usar otra base descartable. La validación con datos reales utiliza otra base aislada sin introducir votos de prueba en el club.
