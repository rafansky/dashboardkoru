# KORU eClub Dashboard

Dashboard privado para seguir KORU eClub en VPG, VPG Zero y PLG.

## Ejecutar en local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

En Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

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

Si quieres verla desde fuera de la red local, además de arrancarla en `10101` necesitarás redirigir ese puerto en el router hacia la IP del mini PC.

## Estructura

- `app/`: API FastAPI, conectores VPG/PLG, SQLite y uploads.
- `static/`: interfaz web sin build de Node.
- `data/`: base SQLite persistente.
- `uploads/`: archivos subidos por el club.
- `docker-compose.yml`: despliegue simple para el mini PC.
