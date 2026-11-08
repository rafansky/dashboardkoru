import {parseConfirmations,confirmationUpdates} from './availability-import.js?v=1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const draft={text:'',date:''};
export function mountConfirmationPanel(root,{players,save,updated}) {
 const panel=document.createElement('aside');panel.className='confirmation-panel';panel.setAttribute('aria-label','Importar confirmaciones');
 panel.innerHTML=`<h3>Pegar lista de WhatsApp</h3><p>✅ Disponible · ❌ No disponible.<br>No cambia la asistencia real ni las líneas sin marcar.</p><label>Fecha de la lista<input type="date" data-import="date" value="${esc(draft.date)}"></label><label>Lista de jugadores<textarea data-import="text" rows="12" placeholder="Pega aquí la lista completa">${esc(draft.text)}</textarea></label><button type="button" data-import="preview">Revisar lista</button><div data-import="review"></div><p role="status" data-import="message"></p>`;
 root.append(panel);
 const input=panel.querySelector('[data-import=text]'),date=panel.querySelector('[data-import=date]'),review=panel.querySelector('[data-import=review]'),message=panel.querySelector('[data-import=message]');
 let parsed=null;
 function invalidate(){draft.text=input.value;draft.date=date.value;parsed=null;review.replaceChildren();message.textContent='';}
 input.oninput=invalidate;date.oninput=invalidate;
 panel.querySelector('[data-import=preview]').onclick=()=>{
  invalidate();
  if(!date.value){message.textContent='Elige la fecha exacta de esta lista.';return;}
  const day=new Date(date.value+'T12:00:00Z').getUTCDay();
  if(day<1||day>4){message.textContent='Elige un día de juego, de lunes a jueves.';return;}
  parsed=parseConfirmations(input.value,players);
  if(parsed.weekday!==-1&&parsed.weekday!==day){message.textContent='El día del encabezado no coincide con la fecha elegida. Corrige la fecha o el encabezado.';parsed=null;return;}
  if(!parsed.rows.length){message.textContent='No se han encontrado jugadores en la lista.';return;}
  review.innerHTML='<h4>Revisa las coincidencias</h4><div class="confirmation-preview-rows">'+parsed.rows.map((r,i)=>`<div class="confirmation-row"><strong>${esc(r.name)}</strong><span>${esc(r.error||(r.status==='available'?'✓ Disponible':r.status==='unavailable'?'× No disponible':'Sin marca: se conserva'))}</span>${r.status?`<label>Jugador de la plantilla<select data-match="${i}"><option value="">Omitir / sin coincidencia</option>${players.filter(p=>p.status!=='inactive').map(p=>`<option value="${esc(p.id)}" ${r.id===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`:''}${r.note?`<small>${esc(r.note)}</small>`:''}</div>`).join('')+'</div><p>Solo se guardan las líneas con marca y jugador asignado. Si un no disponible está en el once, tendrás que retirarlo antes.</p><button type="button" class="primary" data-import="apply">Guardar confirmaciones</button>';
  message.textContent=parsed.rows.filter(r=>r.status&&r.id).length+' coincidencias · '+parsed.rows.filter(r=>r.status&&!r.id).length+' sin asignar · '+parsed.rows.filter(r=>!r.status).length+' sin marca.';
  review.querySelectorAll('[data-match]').forEach(el=>el.onchange=()=>{parsed.rows[Number(el.dataset.match)].id=el.value;message.textContent='';});
  review.querySelector('[data-import=apply]').onclick=async e=>{
   const button=e.currentTarget;
   try {
    const updates=confirmationUpdates(parsed.rows);
    if(!updates.length)throw new Error('No hay confirmaciones con jugador asignado para guardar.');
    panel.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);
    message.textContent='Guardando…';
    const saved=await save(date.value,updates);
    updated(saved);
    review.replaceChildren();parsed=null;
    message.textContent=updates.length+' confirmaciones guardadas para el '+date.value.split('-').reverse().join('/')+'. La asistencia real se conserva.';
   }catch(error){message.textContent=error.message||'No se pudo guardar.';}
   finally{panel.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);}
  };
 };
}
