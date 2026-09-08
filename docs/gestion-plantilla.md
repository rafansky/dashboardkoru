# Gestion de plantilla

Implementada en el dashboard FastAPI, no en el proyecto Next.js `koruweb`.
Ruta: `/gestion-plantilla`. Reutiliza el acceso privado del dashboard.

## Flujos

- Plantilla: alta, edicion, foto subida o URL, dorsal, posiciones, alias,
  cumpleanos, comunidad, redes, contacto y notas. Baja logica mediante estado
  inactivo. Importacion explicita de jugadores de la pizarra y del dashboard;
  deduplicacion por referencia de origen y nombre. No importa datos del Excel
  automaticamente ni inventa dorsales ausentes (usa 0 hasta completar la ficha).
- Dia: fecha en Madrid, once de 11 puestos, cinco formaciones, selector de
  jugadores, disponibilidad, asistencia real, notas y agenda con responsable.
  No disponible retira al jugador del once. Dudas y pendientes se pueden alinear.
  Guardado explicito; aviso antes de abandonar cambios. Copiar otro dia copia
  solo once y agenda, nunca asistencia ni disponibilidad.
- Mes: dias navegables, disponibilidad, titularidad y asistencia separados,
  totales por jugador y por dia. Exportacion CSV compatible con Excel.
- Pruebas: candidato, redes, equipo, posicion, arquetipo, estado de contacto,
  fecha, valoracion y notas; incorporacion explicita a plantilla.
- A pizarra: con 11 titulares, guarda una plantilla `KORU YYYY-MM-DD` en el
  recurso existente `/api/tactical-lineup-templates`. Abrir Pizarra y seleccionar
  esa alineacion. Es una instantanea; no altera pizarras previas ni sincroniza
  automaticamente futuros cambios de ficha con documentos existentes.

## Persistencia y permisos

`app/squad.py` registra su router en `app/main.py` y crea dos tablas adicionales
en la misma SQLite durante el arranque. No modifica tablas existentes.
`squad_records`: tipo, id, JSON validado con Pydantic, version y fecha UTC.
`squad_audit`: instantanea de cada escritura, para trazabilidad interna.
Una transaccion valida la version y guarda registro + auditoria. Version obsoleta
devuelve 409, evitando sobrescribir cambios de otro capitan.
Los jugadores inactivos siguen apareciendo en su historial mensual.
El registro diario usa fecha civil Madrid; las horas de agenda son locales.

Este dashboard tiene una clave compartida, sin roles personales: cualquier
persona autenticada puede ver contactos, notas y editar. Los enlaces de
espectador de pizarra no dan acceso a las APIs de plantilla. No se ha creado
un portal de respuesta individual para jugadores.

## Verificacion

- `python -m pytest -q`: incluye autenticacion, validacion, conflictos,
  importacion duplicada, once repetido/desconocido/no disponible, historico.
- `npx playwright test tests/squad-e2e.spec.js`: servidor aislado en
  `KORU_E2E_BASE_URL`, clave de pruebas; alta con foto, once, agenda, asistencia,
  plantilla tactica, mes y candidatos, capturas a 1440 y 375 px.
- Ejecutar pruebas contra una base temporal, nunca contra produccion.

## Mejoras futuras

Convocatoria por partido dentro de un mismo dia; permisos personales;
respuestas de disponibilidad por cada jugador; recordatorios; historial de
auditoria visible; edicion masiva mensual. Camisetas/pedidos no se han
implementado: las capturas solo muestran nombres de pestañas, no sus datos.
