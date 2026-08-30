# KORU eClub Dashboard

Dashboard privado para seguir KORU eClub en VPG, VPG Zero y PLG.

Ahora incluye una puerta de acceso privada para entrar a la web.

## Ejecutar en local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export KORU_ACCESS_PASSWORD="pon_aqui_una_clave_larga"
# opcional: export KORU_AUTH_SECRET="$(openssl rand -hex 32)"
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

En Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:KORU_ACCESS_PASSWORD="pon_aqui_una_clave_larga"
# opcional: $env:KORU_AUTH_SECRET="clave-larga-aleatoria"
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

Variables:

- `KORU_ACCESS_PASSWORD` (obligatoria): clave para entrar al panel.
- `KORU_AUTH_SECRET` (recomendada): secreto para firmar la cookie de sesion.
- `KORU_AUTH_SESSION_HOURS` (opcional, por defecto `12`): duracion de sesion.
- `KORU_COOKIE_SECURE` (opcional): `true` en HTTPS para enviar cookie solo por TLS.

## Ejecutar con Docker

```bash
docker compose up -d --build
```

La web queda en `http://localhost:8080`.

## Desplegar al mini PC por SSH

Desde PowerShell, indicando el usuario SSH real del mini PC:

```powershell
.\scripts\deploy_remote.ps1 -User TU_USUARIO -Password "TU_PASSWORD"
```

El script copia la app a `/opt/koru-dashboard`, crea un entorno Python, instala dependencias y deja un servicio `systemd` en el puerto `10101` para no pisar otros paneles que ya usen `80` o `8080`.

La web queda accesible en la LAN en `http://192.168.1.133:10101`.

El port forwarding externo ya está configurado sobre `10101` hacia el mini PC, así que también se puede entrar desde fuera por ese puerto.

La password activa vive solo en el servicio del mini PC como variable de entorno, no queda hardcodeada en el repo.

## Pizarra tactica

### Alineaciones reutilizables

En el panel izquierdo, bajo los equipos, el bloque **Alineaciones** permite guardar los jugadores KORU colocados como plantilla con nombre y sistema. Al cargar una, solo sustituye los jugadores KORU de la pizarra: conserva rival, balon, dibujos, anotaciones y analisis. La posicion se aplica en todas las escenas para que la linea temporal siga siendo coherente.

### Convocatoria y disponibilidad

Al vincular una pizarra con un partido aparece **Convocatoria** en las propiedades. Registra por jugador `Disponible`, `Duda`, `No disponible` o `Convocado`, con una nota opcional. Cada respuesta queda guardada en ese partido y el listado de alineaciones puede rellenar la convocatoria del informe; pulsa **Guardar informe** para hacerla definitiva.

### Biblioteca táctica

Guarda cualquier pizarra como jugada reutilizable con nombre, categoría y descripción. La plantilla conserva campo, jugadores, movimientos, anotaciones y escenas, pero no el partido ni la bitácora. Desde la barra izquierda puedes filtrarla y crear una pizarra nueva desde una jugada sin alterar su original.

### Formaciones rápidas

El selector **Formación rápida** añade los puestos vacíos de KORU para `4-2-3-1`, `4-3-3`, `4-4-2`, `3-5-2` y `5-2-1-2`. Después carga una alineación guardada para ocupar esos puestos: se asigna por posición cuando existe coincidencia y conserva rival, balón, anotaciones y escenas.

El editor tactico esta disponible en `/tactics` y desde el enlace `Pizarra` del dashboard. Incluye las fases 1 a 9: editor 2D, escenas y reproduccion, anotaciones, expedientes de partido, trabajo en directo, plantillas de alineacion, convocatorias, biblioteca tactica, formaciones rapidas y modo presentacion.

Incluye un documento tactico JSON versionado y validado, coordenadas reales de campo `105 x 68`, biblioteca SQLite, API CRUD, control de versiones, autosave, recovery draft local, undo/redo, vistas/orientaciones de campo, overlays y layout responsive. Permite añadir y arrastrar jugadores, seleccion multiple, zoom, pan y gestos tactiles.

La plantilla tactica admite jugadores personalizados de KORU o del rival con nombre, dorsal, posicion y cara subida. KORU se representa siempre en blanco y naranja. Cada pizarra puede vincularse a un partido y guardar sesiones historicas con observaciones, decisiones, ajustes, tareas y resultados asociados a minutos, escenas y jugadores seleccionados. Al vincular un encuentro aparece tambien su informe compartido: estado, marcador, convocatoria, resumen, conclusiones y etiquetas. El informe pertenece al partido, no a una pizarra concreta, para que las preparaciones y sesiones futuras queden en el mismo expediente.

La linea de tiempo permite capturar el estado del campo como escena, duplicarlo, nombrarlo, anotar lo que debe pasar, definir su duracion y reproducir el movimiento hacia la siguiente escena. Las posiciones de una escena solo cambian al pulsar `Capturar`, para poder probar variantes sin perder la jugada guardada.

En **Presentacion**, el boton de la cabecera o la tecla `P` deja el campo limpio para explicarlo. Las capas de KORU, rival, balon, nombres, anotaciones y lineas del campo se pueden encender o apagar sin modificar ni guardar la pizarra. `Esc` sale de ese modo.

## Historial de partidos

`/match-history` es el espacio de consulta para managers. Agrupa cada informe con sus pizarras y sesiones vinculadas por partido, y permite filtrar por rival, competicion, estado y etiquetas. Desde cada elemento se puede volver directamente a la pizarra correspondiente.

Dentro de cada expediente, `Adjuntar` permite subir capturas, clips o documentos. El archivo se conserva en la biblioteca del club y queda asociado al partido sin duplicarlo. `Imprimir` abre una version limpia del expediente para guardarla como PDF desde el dialogo de impresion del navegador.

El bloque `Plan de partido` sirve para preparar el scouting del rival: perfil, amenazas, balon parado, objetivos y checklist. `Usar plantilla` carga una base corta que se puede ajustar, marcar y guardar para cada encuentro.

Con una pizarra vinculada, el panel `Registro en directo` permite anotar gol, gol rival, cambio, tarjeta, ajuste tactico o nota con minuto opcional. Los eventos se guardan en el expediente y aparecen tambien en el historial.

Pruebas:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -v
npm.cmd run test:tactics
npm.cmd run test:tactics:e2e
```

La prueba E2E necesita la aplicacion ejecutandose. Por defecto usa `http://127.0.0.1:10102`; se puede cambiar con `KORU_E2E_BASE_URL` y `KORU_E2E_PASSWORD`.

## Estructura

- `app/`: API FastAPI, conectores VPG/PLG, SQLite y uploads.
- `static/`: interfaz web sin build de Node.
- `data/`: base SQLite persistente.
- `uploads/`: archivos subidos por el club.
- `docker-compose.yml`: despliegue simple para el mini PC.
