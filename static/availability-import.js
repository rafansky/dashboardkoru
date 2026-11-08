// WhatsApp confirmations are availability, never proof of attendance.
export const normalizeName = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const nicknames = [['rafa','rafansky','rafansky84yt'],['fran','fransardi'],['boxe','boxeador'],['busi','mbuskets'],['andy','andyelmessy'],['zamora','zam0r4'],['farenn','farenntm'],['javi','javinb94'],['maroto','mrmaroto91'],['joselito','joselitomerino9'],['edgar','edgarfdezz9'],['muro','murolokillo'],['rufino','rufino22'],['maku','makuryno']];
export function parseConfirmations(text, players) {
 const weekdays=['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
 const header=normalizeName(text.split('\n').find(line=>weekdays.some(day=>normalizeName(line).includes(day)))||'');
 const weekday=weekdays.findIndex(day=>header.includes(day));
 const names=p=>[p.name,p.alias,p.sourceKey].filter(Boolean).map(normalizeName);
 const result=[];
 for(const raw of text.split(/\r?\n/)) {
  let line=raw.replace(/[*_`]/g,'').trim();
  if(!line||/backups/i.test(line)||weekdays.some(day=>normalizeName(line).includes(day))||/^[-─]+$/.test(line))continue;
  const marks=[...line.matchAll(/[✅❌]/gu)];
  const before=(marks.length?line.slice(0,marks[0].index):line).replace(/^[^\p{L}\p{N}]+/u,'');
  const role=/^(?:GK|POR|PO|CB|DFC|LD|LI|CAD|CAI|CAR|MCD|CDM|MC|CM|MV|MCO|CAM|MD|MI|RM|LM|DC|ST|SD|ED|EI|UTILLERO)(?:\/(?:[A-Z]+))*\s*(?:[-–—]\s*|\s+)/i;
  const name=before.replace(role,'').trim();
  if(!name||(!marks.length&&!role.test(before)))continue;
  const key=normalizeName(name);
  const group=nicknames.find(list=>list.includes(key))||[key];
  const matches=players.filter(p=>p.status!=='inactive'&&names(p).some(n=>group.includes(n)||n===key));
  result.push({name,id:matches.length===1?matches[0].id:'',status:marks.length===1?(marks[0][0]==='✅'?'available':'unavailable'):'',note:marks.length===1?line.slice(marks[0].index+marks[0][0].length).trim():'',error:marks.length>1?'Más de una marca en la línea':''});
 }
 return {weekday,rows:result};
}
export function confirmationUpdates(rows) {
 const updates=new Map();
 for(const row of rows) {
  if(row.error)throw new Error(row.error+': '+row.name);
  if(!row.id||!row.status)continue;
  const previous=updates.get(row.id);
  if(previous&&previous.status!==row.status)throw new Error('Hay marcas contradictorias para '+row.name);
  updates.set(row.id,{...row,note:[...new Set([previous?.note,row.note].filter(Boolean))].join(' · ')});
 }
 return [...updates.values()];
}
export function applyConfirmations(record, rows) {
 const next=structuredClone(record);
 for(const row of confirmationUpdates(rows)) {
  if(row.status==='unavailable'&&next.lineup.includes(row.id))throw new Error(row.name+' está en el once. Retíralo del once antes de marcarlo como no disponible.');
  const previous=next.responses[row.id]||{};
  const note=[...new Set([...(previous.note||'').split(' · '),row.note].filter(Boolean))].join(' · ');
  if(note.length>500)throw new Error('La observación de '+row.name+' supera los 500 caracteres.');
  next.responses[row.id]={...previous,availability:row.status,note};
 }
 return next;
}
