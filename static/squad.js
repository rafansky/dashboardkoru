import { mountCalendar, participationLabels, dateLabel, simpleLabels, simpleAttendance, simpleResponse } from './squad-calendar.js?v=3';
const $ = (s) => document.querySelector(s);
const esc = (v = '') => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = () => window.lucide?.createIcons();
const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let players = [], candidates = [], days = [], day = null, tab = 'month', selectedDate = today, month = today.slice(0,7), dirty = false, busy = false, search = '', filter = 'active', slot = 0, profile = null;
const availability = {pending:'Pendiente',available:'Disponible',maybe:'Duda',unavailable:'No disponible'};
const attendance = {pending:'Sin registrar',present:'Presente',late:'Tarde',excused:'Justificado',absent:'Ausente'};
const statuses = {active:'Activo',trial:'En pruebas',inactive:'Inactivo'};
const trialStatuses = {pending:'Sin noticias',contacted:'Contactado',scheduled:'Prueba agendada',staff:'Decision del staff',player:'Decision del jugador',accepted:'Aceptado',rejected:'Descartado'};
const formations = {
  '4-3-3':[['POR'],['LI','DFC','DFC','LD'],['MC','MCD','MC'],['EI','DC','ED']],
  '4-2-3-1':[['POR'],['LI','DFC','DFC','LD'],['MCD','MCD'],['MI','MCO','MD'],['DC']],
  '3-5-2':[['POR'],['DFC','DFC','DFC'],['CAI','MC','MCD','MC','CAD'],['DC','DC']],
  '3-1-4-2':[['POR'],['DFC','DFC','DFC'],['MCD'],['MI','MC','MC','MD'],['DC','DC']],
  '4-4-2':[['POR'],['LI','DFC','DFC','LD'],['MI','MC','MC','MD'],['DC','DC']],
};
const positions = ['LIBRE','POR','GK','DFC','LD','LI','CAD','CAI','CAR','MCD','MC','MV','MD','MI','MCO','ED','EI','SD','DC'];
const opt = (map, value) => Object.entries(map).map(([k,v]) => `<option value="${esc(k)}" ${k===String(value)?'selected':''}>${esc(v)}</option>`).join('');
const iconButton = (action, icon, label, id='') => `<button class="icon" data-action="${action}" data-id="${esc(id)}" title="${esc(label)}" aria-label="${esc(label)}"><i data-lucide="${icon}"></i></button>`;
const avatar = p => p.avatarUrl ? `<img class="avatar" src="${esc(p.avatarUrl)}" alt="" loading="lazy">` : `<span class="avatar">${p.number || p.name.slice(0,1)}</span>`;
const person = p => `<div class="person">${avatar(p)}<div><strong>${esc(p.name)}</strong><small>${esc(p.position)}${p.alias ? ' · '+esc(p.alias):''}</small></div></div>`;
function notify(message) { $('#toast').textContent=message; $('#toast').style.display='block'; clearTimeout(notify.timer); notify.timer=setTimeout(()=>$('#toast').style.display='none',4000); }
async function api(path, method='GET', data) {
  const r = await fetch(path,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
  if(r.status===401) { location.href='/login'; throw new Error('Sesion caducada'); }
  const result=await r.json();
  if(!r.ok) throw new Error(typeof result.detail==='string'?result.detail:Array.isArray(result.detail)?result.detail.map(e=>e.msg).join('. '):'No se pudo guardar');
  return result;
}
const payload = obj => { const {id,updatedAt,...rest}=obj; return rest; };
const active = () => players.filter(p=>p.status!=='inactive');
function markDirty() { dirty=true; const el=$('#save-state'); if(el) el.textContent='Cambios sin guardar'; }
function canLeave() { return !dirty || confirm('Hay cambios sin guardar en este dia. ¿Descartarlos?'); }
function slots() {return formations[day.formation].flatMap((row,r,rows)=>row.map((label,c)=>({label,x:(c+1)*100/(row.length+1),y:90-r*78/(rows.length-1)})));}
async function load() {
  [players,candidates]=await Promise.all([api('/api/squad/players'),api('/api/squad/candidates')]);
  days=await api('/api/squad/days?month='+month);
  render();
  const playerId = new URLSearchParams(location.hash.slice(1)).get('jugador');
  if(playerId && players.some(item=>item.id===playerId)) openPlayerProfile(playerId);
}
async function navigate(next, date=selectedDate) {
  if(!canLeave())return;
  dirty=false; tab=next; selectedDate=date;
  $('#notice').hidden=true; $('#workspace').textContent='Cargando...';
  if(tab==='day') day=await api('/api/squad/days/'+date);
  if(tab==='month') days=await api('/api/squad/days?month='+month);
  render();
}
function render() {
  $('#workspace').onclick=null;
  document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-current',b.dataset.tab===tab?'page':'false'));
  if(tab==='players')renderPlayers();
  if(tab==='day')renderDay();
  if(tab==='month')renderMonth();
  if(tab==='candidates')renderCandidates();
  icons();
}
function renderPlayers() {
  $('#workspace').innerHTML=`<div class="bar"><h2>Plantilla del club</h2><input id="search" type="search" placeholder="Buscar jugador" aria-label="Buscar jugador" value="${esc(search)}"><select id="status-filter" aria-label="Estado">${opt({'':'Todos',...statuses},filter)}</select><button data-action="import"><i data-lucide="users-round"></i>Importar de pizarra</button><button class="primary" data-action="add-player"><span aria-hidden="true">*</span> Añadir jugador</button>${iconButton('csv','download','Exportar plantilla CSV')}</div><div class="summary"><span><strong>${players.filter(p=>p.status==='active').length}</strong>activos</span><span><strong>${players.filter(p=>p.status==='trial').length}</strong>en pruebas</span><span><strong>${players.filter(p=>p.status==='inactive').length}</strong>inactivos</span></div><div id="player-table"></div>`;
  renderPlayerTable();
  $('#search').oninput=e=>{search=e.target.value;renderPlayerTable();};
  $('#status-filter').onchange=e=>{filter=e.target.value;renderPlayerTable();};
}
function renderPlayerTable() {
  const list=players.filter(p=>(!filter||p.status===filter)&&`${p.name} ${p.alias} ${p.position}`.toLowerCase().includes(search.toLowerCase()));
  $('#player-table').innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th>Jugador</th><th>Dorsal</th><th>Estado</th><th>Cumple</th><th>Comunidad</th><th>X / Twitter</th><th>Ficha</th></tr></thead><tbody>${list.map(p=>`<tr><td>${person(p)}</td><td>${p.number}</td><td><span class="badge ${p.status}">${statuses[p.status]}</span></td><td>${p.birthday?esc(p.birthday.slice(5).split('-').reverse().join('/')):'—'}</td><td>${esc(p.region)||'—'}</td><td>${esc(p.twitter)||'—'}</td><td><button class="profile-button" data-action="view-profile" data-id="${p.id}">Ver ficha</button>${iconButton('edit-player','pencil','Editar '+p.name,p.id)}${p.status!=='inactive'?`<button class="remove-player" data-action="remove-player" data-id="${p.id}" aria-label="Quitar a ${esc(p.name)} de la plantilla">−</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No hay jugadores con estos filtros.</div>';
  icons();
}
function renderDay() {
  const count=day.lineup.filter(Boolean).length;
  $('#workspace').innerHTML=`<div class="bar"><h2>Dia de partido</h2><input id="day-date" type="date" aria-label="Fecha del dia" value="${selectedDate}"><select id="formation" aria-label="Formacion">${opt(Object.fromEntries(Object.keys(formations).map(f=>[f,f])),day.formation)}</select><span id="save-state" class="unsaved">${dirty?'Cambios sin guardar':day.version?'Guardado':'Sin actividad guardada'}</span><button data-action="copy-day"><i data-lucide="copy"></i>Copiar otro dia</button><button class="primary" data-action="save-day"><i data-lucide="save"></i>Guardar dia</button></div><div class="day-grid"><section><div class="section-title"><strong>Once inicial · ${count}/11</strong><button data-action="export-lineup" ${count!==11?'disabled':''}><i data-lucide="clipboard-pen-line"></i>A pizarra</button></div><div class="pitch" aria-label="Once inicial"><div class="area top-area"></div><div class="area bottom-area"></div>${slots().map((s,i)=>{const p=players.find(p=>p.id===day.lineup[i]);return `<button class="slot" style="left:${s.x}%;top:${s.y}%" data-action="slot" data-id="${i}" aria-label="${s.label}: ${esc(p?.name||'Elegir jugador')}">${p?avatar(p):'<span class="avatar vacant">+</span>'}<small>${esc(p?.name||s.label)}</small></button>`;}).join('')}</div><label>Notas de la sesion<textarea id="day-notes" maxlength="3000">${esc(day.notes)}</textarea></label><h3 class="section-title">Agenda de partidos<button data-action="add-fixture" class="icon" aria-label="Anadir partido"><i data-lucide="plus"></i></button></h3>${day.fixtures.length?day.fixtures.map((f,i)=>`<div class="fixture ${f.done?'done':''}"><input type="checkbox" data-done="${i}" ${f.done?'checked':''} aria-label="Completado: ${esc(f.opponent)}"><div><strong>${f.time} · ${esc(f.opponent)}</strong><small>${esc(f.competition)} · ${esc(f.owner||'Sin responsable')}</small></div>${iconButton('edit-fixture','pencil','Editar partido',i)}${iconButton('remove-fixture','trash-2','Eliminar partido',i)}</div>`).join(''):'<p class="empty">Sin partidos programados.</p>'}</section><section><h3 class="section-title">Disponibilidad y pase de lista</h3><div class="summary"><span><strong>${Object.values(day.responses).filter(r=>r.availability==='available').length}</strong>disponibles</span><span><strong>${Object.values(day.responses).filter(r=>['present','late'].includes(r.attendance)).length}</strong>asistieron</span></div><div class="response-row response-head"><span>Jugador</span><span>Disponibilidad</span><span>Asistencia real</span></div>${active().map(p=>{const r=day.responses[p.id]||{};return `<div class="response-row">${person(p)}<select data-response="availability" data-id="${p.id}" aria-label="Disponibilidad de ${esc(p.name)}">${opt(availability,r.availability||'pending')}</select><select data-response="attendance" data-id="${p.id}" aria-label="Asistencia de ${esc(p.name)}">${opt(attendance,r.attendance||'pending')}</select></div>`;}).join('')||'<p class="empty">Crea o importa jugadores en Plantilla.</p>'}<div class="bar" style="margin-top:14px"><button data-action="mark-present"><i data-lucide="list-checks"></i>Marcar titulares presentes</button></div></section></div>`;
  $('#day-date').onchange=e=>run(()=>navigate('day',e.target.value||selectedDate));
  $('#formation').onchange=e=>{day.formation=e.target.value;markDirty();render();};
  $('#day-notes').oninput=e=>{day.notes=e.target.value;markDirty();};
  $('.response-head').insertAdjacentHTML('beforeend','<span>Participación</span>');
  document.querySelectorAll('[data-response=attendance]').forEach(el=>{
    const p=players.find(p=>p.id===el.dataset.id);
    el.insertAdjacentHTML('afterend',`<select data-response="participation" data-id="${p.id}" aria-label="Participación de ${esc(p.name)}">${opt(participationLabels,day.responses[p.id]?.participation||'pending')}</select>`);
    el.parentElement.querySelector('.person>div').insertAdjacentHTML('beforeend',`<button class="record-link" data-action="attendance-record" data-id="${p.id}">Registro${day.responses[p.id]?.note?' *':''}</button>`);
  });
}
function renderMonth() {
  mountCalendar($('#workspace'), {month,today,players,days,
    changeMonth:value=>{month=value;run(()=>navigate('month'));},
    openDay:date=>run(()=>navigate('day',date)),
    editRecord:(pid,date)=>run(()=>editAttendance(pid,date)),openProfile:pid=>run(()=>openPlayerProfile(pid)),download:downloadCsv});
}

async function editAttendanceDetails(pid,date) {
  const p=players.find(p=>p.id===pid);
  const editingDay=tab==='day'&&selectedDate===date;
  const record=editingDay?day:await api('/api/squad/days/'+date);
  const r={availability:'pending',attendance:'pending',participation:'pending',note:'',...record.responses[pid]};
  openEditor(`${p.name} · ${dateLabel(date)}`,
    field('availability','Disponibilidad confirmada',r.availability,'text',availability)+
    field('attendance','Asistencia real',r.attendance,'text',attendance)+
    field('participation','Participación real',r.participation,'text',participationLabels)+
    field('note','Observación / motivo',r.note,'textarea'),async data=>{
      const updated=structuredClone(record);
      updated.responses[pid]=data;
      if(data.availability==='unavailable')updated.lineup=updated.lineup.map(id=>id===pid?null:id);
      if(editingDay){day=updated;markDirty();return;}
      const saved=await api('/api/squad/days/'+date,'PUT',payload(updated));
      days=[...days.filter(d=>d.id!==date),saved];notify('Registro guardado');
    });
  $('#fields [name=note]').maxLength=500;
  $('#fields [name=participation]').onchange=e=>{
    if(e.target.value==='played'&&$('#fields [name=attendance]').value==='pending')$('#fields [name=attendance]').value='present';
  };
  $('#fields [name=attendance]').onchange=e=>{
    if(['absent','excused'].includes(e.target.value))$('#fields [name=participation]').value='not_played';
    if(e.target.value==='pending'&&$('#fields [name=participation]').value==='played')$('#fields [name=participation]').value='pending';
  };
}
async function editAttendance(pid,date) {
  const p=players.find(p=>p.id===pid);
  const editingDay=tab==='day'&&selectedDate===date;
  const record=editingDay?day:await api('/api/squad/days/'+date);
  const previous=record.responses[pid]||{};
  openEditor(p.name+' · '+dateLabel(date),
    '<div class="wide attendance-help">Elige un estado. Se guarda al pulsarlo.</div>'+
    '<div class="wide attendance-choices">'+Object.entries(simpleLabels).map(([state,label])=>
      '<button type="button" class="simple-state '+state+'" data-attendance-choice="'+state+'" aria-pressed="'+(simpleAttendance(previous)===state)+'">'+label+'</button>').join('')+'</div>'+
    field('note','Observación (opcional)',previous.note||'','textarea'),async()=>{});
  $('#fields [name=note]').maxLength=500;
  $('#edit-form button[type=submit]').hidden=true;
  $('#fields').insertAdjacentHTML('beforeend','<button type="button" class="wide" id="attendance-details">Más detalles de este día</button>');
  $('#attendance-details').onclick=()=>editAttendanceDetails(pid,date);
  document.querySelectorAll('[data-attendance-choice]').forEach(button=>button.onclick=async()=>{
    const buttons=[...document.querySelectorAll('[data-attendance-choice]')];
    buttons.forEach(b=>b.disabled=true);
    try {
      const updated=structuredClone(record);
      updated.responses[pid]=simpleResponse(button.dataset.attendanceChoice,{...previous,note:$('#fields [name=note]').value.trim()});
      if(editingDay){day=updated;markDirty();}
      else {
        const saved=await api('/api/squad/days/'+date,'PUT',payload(updated));
        days=[...days.filter(d=>d.id!==date),saved];
      }
      $('#editor').close();render();notify(editingDay?'Estado elegido. Pulsa Guardar día al terminar.':'Asistencia guardada');
    } catch(err){$('#form-error').textContent=err.message;buttons.forEach(b=>b.disabled=false);}
  });
}
async function removePlayer(id) {
  const p=players.find(p=>p.id===id);
  if(!confirm('¿Quitar a '+p.name+' de la plantilla? Su historial se conserva. Puedes recuperarlo en Plantilla → Inactivos.'))return;
  const saved=await api('/api/squad/players/'+id,'PUT',{...payload(p),status:'inactive'});
  players=players.map(item=>item.id===id?saved:item);
  render();notify('Jugador retirado. Su historial se conserva.');
}
function profileDate(value) {
  return value ? new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value)) : '—';
}
function profileAttendanceState(row) {
  if(['present','late'].includes(row.attendance)) return row.participation==='not_played' ? 'bench' : 'present';
  if(['absent','excused'].includes(row.attendance)) return 'absent';
  return 'pending';
}
function profileStat(label,value) { return `<div class="profile-stat"><strong>${esc(value ?? '—')}</strong><span>${esc(label)}</span></div>`; }
function printableUrl(value) {
  if(!value) return '';
  try {
    const url=new URL(value,window.location.origin);
    return ['http:','https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
function playerPdfHtml() {
  const {player,attendance: club,annotations,league}=profile;
  const summary=club.summary;
  const photo=printableUrl(player.avatarUrl);
  const logo=printableUrl('/assets/koru-logo.png');
  const initial=esc((player.number||player.name||'?').toString().slice(0,2));
  const clubStats=[['Días marcados',summary.markedDays],['Está',summary.present],['No está',summary.absent],['No jugó',summary.bench],['Jugó',summary.played],['Titular',summary.called]];
  const leagueStats=league ? [['Partidos',league.matchesPlayed],['Goles',league.goals],['Asistencias',league.assists],['Rating',league.rating||'—'],['ELO',league.elo]] : [];
  const statCards=stats=>stats.map(([label,value])=>`<div class="stat"><strong>${esc(value ?? '—')}</strong><span>${esc(label)}</span></div>`).join('');
  const details=[['Posición',player.position],['Otras posiciones',player.secondary],['Comunidad',player.region],['Cumpleaños',player.birthday],['X / Twitter',player.twitter],['Contacto',player.contact]];
  const detailRows=details.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value||'—')}</dd></div>`).join('');
  const noteRows=annotations.length ? annotations.map(note=>`<article><p>${esc(note.body)}</p><small>${profileDate(note.createdAt)}</small></article>`).join('') : '<p class="muted">Sin anotaciones registradas.</p>';
  const historyRows=club.history.slice(0,8).map(row=>`<tr><td>${profileDate(row.date)}</td><td><span class="state ${profileAttendanceState(row)}">${{present:'Está',absent:'No está',bench:'No jugó',pending:'Sin marcar'}[profileAttendanceState(row)]}</span></td><td>${row.called?'Titular':'—'}</td><td>${esc(row.note||'—')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Todavía no hay registros de asistencia.</td></tr>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ficha KORU · ${esc(player.name)}</title><style>
    @page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;background:#e9edf1;color:#15202b;font:13px/1.42 Arial,sans-serif}.controls{max-width:190mm;margin:14px auto 10px;display:flex;gap:8px;justify-content:flex-end}.controls button{border:0;border-radius:8px;background:#f36b21;color:#fff;font-weight:700;padding:10px 14px;cursor:pointer}.controls .close{background:#263542}.sheet{width:190mm;min-height:277mm;margin:0 auto 14px;background:#fff;padding:10mm;box-shadow:0 4px 20px #15202b25}.hero{position:relative;overflow:hidden;display:flex;justify-content:space-between;align-items:center;min-height:42mm;padding:8mm;border-radius:13px;background:linear-gradient(125deg,#111b24,#273948);color:#fff}.hero:after{content:'';position:absolute;width:75mm;height:75mm;right:-25mm;top:-43mm;border:13mm solid #f36b21;border-radius:50%;opacity:.9}.brand{height:15mm;max-width:42mm;object-fit:contain;object-position:left center;filter:brightness(0) invert(1)}.eyebrow{margin:5mm 0 1mm;color:#f7934e;font-size:9px;font-weight:700;letter-spacing:1.2px}.hero h1{font-size:25px;line-height:1.08;margin:0}.hero p{margin:2mm 0 0;color:#d6e0e7}.photo{position:relative;z-index:1;width:29mm;height:29mm;border-radius:50%;border:2px solid #f7934e;background:#f36b21;display:grid;place-items:center;color:#fff;font-size:20px;font-weight:800;overflow:hidden}.photo img{width:100%;height:100%;object-fit:cover}.section{margin-top:7mm}.section-head{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid #dbe2e7;padding-bottom:2mm;margin-bottom:3mm}.section h2{margin:0;color:#1c2d3a;font-size:14px}.section small{color:#6e7c85}.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:2mm}.stat{min-height:19mm;padding:3mm;border-radius:7px;background:#f2f5f6;text-align:center}.stat strong{display:block;color:#e95f16;font-size:18px}.stat span{display:block;color:#57656e;font-size:9px}.league{background:#fff7f1;border:1px solid #f8d4be;border-radius:9px;padding:4mm}.league .section-head{border:0;margin:0 0 2mm}.details{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm 5mm;margin:0}.details div{border-bottom:1px solid #edf0f2;padding-bottom:2mm}.details dt{font-size:9px;color:#78858d;text-transform:uppercase;letter-spacing:.4px}.details dd{margin:1mm 0 0;font-weight:700;word-break:break-word}.captain{margin:4mm 0 0;padding:3mm 4mm;border-left:3px solid #f36b21;background:#fff8f4}.captain strong{display:block;margin-bottom:1mm}.notes{display:grid;grid-template-columns:1fr 1fr;gap:3mm}.notes article{padding:3mm 4mm;border-radius:7px;background:#f4f6f7}.notes p{margin:0 0 2mm;white-space:pre-wrap}.notes small,.muted{color:#6d7c85}table{width:100%;border-collapse:collapse;font-size:11px}th{text-align:left;color:#65737c;font-size:9px;text-transform:uppercase;letter-spacing:.4px}th,td{padding:2.2mm;border-bottom:1px solid #e6ebee;vertical-align:top}.state{font-weight:700}.state.present{color:#188553}.state.absent{color:#c13b3b}.state.bench{color:#a86b00}.state.pending{color:#69757c}.footer{margin-top:7mm;padding-top:3mm;border-top:1px solid #dbe2e7;color:#77858d;font-size:9px;display:flex;justify-content:space-between}@media print{body{background:#fff}.controls{display:none}.sheet{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}}
  </style></head><body><div class="controls"><button onclick="window.print()">Guardar como PDF</button><button class="close" onclick="window.close()">Cerrar</button></div><main class="sheet"><header class="hero"><div>${logo?`<img class="brand" src="${esc(logo)}" alt="KORU eCLUB">`:'<strong>KORU eCLUB</strong>'}<p class="eyebrow">FICHA OFICIAL DEL JUGADOR</p><h1>${esc(player.name)}</h1><p>${esc(player.alias||player.position||'Jugador')} · Dorsal #${esc(player.number||'—')} · ${esc(statuses[player.status]||player.status)}</p></div><div class="photo">${photo?`<img src="${esc(photo)}" alt="">`:initial}</div></header><section class="section"><div class="section-head"><h2>Historial en el club</h2><small>Asistencia y participación</small></div><div class="stats">${statCards(clubStats)}</div></section>${league?`<section class="section league"><div class="section-head"><h2>Estadísticas ${esc(league.source)}</h2><small>Actualizado ${profileDate(league.updatedAt)}${league.stale?' · última actualización disponible':''}</small></div><div class="stats">${statCards(leagueStats)}</div></section>`:''}<section class="section"><div class="section-head"><h2>Datos del jugador</h2><small>Ficha de plantilla</small></div><dl class="details">${detailRows}</dl>${player.notes?`<aside class="captain"><strong>Nota del capitán</strong>${esc(player.notes)}</aside>`:''}</section><section class="section"><div class="section-head"><h2>Anotaciones</h2><small>${annotations.length} registradas</small></div><div class="notes">${noteRows}</div></section><section class="section"><div class="section-head"><h2>Últimos registros</h2><small>Máximo 8 jornadas</small></div><table><thead><tr><th>Fecha</th><th>Asistencia</th><th>Rol</th><th>Observación</th></tr></thead><tbody>${historyRows}</tbody></table></section><footer class="footer"><span>KORU eCLUB · Gestión de plantilla</span><span>Generada el ${profileDate(new Date().toISOString())}</span></footer></main></body></html>`;
}
function openPlayerPdf() {
  if(!profile) return;
  const preview=window.open('','_blank');
  if(!preview){notify('El navegador ha bloqueado la vista previa del PDF. Permite las ventanas emergentes para KORU.');return;}
  preview.opener=null;
  preview.document.open();
  preview.document.write(playerPdfHtml());
  preview.document.close();
}
function renderPlayerProfile() {
  const dialog=$('#player-profile');
  const content=$('#player-profile-content');
  const {player,attendance: club,annotations,league}=profile;
  const summary=club.summary;
  const leaguePanel=league ? `<section class="profile-section league-panel"><div class="profile-section-heading"><div><small>DATOS DE LIGAS</small><h3>Estadísticas ${esc(league.source)}</h3></div>${league.sourceUrl?`<a href="${esc(league.sourceUrl)}" target="_blank" rel="noopener noreferrer">Ver fuente</a>`:''}</div><div class="profile-stats">${profileStat('Partidos',league.matchesPlayed)}${profileStat('Goles',league.goals)}${profileStat('Asistencias',league.assists)}${profileStat('Rating',league.rating||'—')}${profileStat('ELO',league.elo)}</div><p class="profile-source">Actualizado ${profileDate(league.updatedAt)}${league.stale?' · se muestra la última actualización disponible':''}.</p></section>` : `<section class="profile-section empty-profile"><h3>Estadísticas de ligas</h3><p>Aún no hay estadísticas públicas para este jugador en las ligas conectadas. Si fue importado desde el dashboard, se enlazará al aparecer en VPG.</p></section>`;
  const rows=club.history.map(row=>`<li><span class="history-state ${profileAttendanceState(row)}">${{present:'Está',absent:'No está',bench:'No jugó',pending:'Sin marcar'}[profileAttendanceState(row)]}</span><div><strong>${profileDate(row.date)}</strong><small>${row.called?'Titular · ':''}${row.note?esc(row.note):'Sin observación'}</small></div></li>`).join('') || '<li class="empty">Todavía no hay días registrados para este jugador.</li>';
  content.innerHTML=`<header class="profile-header"><div class="profile-person">${avatar(player)}<div><small>FICHA DEL JUGADOR</small><h2>${esc(player.name)}</h2><p>${esc(player.alias||player.position)} · #${player.number||'—'} <span class="badge ${player.status}">${statuses[player.status]}</span></p></div></div><button type="button" class="icon" data-close aria-label="Cerrar ficha"><i data-lucide="x"></i></button></header><div class="profile-actions"><button class="primary" data-action="edit-player" data-id="${player.id}">Editar datos</button><button data-action="create-player-pdf">Crear PDF</button><button data-action="focus-annotation">Añadir anotación</button></div><section class="profile-section"><div class="profile-section-heading"><div><small>EN EL CLUB</small><h3>Historial individual</h3></div></div><div class="profile-stats">${profileStat('Días marcados',summary.markedDays)}${profileStat('Está',summary.present)}${profileStat('No está',summary.absent)}${profileStat('No jugó',summary.bench)}${profileStat('Jugó',summary.played)}${profileStat('Titular',summary.called)}</div></section>${leaguePanel}<section class="profile-section"><div class="profile-section-heading"><div><small>INFORMACIÓN</small><h3>Datos personales</h3></div></div><dl class="profile-data"><div><dt>Posición</dt><dd>${esc(player.position||'—')}</dd></div><div><dt>Otras posiciones</dt><dd>${esc(player.secondary||'—')}</dd></div><div><dt>Comunidad</dt><dd>${esc(player.region||'—')}</dd></div><div><dt>Cumpleaños</dt><dd>${esc(player.birthday||'—')}</dd></div><div><dt>X / Twitter</dt><dd>${esc(player.twitter||'—')}</dd></div><div><dt>Contacto</dt><dd>${esc(player.contact||'—')}</dd></div></dl>${player.notes?`<p class="profile-captain-note"><strong>Nota del capitán</strong>${esc(player.notes)}</p>`:''}</section><section class="profile-section"><div class="profile-section-heading"><div><small>SEGUIMIENTO</small><h3>Anotaciones</h3></div></div><form class="profile-note-form" id="profile-note-form"><textarea id="profile-note" maxlength="1200" rows="3" placeholder="Ej.: mejora en la salida de balón, disponibilidad, objetivo de la semana..."></textarea><button class="primary" type="submit">Guardar anotación</button></form><div class="profile-annotations">${annotations.length?annotations.map(note=>`<article><p>${esc(note.body)}</p><footer><small>${profileDate(note.createdAt)}</small><button data-action="delete-annotation" data-id="${note.id}" aria-label="Borrar anotación">Eliminar</button></footer></article>`).join(''):'<p class="empty">Todavía no hay anotaciones para este jugador.</p>'}</div></section><section class="profile-section"><div class="profile-section-heading"><div><small>ÚLTIMOS REGISTROS</small><h3>Asistencia y participación</h3></div></div><ul class="profile-history">${rows}</ul></section>`;
  $('#profile-note-form').onsubmit=event=>{event.preventDefault();run(()=>savePlayerAnnotation(player.id));};
  if(!dialog.open) dialog.showModal();
  icons();
}
async function openPlayerProfile(id) {
  profile=await api('/api/squad/players/'+encodeURIComponent(id)+'/profile');
  location.hash='jugador='+encodeURIComponent(id);
  renderPlayerProfile();
}
async function savePlayerAnnotation(playerId) {
  const body=$('#profile-note').value.trim();
  if(!body) return;
  await api('/api/squad/players/'+encodeURIComponent(playerId)+'/annotations','POST',{playerId,body});
  await openPlayerProfile(playerId);
  notify('Anotación guardada');
}
async function deletePlayerAnnotation(annotationId) {
  const playerId=profile.player.id;
  await api('/api/squad/players/'+encodeURIComponent(playerId)+'/annotations/'+encodeURIComponent(annotationId),'DELETE');
  await openPlayerProfile(playerId);
  notify('Anotación eliminada');
}
function renderCandidates() {
  $('#workspace').innerHTML=`<div class="bar"><h2>Seguimiento de pruebas</h2><button class="primary" data-action="add-candidate"><i data-lucide="user-plus"></i>Nuevo candidato</button></div><div class="table-wrap"><table><thead><tr><th>Jugador</th><th>Posicion</th><th>Estado</th><th>Prueba</th><th>Valoracion</th><th>Acciones</th></tr></thead><tbody>${candidates.map(c=>`<tr><td><strong>${esc(c.name)}</strong><small>${esc(c.team)} · ${esc(c.twitter)}</small></td><td>${esc(c.position)}</td><td><span class="badge ${c.status}">${trialStatuses[c.status]}</span></td><td>${esc(c.trialDate)||'Sin fecha'}</td><td>${c.rating?c.rating+' / 5':'Sin valorar'}</td><td><div class="actions">${iconButton('edit-candidate','pencil','Editar candidato',c.id)}${!players.some(p=>p.sourceKey==='candidate:'+c.id)?iconButton('sign-candidate','user-check','Incorporar a plantilla',c.id):'<span class="badge available">En plantilla</span>'}</div></td></tr>`).join('')}</tbody></table>${!candidates.length?'<p class="empty">Sin candidatos registrados.</p>':''}</div>`;
}
function field(name,label,value='',type='text',options=null) {
  return `<label class="${type==='textarea'?'wide':''}">${esc(label)}${options?`<select name="${name}" aria-label="${esc(label)}">${opt(options,value)}</select>`:type==='textarea'?`<textarea name="${name}" maxlength="3000">${esc(value)}</textarea>`:`<input name="${name}" type="${type}" value="${esc(value)}" ${name==='name'||name==='opponent'?'required maxlength="80"':''} ${type==='number'?'min="0" max="99"':''} ${type==='text'?'maxlength="160"':''}>`}</label>`;
}
function openEditor(title,html,submit) {
  $('#edit-form button[type=submit]').hidden=false;
  $('#editor-title').textContent=title;$('#fields').innerHTML=html;$('#form-error').textContent='';
  $('#edit-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await submit(Object.fromEntries(new FormData(e.target)));$('#editor').close();render();}catch(err){$('#form-error').textContent=err.message;}finally{b.disabled=false;}};
  $('#editor').showModal();icons();
}
function editPlayer(p={}) {
  openEditor(p.id?'Ficha de '+p.name:'Nuevo jugador',field('name','ID / nombre en el juego',p.name)+field('alias','Nombre habitual',p.alias)+field('number','Dorsal',p.number??0,'number')+field('position','Posicion principal',p.position||'LIBRE','text',Object.fromEntries(positions.map(p=>[p,p])))+field('secondary','Otras posiciones',p.secondary)+field('status','Estado',p.status||'active','text',statuses)+field('birthday','Fecha de nacimiento',p.birthday,'date')+field('region','Comunidad',p.region)+field('twitter','X / Twitter',p.twitter)+field('contact','Contacto',p.contact)+field('avatarUrl','URL de la foto',p.avatarUrl)+field('notes','Notas del capitan',p.notes,'textarea'),async data=>{
    const saved=await api('/api/squad/players'+(p.id?'/'+p.id:''),p.id?'PUT':'POST',{...data,number:Number(data.number),sourceKey:p.sourceKey||'',version:p.version||0});
    players=[...players.filter(x=>x.id!==saved.id),saved];
    notify(!p.id ? 'Jugador añadido. Su ficha individual ya está creada.' : 'Ficha guardada');
  });
  $('#fields').insertAdjacentHTML('beforeend','<label class="wide">Subir foto<input id="photo-upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>');
  $('#photo-upload').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    if(file.size>8*1024*1024){$('#form-error').textContent='La foto debe ocupar menos de 8 MB';return;}
    const button=$('#edit-form button[type=submit]');button.disabled=true;
    try {
      const form=new FormData();form.append('file',file);
      const res=await fetch('/api/files',{method:'POST',body:form});const result=await res.json();
      if(!res.ok)throw new Error(result.detail||'No se pudo subir la foto');
      $('#fields [name=avatarUrl]').value=result.url;$('#form-error').textContent='';notify('Foto subida');
    }catch(err){$('#form-error').textContent=err.message;}finally{button.disabled=false;}
  };
}
function editCandidate(c={}) {
  openEditor(c.id?'Ficha de candidato':'Nuevo candidato',field('name','Nombre',c.name)+field('twitter','X / Twitter',c.twitter)+field('position','Posicion',c.position)+field('team','Equipo actual',c.team)+field('archetype','Arquetipo',c.archetype)+field('status','Estado',c.status||'pending','text',trialStatuses)+field('trialDate','Fecha de prueba',c.trialDate,'date')+field('rating','Valoracion',c.rating||'','text',{'':'Sin valorar',1:'1 / 5',2:'2 / 5',3:'3 / 5',4:'4 / 5',5:'5 / 5'})+field('notes','Notas y decisiones',c.notes,'textarea'),async data=>{
    const saved=await api('/api/squad/candidates'+(c.id?'/'+c.id:''),c.id?'PUT':'POST',{...data,rating:data.rating?Number(data.rating):null,trialDate:data.trialDate||null,version:c.version||0});candidates=[...candidates.filter(x=>x.id!==saved.id),saved];notify('Candidato guardado');
  });
}
function editFixture(index) {
  const f=day.fixtures[index]||{};
  openEditor('Partido de la jornada',field('time','Hora (Madrid)',f.time||'22:00','time')+field('opponent','Rival',f.opponent)+field('competition','Competicion',f.competition,'text',{'':'Amistoso','VPG':'VPG','VPG Zero':'VPG Zero','PLG':'PLG'})+field('owner','Responsable',f.owner),async data=>{const value={...data,done:f.done||false};if(index===undefined)day.fixtures.push(value);else day.fixtures[index]=value;markDirty();});
}
function showPicker(index) {slot=Number(index);$('#pick-search').value='';renderPicker();$('#picker').showModal();}
function renderPicker() {
  const term=$('#pick-search').value.toLowerCase();
  $('#pick-list').innerHTML=`<button data-action="clear-slot">Dejar puesto vacio</button>`+active().filter(p=>p.name.toLowerCase().includes(term)).map(p=>{const a=day.responses[p.id]?.availability||'pending';const placed=day.lineup.includes(p.id);return `<button data-action="pick" data-id="${p.id}" ${a==='unavailable'?'disabled':''}>${person(p)}<span class="badge ${a}">${placed?'Ya titular':availability[a]}</span></button>`;}).join('');
}
async function saveDay() {day=await api('/api/squad/days/'+selectedDate,'PUT',payload(day));dirty=false;render();notify('Dia guardado');}
async function importPlayers() {
  const result=await Promise.allSettled([api('/api/tactical-players?team=home'),api('/api/dashboard')]);
  const custom=result[0].status==='fulfilled'?result[0].value:[];
  const dash=result[1].status==='fulfilled'?result[1].value:{};
  const remote=dash.analytics?.playerElo||dash.leaderboards?.scorers||[];
  const options=[...custom.map(p=>({...p,sourceKey:'custom:'+p.id})),...remote.map(p=>({...p,name:p.username||p.name,sourceKey:'dashboard:'+(p.username||p.name)}))].filter(p=>p.name);
  if(!options.length)throw new Error('No se pudo obtener la plantilla. Puedes crear las fichas manualmente.');
  let added=0;
  for(const p of options) {
    if(players.some(x=>x.sourceKey===p.sourceKey||x.name.toLowerCase()===p.name.toLowerCase()))continue;
    const saved=await api('/api/squad/players','POST',{name:p.name,number:Math.min(99,Math.max(0,Number(p.number)||0)),position:p.position||'LIBRE',avatarUrl:p.avatarUrl||'',sourceKey:p.sourceKey});players.push(saved);added++;
  }
  render();notify(`${added} jugadores incorporados${result.some(r=>r.status==='rejected')?' · Una fuente no estaba disponible':''}`);
}
async function exportLineup() {
  if(dirty)await saveDay();
  const pos=slots();
  await api('/api/tactical-lineup-templates','POST',{name:'KORU '+selectedDate,formation:day.formation,players:day.lineup.map((pid,i)=>{const p=players.find(p=>p.id===pid);return {rosterKey:p.sourceKey||'squad:'+p.id,name:p.name,number:p.number,avatarUrl:p.avatarUrl||null,positionLabel:pos[i].label,position:{x:(100-pos[i].y)*1.05,y:pos[i].x*.68,z:0}};})});
  notify('Once disponible en Pizarra > Alineaciones: KORU '+selectedDate);
}
function downloadCsv(rows,name) {
  const safe=v=>{let t=String(v??'');if(/^[=+@\-\t\r]/.test(t))t="'"+t;return '"'+t.replaceAll('"','""')+'"';};
  const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(safe).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function action(name,id) {
  if(name==='view-profile')await openPlayerProfile(id);
  if(name==='create-player-pdf'){openPlayerPdf();return;}
  if(name==='focus-annotation'){$('#profile-note')?.focus();return;}
  if(name==='delete-annotation')await deletePlayerAnnotation(id);
  if(name==='remove-player')await removePlayer(id);
  if(name==='attendance-record')await editAttendance(id,selectedDate);
  if(name==='add-player')editPlayer();
  if(name==='edit-player'){if($('#player-profile').open) $('#player-profile').close();editPlayer(players.find(p=>p.id===id));}
  if(name==='add-candidate')editCandidate();
  if(name==='edit-candidate')editCandidate(candidates.find(c=>c.id===id));
  if(name==='import')await importPlayers();
  if(name==='save-day')await saveDay();
  if(name==='slot')showPicker(id);
  if(name==='pick'||name==='clear-slot') {day.lineup=day.lineup.map(p=>p===id?null:p);day.lineup[slot]=name==='pick'?id:null;markDirty();$('#picker').close();render();}
  if(name==='export-lineup')await exportLineup();
  if(name==='open-day')await navigate('day',id);
  if(name==='mark-present'){for(const pid of day.lineup.filter(Boolean)){day.responses[pid]={availability:'pending',attendance:'pending',...day.responses[pid],attendance:'present'};}markDirty();render();}
  if(name==='add-fixture')editFixture();
  if(name==='edit-fixture')editFixture(Number(id));
  if(name==='remove-fixture'&&confirm('¿Quitar este partido de la agenda?')){day.fixtures.splice(Number(id),1);markDirty();render();}
  if(name==='copy-day')openEditor('Copiar once y agenda',field('date','Dia de origen','','date'),async data=>{if(!data.date||data.date===selectedDate)throw new Error('Elige otro dia');const source=await api('/api/squad/days/'+data.date);if(!source.version)throw new Error('Ese dia no tiene datos guardados');day.formation=source.formation;day.lineup=source.lineup.map(pid=>active().some(p=>p.id===pid)&&day.responses[pid]?.availability!=='unavailable'?pid:null);day.fixtures=source.fixtures.map(f=>({...f,done:false}));markDirty();});
  if(name==='sign-candidate') {const c=candidates.find(c=>c.id===id);editPlayer({name:c.name,position:c.position||'LIBRE',twitter:c.twitter,notes:c.notes,status:'trial',sourceKey:'candidate:'+c.id});}
  if(name==='csv')downloadCsv([['ID','Nombre','Dorsal','Posicion','Estado','Nacimiento','Comunidad','Twitter','Contacto','Notas'],...players.map(p=>[p.name,p.alias,p.number,p.position,statuses[p.status],p.birthday,p.region,p.twitter,p.contact,p.notes])],'koru-plantilla.csv');
  if(name==='csv-month')downloadCsv([['Fecha','Jugador','Disponibilidad','Asistencia','Titular'],...days.flatMap(d=>players.filter(p=>d.responses[p.id]||d.lineup.includes(p.id)).map(p=>[d.id,p.name,availability[d.responses[p.id]?.availability||'pending'],attendance[d.responses[p.id]?.attendance||'pending'],d.lineup.includes(p.id)?'Si':'No']))],'koru-asistencia-'+month+'.csv');
}
async function run(fn) {if(busy)return;busy=true;try{await fn();}catch(err){$('#notice').textContent=err.message;$('#notice').hidden=false;}finally{busy=false;}}
document.addEventListener('click',e=>{
  const close=e.target.closest('[data-close]');if(close){const dialog=close.closest('dialog');dialog.close();if(dialog.id==='player-profile')history.replaceState(null,'',location.pathname);return;}
  const t=e.target.closest('[data-tab]');if(t){run(()=>navigate(t.dataset.tab));return;}
  const b=e.target.closest('[data-action]');if(b&&!b.disabled)run(()=>action(b.dataset.action,b.dataset.id));
});
$('#player-profile').addEventListener('close',()=>{if(location.hash.startsWith('#jugador=')) history.replaceState(null,'',location.pathname);});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.dataset.response){const pid=el.dataset.id;const r={availability:'pending',attendance:'pending',participation:'pending',...day.responses[pid]};r[el.dataset.response]=el.value;
    if(el.dataset.response==='participation'&&r.participation==='played'&&r.attendance==='pending')r.attendance='present';
    if(el.dataset.response==='attendance'&&r.attendance==='pending'&&r.participation==='played')r.participation='pending';
    if(['absent','excused'].includes(r.attendance))r.participation='not_played';
    day.responses[pid]=r;if(r.availability==='unavailable')day.lineup=day.lineup.map(p=>p===pid?null:p);markDirty();render();}
  if(el.dataset.done!==undefined){day.fixtures[Number(el.dataset.done)].done=el.checked;markDirty();}
});
$('#pick-search').oninput=renderPicker;
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
run(load);
