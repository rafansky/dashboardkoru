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

La segunda fase del editor tactico esta disponible en `/tactics` y desde el enlace `Pizarra` del dashboard.

Incluye un documento tactico JSON versionado y validado, coordenadas reales de campo `105 x 68`, biblioteca SQLite, API CRUD, control de versiones, autosave, recovery draft local, undo/redo, vistas/orientaciones de campo, overlays y layout responsive. Permite añadir y arrastrar jugadores, seleccion multiple, zoom, pan y gestos tactiles.

La plantilla tactica admite jugadores personalizados de KORU o del rival con nombre, dorsal, posicion y cara subida. KORU se representa siempre en blanco y naranja. Cada pizarra puede vincularse a un partido y guardar sesiones historicas con observaciones, decisiones, ajustes, tareas y resultados asociados a minutos, escenas y jugadores seleccionados.

La linea de tiempo permite capturar el estado del campo como escena, duplicarlo, nombrarlo, anotar lo que debe pasar, definir su duracion y reproducir el movimiento hacia la siguiente escena. Las posiciones de una escena solo cambian al pulsar `Capturar`, para poder probar variantes sin perder la jugada guardada.

Pruebas:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -v
npm.cmd run test:tactics
```

## Estructura

- `app/`: API FastAPI, conectores VPG/PLG, SQLite y uploads.
- `static/`: interfaz web sin build de Node.
- `data/`: base SQLite persistente.
- `uploads/`: archivos subidos por el club.
- `docker-compose.yml`: despliegue simple para el mini PC.
