# Revisión de posiciones — 8 de noviembre de 2026

Alcance: código de `rafansky/dashboardkoru` en `ef78fe1`, creador de Farenn de `rafansky/webkorufaren` y muestras públicas oficiales de PLG y VPG. Esta revisión no cambia alineaciones ni redistribuye a los jugadores.

## Siglas de las fuentes

Se comprobó el informe PLG 780036: PO, DFC, MCD, MC, MD, MI, DD y DI, con grupos explícitos goalkeeper/defender/midfielder/forward. DD y DI son delanteros, no defensores. Se comprobó el informe VPG 1669657: GK, CB, CDM, CM, LM, RM y ST.

Equivalencias principales: GK ↔ POR/PO; CB ↔ DFC; LB/RB ↔ LI/LD; LWB/RWB ↔ CAI/CAD; CDM ↔ MCD; CM ↔ MC; CAM ↔ MCO; LM/RM ↔ MI/MD; LW/RW ↔ EI/ED; ST ↔ DC. No hay evidencia de que CB se traduzca como delantero en el creador.

## Hallazgos concretos

1. Los dos `lineup.js` tienen las mismas seis formaciones, puestos escritos directamente en español y un once habitual fijo. No obtienen los puestos automáticamente de PLG/VPG. La formación elegida y la elección manual determinan el puesto del jugador.
2. Al cambiar de formación conservan el array de jugadores por índice, no por rol. Caso comprobado: la casilla 1 pasa de DC en 3-1-4-2 a MI en 4-2-3-1. La convocatoria `static/squad.js` del dashboard también conserva los índices al cambiar de sistema. Esto puede recolocar jugadores de forma inesperada, independientemente del idioma.
3. En la 3-1-4-2 de ambos creadores, MCD y los dos MC tienen la misma profundidad (38). La convocatoria del dashboard sí define una línea separada para MCD. Existe una incoherencia visual entre módulos.
4. La carga en la pizarra del dashboard (`formationPositionsForLineup`) compara etiquetas literalmente y, si no coinciden, usa el primer hueco libre. No normaliza CB/DFC ni GK/POR antes de comparar. Es un riesgo para plantillas guardadas con siglas diferentes; no demuestra que los datos privados actuales estén mal.
5. Los presets de la pizarra y el creador no coinciden siempre: la 4-2-3-1 usa MI/MD en el creador y EI/ED en la pizarra; la 3-5-2 también difiere en los roles centrales y carrileros. Conviene unificar los esquemas antes de asignar jugadores automáticamente.
6. La exportación del creador a la pizarra usa x creciente hacia el portero: en 4-3-3 exporta POR aproximadamente x=94,9 y DC x=11. El preset de esa pizarra usa POR x=8 y DC x=72 para ataque hacia la derecha. Hay una orientación longitudinal distinta que debe tenerse en cuenta al cargar la plantilla.

## Cambio autorizado después de la revisión

Se añadió `static/player-positions.js` para ordenar las listas de asistencia por líneas, con equivalencias EN/ES y posiciones desconocidas al final. Solo ordena la presentación: no corrige ni cambia los roles, la orientación o las asignaciones de los onces anteriores. Los hallazgos del creador y de la pizarra siguen pendientes de un cambio específico.
