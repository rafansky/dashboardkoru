export const availabilityLabels = {pending:'Sin respuesta', available:'Disponible', maybe:'Duda', unavailable:'No disponible'};
export const attendanceLabels = {pending:'Sin registrar', present:'Presente', late:'Llegó tarde', excused:'Falta justificada', absent:'Faltó'};
export const participationLabels = {pending:'Sin registrar', played:'Jugó', not_played:'No jugó'};
const weekdays = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const dateObject = value => new Date(value+'T12:00:00Z');
export const dateLabel = value => new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(dateObject(value));
export function monthWeeks(month) {
  const [year,m]=month.split('-').map(Number);
  const count=new Date(Date.UTC(year,m,0)).getUTCDate();
  const groups=[];
  for(let i=1;i<=count;i++) {
    const value=month+'-'+String(i).padStart(2,'0');
    if(!groups.length||dateObject(value).getUTCDay()===1)groups.push([]);
    groups.at(-1).push(value);
  }
  return groups;
}
export function playerRecords(days,id) {
  return days.filter(d=>d.responses[id]||d.lineup.includes(id)).map(d=>({
    date:d.id, fixtures:d.fixtures||[], called:d.lineup.includes(id),
    availability:'pending', attendance:'pending', participation:'pending', note:'', ...d.responses[id],
  })).sort((a,b)=>b.date.localeCompare(a.date));
}
export const recordFilters = {
  all:()=>true,
  present:r=>['present','late'].includes(r.attendance),
  absent:r=>['absent','excused'].includes(r.attendance),
  played:r=>r.participation==='played',
  confirmedNoPlay:r=>r.availability==='available'&&r.participation==='not_played',
  confirmedAbsent:r=>r.availability==='available'&&['absent','excused'].includes(r.attendance),
  unknown:r=>r.attendance==='pending'||r.participation==='pending',
};
const filterLabels={all:'Todos los registros',present:'Asistió',absent:'Faltó',played:'Jugó',confirmedNoPlay:'Confirmó y no jugó',confirmedAbsent:'Confirmó y faltó',unknown:'Pendiente de completar'};
const esc = (v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let view='week',week=0,metric='attendance',player='',historyFilter='all',lastMonth='';

export function mountCalendar(root, {month,today,players,days,changeMonth,openDay,editRecord,download}) {
  const weeks=monthWeeks(month);
  if(lastMonth!==month){week=Math.max(0,weeks.findIndex(w=>w.includes(today)));lastMonth=month;}
  const byDate=Object.fromEntries(days.map(d=>[d.id,d]));
  const roster=players.filter(p=>p.status!=='inactive'||playerRecords(days,p.id).length).sort((a,b)=>a.position.localeCompare(b.position)||a.name.localeCompare(b.name));
  if(!roster.some(p=>p.id===player))player=roster[0]?.id||'';
  const monthName=new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric',timeZone:'UTC'}).format(dateObject(month+'-01'));
  const options=(map,v)=>Object.entries(map).map(([key,label])=>`<option value="${key}" ${key===v?'selected':''}>${esc(label)}</option>`).join('');
  const badges=r=>`<span class="badge ${r.availability}">${availabilityLabels[r.availability]}</span><span class="badge ${r.attendance}">${r.attendance==='pending'?'Asistencia sin registrar':attendanceLabels[r.attendance]}</span><span class="badge ${r.participation}">${r.participation==='pending'?'Participación sin registrar':participationLabels[r.participation]}</span>`;
  function draw() {
    const selectedWeeks=view==='week'?[weeks[week]]:weeks;
    const dates=selectedWeeks.flat();
    const labels={availability:availabilityLabels,attendance:attendanceLabels,participation:participationLabels,called:{yes:'Titular',no:'Sin convocar'}};
    const metrics={availability:'Disponibilidad',attendance:'Asistencia real',participation:'Participación',called:'Once inicial'};
    root.innerHTML=`<div class="bar"><h2>Asistencia · ${esc(monthName)}</h2><input id="month" type="month" value="${month}" aria-label="Mes"><button data-cal="export"><i data-lucide="download"></i>Exportar historial</button></div>
      <div class="calendar-controls"><div class="calendar-modes" aria-label="Periodo"><button data-cal="week" aria-pressed="${view==='week'}">Semana</button><button data-cal="month" aria-pressed="${view==='month'}">Mes completo</button></div>
      <label>Semana<select id="calendar-week" ${view==='month'?'disabled':''}>${weeks.map((w,i)=>`<option value="${i}" ${i===week?'selected':''}>Semana ${i+1} · ${Number(w[0].slice(-2))} al ${Number(w.at(-1).slice(-2))}</option>`).join('')}</select></label>
      <label>Mostrar<select id="calendar-metric">${options(metrics,metric)}</select></label></div>
      <div class="calendar-legend">${Object.entries(labels[metric]).map(([key,label])=>`<span class="badge ${key}">${label}</span>`).join('')}<span class="badge">Sin registro: día sin datos de ese jugador</span></div>
      <div class="table-wrap calendar-scroll" tabindex="0" aria-label="Calendario de ${esc(monthName)}"><table class="attendance-calendar"><thead><tr><th rowspan="2" scope="col">Jugador</th>${selectedWeeks.map(w=>`<th colspan="${w.length}" scope="colgroup" class="week-group">Semana ${weeks.indexOf(w)+1} · ${Number(w[0].slice(-2))} al ${Number(w.at(-1).slice(-2))}</th>`).join('')}</tr><tr>${dates.map(d=>`<th scope="col" class="${dateObject(d).getUTCDay()===1?'week-start':''} ${[0,6].includes(dateObject(d).getUTCDay())?'weekend':''}"><button data-cal="day" data-date="${d}" title="${dateLabel(d)}"><span>${weekdays[dateObject(d).getUTCDay()]}</span><strong>${Number(d.slice(-2))}</strong>${byDate[d]?.fixtures.length?`<small>${byDate[d].fixtures.length} partidos</small>`:''}</button></th>`).join('')}</tr></thead><tbody>${roster.map(p=>`<tr><th scope="row"><button class="calendar-player" data-cal="player" data-id="${p.id}"><strong>${esc(p.name)}</strong><small>${esc(p.position)} · #${p.number}</small></button></th>${dates.map(d=>{const row=byDate[d],r=row?.responses[p.id];const called=row?.lineup.includes(p.id);const registered=!!r||called;const state=metric==='called'?(called?'yes':'no'):(r?.[metric]||'pending');return `<td class="${dateObject(d).getUTCDay()===1?'week-start':''}"><button class="calendar-cell ${registered?state:'empty-cell'}" data-cal="record" data-date="${d}" data-id="${p.id}" aria-label="${esc(p.name)} · ${dateLabel(d)} · ${registered?labels[metric][state]:'Sin registro'}">${registered?labels[metric][state]:'Sin registro'}${r?.note?'<span class="note-dot" title="Con observación">*</span>':''}</button></td>`;}).join('')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">${metrics[metric]}</th>${dates.map(d=>{const count=roster.filter(p=>metric==='called'?byDate[d]?.lineup.includes(p.id):metric==='availability'?byDate[d]?.responses[p.id]?.availability==='available':metric==='participation'?byDate[d]?.responses[p.id]?.participation==='played':['present','late'].includes(byDate[d]?.responses[p.id]?.attendance)).length;return `<td>${count} ${metric==='called'?'titulares':metric==='availability'?'disponibles':metric==='participation'?'jugaron':'asistieron'}</td>`;}).join('')}</tr></tfoot></table></div>
      ${!roster.length?'<p class="empty">No hay jugadores en este periodo.</p>':''}
      <section id="player-history"><div class="bar"><h2>Historial individual · ${esc(monthName)}</h2><label>Jugador<select id="history-player">${roster.map(p=>`<option value="${p.id}" ${p.id===player?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label></div><div id="history-content"></div></section>`;
    root.querySelector('#calendar-week').onchange=e=>{week=Number(e.target.value);draw();};
    root.querySelector('#calendar-metric').onchange=e=>{metric=e.target.value;draw();};
    root.querySelector('#month').onchange=e=>{if(e.target.value)changeMonth(e.target.value);};
    root.querySelector('#history-player').onchange=e=>{player=e.target.value;historyFilter='all';drawHistory();};
    root.querySelector('.attendance-calendar').style.minWidth=Math.max(920,160+dates.length*110)+'px';
    drawHistory();window.lucide?.createIcons();
  }
  function drawHistory() {
    const entries=playerRecords(days,player);
    const filtered=entries.filter(recordFilters[historyFilter]);
    root.querySelector('#history-content').innerHTML=`<div class="history-metrics">${['present','absent','played','confirmedNoPlay','confirmedAbsent'].map(key=>`<button data-cal="filter" data-filter="${key}" aria-pressed="${historyFilter===key}"><strong>${entries.filter(recordFilters[key]).length}</strong><span>${filterLabels[key]}</span></button>`).join('')}</div>
      <div class="bar"><label>Ver días<select id="history-filter">${options(filterLabels,historyFilter)}</select></label><span>${filtered.length} registros</span></div>
      <div class="history-records">${filtered.map(r=>`<article class="history-record"><div><strong>${dateLabel(r.date)}</strong><small>${r.fixtures.map(f=>esc(f.opponent)).join(' · ')||'Sesión del club'}${r.called?' · Once inicial':''}</small></div><div class="record-badges">${badges(r)}</div>${r.note?`<p>${esc(r.note)}</p>`:''}<button data-cal="record" data-date="${r.date}" data-id="${player}" title="Editar registro del ${r.date}" aria-label="Editar registro del ${r.date}"><i data-lucide="pencil"></i></button></article>`).join('')||'<p class="empty">No hay registros con este filtro.</p>'}</div>`;
    root.querySelector('#history-filter').onchange=e=>{historyFilter=e.target.value;drawHistory();};window.lucide?.createIcons();
  }
  root.onclick=e=>{
    const b=e.target.closest('[data-cal]');if(!b)return;
    const type=b.dataset.cal;
    if(type==='week'||type==='month'){view=type;draw();}
    if(type==='day')openDay(b.dataset.date);
    if(type==='record')editRecord(b.dataset.id,b.dataset.date);
    if(type==='player'){player=b.dataset.id;historyFilter='all';draw();root.querySelector('#player-history').scrollIntoView({block:'start',behavior:'instant'});}
    if(type==='filter'){historyFilter=b.dataset.filter;drawHistory();}
    if(type==='export')download([['Fecha','Día','Jugador','Disponibilidad','Asistencia','Participación','Titular','Observación'],...roster.flatMap(p=>playerRecords(days,p.id).map(r=>[r.date,dateLabel(r.date),p.name,availabilityLabels[r.availability],attendanceLabels[r.attendance],participationLabels[r.participation],r.called?'Sí':'No',r.note]))],`koru-asistencia-${month}.csv`);
  };
  draw();
}
