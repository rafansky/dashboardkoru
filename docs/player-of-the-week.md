# Player of the Week · KORU

La sección `/potw`, enlazada desde el dashboard, importa el calendario y los informes de VPN, calcula el rendimiento por posición y permite votar mediante enlaces personales. No requiere servicios de pago ni nuevas dependencias.

## Uso

1. Arrancar el dashboard como siempre. En el arranque y cada 15 minutos se comprueba VPN. `Sincronizar` permite adelantar la consulta (máximo una cada minuto por proceso).
2. Elegir la semana. La primera integración detecta los 26 partidos de 3.ª División B PLG, temporada 13, liga 2215, temporada VPN 6427, equipo 29377. Se consulta diariamente la ficha del club para detectar la siguiente temporada de la liga; si cambia de liga y hay una única liga activa, se adopta esa liga. Con varias ligas nuevas ambiguas se mantiene la conocida.
3. Si todos los informes están completos, doce horas después del último partido previsto se abre una votación de 48 horas. La apertura automática solo alcanza semanas cuyo último partido ocurrió en los últimos siete días, para no abrir elecciones de todo el archivo. El capitán puede abrir manualmente una semana histórica completa.
4. Abrir el área del capitán e introducir su clave privada. En el servidor se obtiene con `python -m app.potw --manager-key` usando el mismo entorno y `KORU_DB_PATH` de la aplicación. En Linux normalmente `.venv/bin/python -m app.potw --manager-key`; en Windows `.\.venv\Scripts\python.exe -m app.potw --manager-key`. No compartir esta clave con el equipo.
5. Generar un enlace para cada jugador del censo y enviárselo individualmente. El sistema no envía mensajes. La URL abre exclusivamente su papeleta, incluso sin la contraseña compartida del dashboard.
6. Cada jugador reparte 3, 2 y 1 puntos a compañeros distintos y elegibles. No puede votarse. Puede reemplazar su papeleta hasta el cierre. Si hay menos de tres candidatos distintos del votante, se rellenan los puestos disponibles.
7. Al llegar la fecha de cierre se publica el resultado. El capitán puede cerrar antes, con confirmación en la interfaz. No se reabre ni reinicia una votación cerrada.

Los enlaces se generan bajo demanda y solo se entregan una vez. Se guardan sus hashes SHA-256, nunca el token en claro. Reemitir uno revoca el anterior sin borrar la papeleta del jugador. La clave de capitán se genera una vez y persiste en SQLite; puede sustituirse con `KORU_POTW_MANAGER_KEY`. La clave no es la contraseña común del club. El capitán ve quién ha votado, pero no las elecciones individuales. Los resultados agregados están ocultos hasta el cierre.

Estos son enlaces portadores: quien reciba el enlace de otra persona podrá reemplazar su voto. No deben compartirse en un grupo. No equivalen a cuentas verificadas por VPN; la asignación individual corresponde al capitán. La clave administrativa y las copias de la base deben tratarse como privadas. En un despliegue público se recomienda HTTPS para proteger sesiones y enlaces.

## Fórmula v1

La puntuación significa posición relativa en el grupo de referencia, no una probabilidad ni una nota EA sobre 100. Se congela la versión `koru-potw-v1` al abrir cada semana.

### Datos y participación

- Se leen datos estructurados `__NEXT_DATA__` de páginas públicas de VPN. No hay API oficial garantizada para este contrato: si cambia el formato, el importador muestra un aviso y conserva la caché.
- Se usan únicamente estadísticas del partido, nunca `season.totals` ni los puntos propios de VPN.
- Semanas de lunes a domingo en `Europe/Madrid`, con cambio de hora automático. Las fechas de partido se conservan en UTC.
- El partido mantiene la semana asignada cuando se descubrió por primera vez, aunque VPN lo reprograme. No se puede recuperar automáticamente una fecha original que VPN cambió antes de la primera importación.
- Los forfaits no cuentan ni como actuaciones ni en el mínimo exigido. Un marcador 0–0 sin informe no significa partido completado.
- Para puntuar una actuación: posición reconocida, nota EA válida, al menos 30 minutos y campos EA requeridos disponibles. Una actuación incompleta de 30 minutos o más bloquea ese informe de KORU. Un registro sin EA/minutos también lo bloquea. No se rellena con ceros.
- Minutos de una actuación `m = min(90, minutos EA)`; para normalizar volumen `r = 90 / max(60, m)`.
- Para ser candidato: apariciones válidas ≥ `ceil(0.60 × partidos no forfait)` y minutos ≥ `0.60 × 90 × partidos no forfait`.
- El censo de votantes incluye a los jugadores de KORU con al menos una actuación válida, incluso si no alcanzan el mínimo para ser candidatos.

### Acciones por puesto

Las métricas se estabilizan para no premiar porcentajes como 1 pase completado de 1 intento. Todos los topes son públicos y deterministas. `P` son pases completados, `PA` intentados, `T` entradas completadas, `TA` intentadas, `G` goles, `A` asistencias y `CS` una portería a cero registrada para ese jugador.

```
pase    = 70 × min(1, (P+7)/(max(P,PA)+10)) + 30 × min(1, P×r/35)
defensa = 60 × min(1, T×r/5) + 40 × (T+1)/(max(T,TA)+2)
ataque  = min(100, (55×G + 40×A)×r)

PO  = 65 × min(1, paradas×r/8) + 20×CS + 0.15×pase
DEF = 0.55×defensa + 0.25×pase + 10×CS + 0.10×ataque
MED = 0.40×pase + 0.30×defensa + 0.30×ataque
DEL = 0.70×ataque + 0.20×pase + 0.10×defensa
```

Los grupos son los que indica VPN en el partido (portero, defensa, medio, delantero), no la posición habitual del jugador. Si cambia de puesto entre partidos se valora cada actuación según su puesto real.

### Comparación y media

Para cada grupo se reúnen las actuaciones válidas de ambos equipos en los partidos reportados de KORU de esa semana. No se descarga toda la liga ni se compara a un delantero con un portero.

Para la nota EA y para las acciones se calcula el percentil con empates por rango medio:

```
percentil(x) = 100 × (número de valores menores + 0.5 × número de iguales) / tamaño del grupo
```

Con menos de cuatro muestras, el percentil es neutral: 50. Los percentiles de acciones y EA tienen cada uno su grupo. Cada actuación pesa una vez en ese grupo de referencia.

```
partido = max(0, 0.70 × percentil EA + 0.30 × percentil acciones
                 - 2 × amarillas - 8 × rojas)
rendimiento semanal = suma(puntos partido × minutos) / suma(minutos)
```

La fuente solo proporciona ciertas acciones: no se inventan intercepciones, tiros a puerta, errores, ocasiones creadas ni un porcentaje real de paradas. Las porterías a cero dependen del evento individual registrado por VPN. Esta fórmula reduce el sesgo por puesto pero no puede medir aportaciones que el juego no registra. Es una primera regla fija y auditable; los futuros cambios de fórmula deberán versionarse sin reescribir premios ya abiertos.

### Votación y ganador

Los candidatos, actuaciones, versión y censo se congelan al abrir. Si VPN cambia el informe posteriormente, se muestra un aviso y se conserva la base de la votación. Los informes actuales siguen sincronizándose para consulta y detección de cambios.

```
cuórum = max(3, ceil(censo / 2))
apoyo = 100 × puntos recibidos / (papeletas válidas de otros jugadores × 3)
final = 0.80 × rendimiento + 0.20 × apoyo
```

La papeleta del propio candidato se excluye de su denominador, porque no puede votarse a sí mismo: participar no diluye el apoyo que recibe. Solo se aplica el componente de voto al cerrar con cuórum. Antes del cierre se muestra el rendimiento sin estimaciones de votos. Si no hay cuórum, el resultado final es el rendimiento. El MVP estadístico se muestra separadamente.

Desempate: puntos finales, rendimiento y minutos, en ese orden. Si los tres coinciden, premio compartido; el ID solo estabiliza el orden visual. Se conserva precisión de cuatro decimales para el cálculo, aunque la interfaz muestre uno.

## Operación y despliegue

- Tablas aditivas: `potw_meta`, `potw_fixtures`, `potw_reports`, `potw_weeks`, `potw_voters`, `potw_ballots`. No se modifica el esquema de otras funciones.
- Sincronización: tareas asíncronas, máximo tres peticiones simultáneas, timeout de 30 segundos. Se revisan los informes recientes en cada ciclo y los de más de catorce días como máximo una vez al día.
- Fallo de red o parsing: se conservan fixtures e informes previos; el aviso queda guardado y visible. El primer calendario es imprescindible para descubrir los partidos.
- Los votos se validan y escriben en una transacción SQLite con bloqueo inmediato y clave única `(semana, jugador)`. El plazo se comprueba en el servidor dentro de esa transacción.
- `KORU_POTW_AUTO_SYNC=false` desactiva el bucle para pruebas. La consulta manual sigue disponible. `python -m app.potw --sync` ejecuta una importación puntual.
- Se necesita que el servicio siga en ejecución para sincronizar y abrir semanas automáticamente. Cierres vencidos también se aplican al consultar la semana; una papeleta fuera de plazo se rechaza aunque el proceso haya estado parado.
- Rutas generales y de capitán exigen la sesión habitual; las de capitán también la clave privada. Únicamente la página de papeleta y su API son accesibles mediante enlace personal. Las respuestas POTW llevan `Cache-Control: no-store` y `Referrer-Policy: no-referrer`.

Para instalar en el miniPC sin sobrescribir cambios tácticos ajenos, usar `scripts/install_potw.sh` con el paquete preparado en `artifacts/potw-release.tar.gz`. El instalador comprueba primero el parche de integración, respalda código y SQLite, añade los nuevos archivos y aplica únicamente los cambios puntuales en `main.py` e `index.html`. No hace `git pull`, no cambia credenciales y no copia una base local al servidor.

Copiar el archivo al miniPC, extraerlo en una carpeta aparte y ejecutar desde esa carpeta, como propietario de la instalación: `bash scripts/install_potw.sh /opt/koru-dashboard`. El reinicio usa `sudo` si hace falta. Si el servicio utiliza una ruta de base distinta de `data/koru.db`, exportar primero su `KORU_DB_PATH` para respaldar la misma base. El script se detiene si el parche no encaja o ya existen los archivos nuevos; no sustituye una instalación desconocida. Los respaldos quedan en `data/backups/potw-*`.

## Pruebas

```
.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
node --test tests/tactics-geometry.test.js tests/tactics-store.test.js tests/tactics-model.test.js tests/squad-calendar.test.js
```

POTW incluye pruebas de calendario y cambio de hora, participación, posición, tarjetas, empates, ausencia de estadísticas, forfaits, cuórum, ocultación de votos, autovotos, duplicados, reemplazo, revocación, cierre, congelación e importación con errores.

E2E reproducible en PowerShell, usando una base NUEVA y descartable en cada ejecución (nunca la base del club):

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
npx playwright test tests/potw-e2e.spec.js --workers=1
```

El escenario de escritorio cierra la elección de prueba; por eso necesita una base nueva para repetirlo. Las pruebas de regresión existentes también deben apuntar a la instancia descartable. Los datos reales importados se han comprobado aparte, sin emitir votos de prueba en la base del club.

Verificación completada el 24 de octubre de 2026: 40 pruebas Python, 21 pruebas JavaScript, 3 recorridos Playwright POTW y los 10 recorridos Playwright existentes. Importación real sin avisos: 26 jornadas, 4 informes publicados y 15 participantes; 0 papeletas ficticias en la base del club. Capturas revisadas a 1440 px y en móvil de 375/390 px, sin desbordamiento horizontal de la página. El parche del paquete se ha aplicado y compilado en una copia del proyecto original. El despliegue remoto queda pendiente porque el miniPC rechazó la autenticación SSH disponible.
