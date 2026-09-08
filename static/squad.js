const $ = (s) => document.querySelector(s);
const esc = (v = '') => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = () => window.lucide?.createIcons();
const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let players = [], candidates = [], days = [], day = null, tab = 'players', selectedDate = today, month = today.slice(0,7), dirty = false, busy = false, search = '', filter = 'active', slot = 0;
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
  render();
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
  document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-current',b.dataset.tab===tab?'page':'false'));
  if(tab==='players')renderPlayers();
  if(tab==='day')renderDay();
  if(tab==='month')renderMonth();
  if(tab==='candidates')renderCandidates();
  icons();
}
function renderPlayers() {
  $('#workspace').innerHTML=`<div class="bar"><h2>Plantilla del club</h2><input id="search" type="search" placeholder="Buscar jugador" aria-label="Buscar jugador" value="${esc(search)}"><select id="status-filter" aria-label="Estado">${opt({'':'Todos',...statuses},filter)}</select><button data-action="import"><i data-lucide="users-round"></i>Importar de pizarra</button><button class="primary" data-action="add-player"><i data-lucide="user-plus"></i>Nuevo jugador</button>${iconButton('csv','download','Exportar plantilla CSV')}</div><div class="summary"><span><strong>${players.filter(p=>p.status==='active').length}</strong>activos</span><span><strong>${players.filter(p=>p.status==='trial').length}</strong>en pruebas</span><span><strong>${players.filter(p=>p.status==='inactive').length}</strong>inactivos</span></div><div id="player-table"></div>`;
  renderPlayerTable();
  $('#search').oninput=e=>{search=e.target.value;renderPlayerTable();};
  $('#status-filter').onchange=e=>{filter=e.target.value;renderPlayerTable();};
}
function renderPlayerTable() {
  const list=players.filter(p=>(!filter||p.status===filter)&&`${p.name} ${p.alias} ${p.position}`.toLowerCase().includes(search.toLowerCase()));
  $('#player-table').innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th>Jugador</th><th>Dorsal</th><th>Estado</th><th>Cumple</th><th>Comunidad</th><th>X / Twitter</th><th>Ficha</th></tr></thead><tbody>${list.map(p=>`<tr><td>${person(p)}</td><td>${p.number}</td><td><span class="badge ${p.status}">${statuses[p.status]}</span></td><td>${p.birthday?esc(p.birthday.slice(5).split('-').reverse().join('/')):'—'}</td><td>${esc(p.region)||'—'}</td><td>${esc(p.twitter)||'—'}</td><td>${iconButton('edit-player','pencil','Editar '+p.name,p.id)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No hay jugadores con estos filtros.</div>';
  icons();
}
function renderDay() {
  const count=day.lineup.filter(Boolean).length;
  $('#workspace').innerHTML=`<div class="bar"><h2>Dia de partido</h2><input id="day-date" type="date" aria-label="Fecha del dia" value="${selectedDate}"><select id="formation" aria-label="Formacion">${opt(Object.fromEntries(Object.keys(formations).map(f=>[f,f])),day.formation)}</select><span id="save-state" class="unsaved">${dirty?'Cambios sin guardar':day.version?'Guardado':'Sin actividad guardada'}</span><button data-action="copy-day"><i data-lucide="copy"></i>Copiar otro dia</button><button class="primary" data-action="save-day"><i data-lucide="save"></i>Guardar dia</button></div><div class="day-grid"><section><div class="section-title"><strong>Once inicial · ${count}/11</strong><button data-action="export-lineup" ${count!==11?'disabled':''}><i data-lucide="clipboard-pen-line"></i>A pizarra</button></div><div class="pitch" aria-label="Once inicial"><div class="area top-area"></div><div class="area bottom-area"></div>${slots().map((s,i)=>{const p=players.find(p=>p.id===day.lineup[i]);return `<button class="slot" style="left:${s.x}%;top:${s.y}%" data-action="slot" data-id="${i}" aria-label="${s.label}: ${esc(p?.name||'Elegir jugador')}">${p?avatar(p):'<span class="avatar vacant">+</span>'}<small>${esc(p?.name||s.label)}</small></button>`;}).join('')}</div><label>Notas de la sesion<textarea id="day-notes" maxlength="3000">${esc(day.notes)}</textarea></label><h3 class="section-title">Agenda de partidos<button data-action="add-fixture" class="icon" aria-label="Anadir partido"><i data-lucide="plus"></i></button></h3>${day.fixtures.length?day.fixtures.map((f,i)=>`<div class="fixture ${f.done?'done':''}"><input type="checkbox" data-done="${i}" ${f.done?'checked':''} aria-label="Completado: ${esc(f.opponent)}"><div><strong>${f.time} · ${esc(f.opponent)}</strong><small>${esc(f.competition)} · ${esc(f.owner||'Sin responsable')}</small></div>${iconButton('edit-fixture','pencil','Editar partido',i)}${iconButton('remove-fixture','trash-2','Eliminar partido',i)}</div>`).join(''):'<p class="empty">Sin partidos programados.</p>'}</section><section><h3 class="section-title">Disponibilidad y pase de lista</h3><div class="summary"><span><strong>${Object.values(day.responses).filter(r=>r.availability==='available').length}</strong>disponibles</span><span><strong>${Object.values(day.responses).filter(r=>['present','late'].includes(r.attendance)).length}</strong>asistieron</span></div><div class="response-row response-head"><span>Jugador</span><span>Disponibilidad</span><span>Asistencia real</span></div>${active().map(p=>{const r=day.responses[p.id]||{};return `<div class="response-row">${person(p)}<select data-response="availability" data-id="${p.id}" aria-label="Disponibilidad de ${esc(p.name)}">${opt(availability,r.availability||'pending')}</select><select data-response="attendance" data-id="${p.id}" aria-label="Asistencia de ${esc(p.name)}">${opt(attendance,r.attendance||'pending')}</select></div>`;}).join('')||'<p class="empty">Crea o importa jugadores en Plantilla.</p>'}<div class="bar" style="margin-top:14px"><button data-action="mark-present"><i data-lucide="list-checks"></i>Marcar titulares presentes</button></div></section></div>`;
  $('#day-date').onchange=e=>run(()=>navigate('day',e.target.value||selectedDate));
  $('#formation').onchange=e=>{day.formation=e.target.value;markDirty();render();};
  $('#day-notes').oninput=e=>{day.notes=e.target.value;markDirty();};
}
function renderMonth() {
  const n=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();
  const dates=Array.from({length:n},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);
  const byDate=Object.fromEntries(days.map(d=>[d.id,d]));
  const list=players.filter(p=>p.status!=='inactive'||days.some(d=>d.responses[p.id]||d.lineup.includes(p.id)));
  const abbr={pending:'·',available:'D',maybe:'?',unavailable:'No'};
  $('#workspace').innerHTML=`<div class="bar"><h2>Asistencia mensual</h2><input id="month" type="month" value="${month}" aria-label="Mes"><button data-action="csv-month"><i data-lucide="download"></i>Exportar CSV</button></div><div class="legend"><span>D: disponible</span><span>No: no disponible</span><span>?: duda</span><span>11: titular</span><span>P: presente</span><span>T: tarde</span><span>J: justificado</span><span>A: ausente</span></div><div class="table-wrap"><table class="month-table"><thead><tr><th>Jugador</th>${dates.map((d,i)=>`<th><button data-action="open-day" data-id="${d}" class="month-cell">${i+1}</button></th>`).join('')}<th>Disp.</th><th>Titular</th><th>Asist.</th></tr></thead><tbody>${list.map(p=>`<tr><td>${esc(p.name)}</td>${dates.map(d=>{const item=byDate[d],r=item?.responses[p.id],a=r?.availability||'pending',called=item?.lineup.includes(p.id),real={present:'P',late:'T',excused:'J',absent:'A'}[r?.attendance];return `<td><button class="month-cell ${a} ${called?'called':''}" data-action="open-day" data-id="${d}" title="${esc(p.name)} · ${d} · ${availability[a]} · ${attendance[r?.attendance||'pending']}">${abbr[a]}${called?' / 11':''}${real?' / '+real:''}</button></td>`;}).join('')}<td class="totals">${days.filter(d=>d.responses[p.id]?.availability==='available').length}</td><td>${days.filter(d=>d.lineup.includes(p.id)).length}</td><td class="totals">${days.filter(d=>['present','late'].includes(d.responses[p.id]?.attendance)).length}</td></tr>`).join('')}</tbody><tfoot><tr><th>Disponibles / titulares</th>${dates.map(d=>`<td>${Object.values(byDate[d]?.responses||{}).filter(r=>r.availability==='available').length} / ${byDate[d]?.lineup.filter(Boolean).length||0}</td>`).join('')}<td colspan="3"></td></tr></tfoot></table></div>`;
  $('#month').onchange=e=>{if(e.target.value){month=e.target.value;run(()=>navigate('month'));}};
}
function renderCandidates() {
  $('#workspace').innerHTML=`<div class="bar"><h2>Seguimiento de pruebas</h2><button class="primary" data-action="add-candidate"><i data-lucide="user-plus"></i>Nuevo candidato</button></div><div class="table-wrap"><table><thead><tr><th>Jugador</th><th>Posicion</th><th>Estado</th><th>Prueba</th><th>Valoracion</th><th>Acciones</th></tr></thead><tbody>${candidates.map(c=>`<tr><td><strong>${esc(c.name)}</strong><small>${esc(c.team)} · ${esc(c.twitter)}</small></td><td>${esc(c.position)}</td><td><span class="badge ${c.status}">${trialStatuses[c.status]}</span></td><td>${esc(c.trialDate)||'Sin fecha'}</td><td>${c.rating?c.rating+' / 5':'Sin valorar'}</td><td><div class="actions">${iconButton('edit-candidate','pencil','Editar candidato',c.id)}${!players.some(p=>p.sourceKey==='candidate:'+c.id)?iconButton('sign-candidate','user-check','Incorporar a plantilla',c.id):'<span class="badge available">En plantilla</span>'}</div></td></tr>`).join('')}</tbody></table>${!candidates.length?'<p class="empty">Sin candidatos registrados.</p>':''}</div>`;
}
function field(name,label,value='',type='text',options=null) {
  return `<label class="${type==='textarea'?'wide':''}">${esc(label)}${options?`<select name="${name}" aria-label="${esc(label)}">${opt(options,value)}</select>`:type==='textarea'?`<textarea name="${name}" maxlength="3000">${esc(value)}</textarea>`:`<input name="${name}" type="${type}" value="${esc(value)}" ${name==='name'||name==='opponent'?'required maxlength="80"':''} ${type==='number'?'min="0" max="99"':''} ${type==='text'?'maxlength="160"':''}>`}</label>`;
}
function openEditor(title,html,submit) {
  $('#editor-title').textContent=title;$('#fields').innerHTML=html;$('#form-error').textContent='';
  $('#edit-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await submit(Object.fromEntries(new FormData(e.target)));$('#editor').close();render();}catch(err){$('#form-error').textContent=err.message;}finally{b.disabled=false;}};
  $('#editor').showModal();icons();
}
function editPlayer(p={}) {
  openEditor(p.id?'Ficha de '+p.name:'Nuevo jugador',field('name','ID / nombre en el juego',p.name)+field('alias','Nombre habitual',p.alias)+field('number','Dorsal',p.number??0,'number')+field('position','Posicion principal',p.position||'LIBRE','text',Object.fromEntries(positions.map(p=>[p,p])))+field('secondary','Otras posiciones',p.secondary)+field('status','Estado',p.status||'active','text',statuses)+field('birthday','Fecha de nacimiento',p.birthday,'date')+field('region','Comunidad',p.region)+field('twitter','X / Twitter',p.twitter)+field('contact','Contacto',p.contact)+field('avatarUrl','URL de la foto',p.avatarUrl)+field('notes','Notas del capitan',p.notes,'textarea'),async data=>{
    const saved=await api('/api/squad/players'+(p.id?'/'+p.id:''),p.id?'PUT':'POST',{...data,number:Number(data.number),sourceKey:p.sourceKey||'',version:p.version||0});
    players=[...players.filter(x=>x.id!==saved.id),saved];notify('Ficha guardada');
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
  if(name==='add-player')editPlayer();
  if(name==='edit-player')editPlayer(players.find(p=>p.id===id));
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
  const close=e.target.closest('[data-close]');if(close){close.closest('dialog').close();return;}
  const t=e.target.closest('[data-tab]');if(t){run(()=>navigate(t.dataset.tab));return;}
  const b=e.target.closest('[data-action]');if(b&&!b.disabled)run(()=>action(b.dataset.action,b.dataset.id));
});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.dataset.response){const pid=el.dataset.id;const r={availability:'pending',attendance:'pending',...day.responses[pid]};r[el.dataset.response]=el.value;day.responses[pid]=r;if(r.availability==='unavailable')day.lineup=day.lineup.map(p=>p===pid?null:p);markDirty();render();}
  if(el.dataset.done!==undefined){day.fixtures[Number(el.dataset.done)].done=el.checked;markDirty();}
});
$('#pick-search').oninput=renderPicker;
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
run(load);
