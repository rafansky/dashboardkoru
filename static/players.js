const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = {goals:'Goles',assists:'Asistencias',motm:'MVP',clean_sheets:'Porterías a cero',clean_sheets_def:'Imbatibilidades (defensa)',yellow_cards:'Amarillas',red_cards:'Rojas',saves:'Paradas',rating:'Nota media'};
const fmt = value => value == null ? '—' : typeof value === 'number' ? value.toLocaleString('es-ES',{maximumFractionDigits:2}) : escape(value);
let activeIdentifier = '', loading = false;
function render(p) {
  const stat = (label,value) => `<div class="stat"><strong>${fmt(value)}</strong><span>${escape(label)}</span></div>`;
  const eventKeys = [...new Set(p.history.flatMap(r => Object.keys(r.events)))];
  const totalPages = Math.max(1, Math.ceil(p.historyTotal / p.historyPageSize));
  $('result').innerHTML = `<div class="profile-head"><div><p class="eyebrow">FICHA DEL JUGADOR · VPN #${escape(p.id)}</p><h2>${escape(p.name)}</h2><p class="muted">${[p.position,p.country,...Object.values(p.platformIds)].filter(Boolean).map(escape).join(' · ')}</p><p>${p.currentTeams.length ? p.currentTeams.map(t=>escape(t.name)).join(' · ') : 'Sin equipo actual publicado'}</p></div><a class="source" href="${escape(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">Ver perfil en VPN ↗</a></div>
  <p class="hint">Estadísticas de carrera publicadas en VPN para EAFC Pro Clubs.</p><div class="stats">${stat('Partidos',p.matches)}${stat('Títulos',p.titles)}${p.stats.map(s=>stat(labels[s.key] || s.key,s.value)).join('')}</div>
  <h3>Equipos y temporadas</h3><p class="hint">Cada fila corresponde a un equipo y una competición. Un mismo equipo puede aparecer en varias temporadas.</p>
  ${p.history.length ? `<div class="table-wrap"><table><thead><tr><th>Equipo</th><th>Competición</th><th>Temporada</th><th>PJ</th>${eventKeys.map(k=>`<th>${escape(labels[k] || k)}</th>`).join('')}<th>Título</th></tr></thead><tbody>${p.history.map(r=>`<tr><td>${escape(r.team)}</td><td>${escape(r.competition)}</td><td>${fmt(r.season)}</td><td>${fmt(r.matches)}</td>${eventKeys.map(k=>`<td>${fmt(r.events[k] ?? 0)}</td>`).join('')}<td>${r.champion?'🏆':'—'}</td></tr>`).join('')}</tbody></table></div>` : `<p class="empty">${p.historyAvailable?'No hay temporadas en esta página.':'VPN no publica el historial de este jugador.'}</p>`}
  ${totalPages>1 ? `<div class="pager"><button id="previous" ${p.historyPage<=1?'disabled':''}>← Anterior</button><span>Página ${p.historyPage} de ${totalPages}</span><button id="next" ${p.historyPage>=totalPages?'disabled':''}>Siguiente →</button></div>` : ''}`;
  if ($('previous')) $('previous').onclick=()=>search(activeIdentifier,p.historyPage-1);
  if ($('next')) $('next').onclick=()=>search(activeIdentifier,p.historyPage+1);
  $('result').hidden=false;
}
async function search(identifier,page=1) {
  if(loading)return;
  loading=true; $('search-button').disabled=true;
  $('result').hidden=true; $('status').className=''; $('status').textContent='Consultando jugador en VPN…';
  try {
    const response=await fetch(`/api/players/lookup?${new URLSearchParams({identifier,page})}`);
    if(response.status===401){location.assign('/login');return;}
    const data=await response.json();
    if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'No se pudo consultar el jugador.');
    activeIdentifier=identifier; render(data);
    $('status').textContent='Ficha consultada. Los datos pueden tardar hasta 10 minutos en reflejar cambios de VPN.';
    history.replaceState(null,'',`/players?${new URLSearchParams({id:identifier,page})}`);
  } catch(error){$('status').className='error';$('status').textContent=error.message||'No se pudo conectar con VPN.';}
  finally {loading=false;$('search-button').disabled=false;}
}
$('search-form').onsubmit=event=>{event.preventDefault();search($('identifier').value.trim());};
const params=new URLSearchParams(location.search);
if(params.get('id')){$('identifier').value=params.get('id');search(params.get('id'),Math.max(1,Number(params.get('page'))||1));}
