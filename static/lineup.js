import {roster,portraitUrlFor} from './potw-portraits.js';
import {tacticsApi} from './tactics/api.js';
const $=id=>document.getElementById(id);
const habitual=['joselito','edgar','rafansky','busi','javi','andy','penpig','zamora','helwex','farenn','muro'];
const formations={
 '3-1-4-2':[['DC',37,10],['DC',63,10],['MI',20,31],['MC',35,38],['MCD',50,38],['MC',65,38],['MD',80,31],['DFC',50,64],['DFC',27,73],['DFC',73,73],['POR',50,94]],
 '4-2-3-1':[['DC',50,12],['MI',19,32],['MCO',50,32],['MD',81,32],['MCD',33,53],['MCD',67,53],['LI',14,75],['DFC',38,75],['DFC',62,75],['LD',86,75],['POR',50,94]],
 '4-3-3':[['EI',20,13],['DC',50,10],['ED',80,13],['MC',24,43],['MCD',50,53],['MC',76,43],['LI',14,75],['DFC',38,75],['DFC',62,75],['LD',86,75],['POR',50,94]],
 '4-4-2':[['DC',34,12],['DC',66,12],['MI',15,43],['MC',38,43],['MC',62,43],['MD',85,43],['LI',14,75],['DFC',38,75],['DFC',62,75],['LD',86,75],['POR',50,94]],
 '3-5-2':[['DC',34,12],['DC',66,12],['MCO',50,32],['MI',12,48],['MC',33,53],['MC',67,53],['MD',88,48],['DFC',23,75],['DFC',50,75],['DFC',77,75],['POR',50,94]],
 '5-2-1-2':[['DC',34,12],['DC',66,12],['MCO',50,33],['MC',33,53],['MC',67,53],['CAI',10,67],['DFC',30,77],['DFC',50,77],['DFC',70,77],['CAD',90,67],['POR',50,94]]
};
const numbers=[29,99,96,89,23,3,17,28,6,4,22,5,40,20,91,33,12,7,9,10];
let players=roster.map((p,i)=>({...p,number:numbers[i],avatarUrl:`/assets/roster/cutouts/${p.key}.png`}));
let chosen=Array(11).fill(null),formation='3-1-4-2',active=0,pendingPlayer=null,saved=[],source,logo;
const c=$('poster'),ctx=c.getContext('2d');
const escape=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
function image(url){return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url;});}
const positions=()=>formations[formation].map(([role,x,y])=>({role,x:90+x*9,y:330+y*8.3}));
function draw(){
 ctx.clearRect(0,0,1080,1350);ctx.fillStyle='#f4f4f1';ctx.fillRect(0,0,1080,1350);
 ctx.strokeStyle='#e5e5e0';ctx.lineWidth=38;for(let i=0;i<5;i++){ctx.beginPath();ctx.ellipse(105,200,500+i*190,430+i*180,-.25,0,Math.PI*2);ctx.stroke();}
 ctx.fillStyle='#ff5108';ctx.fillRect(0,0,18,1350);if(logo)ctx.drawImage(logo,82,45,95,95);
 ctx.fillStyle='#111';ctx.font='900 65px Arial';ctx.fillText('KORU',195,104);ctx.font='700 17px Arial';ctx.fillText('e C L U B',198,132);
 ctx.fillStyle='#ff5108';ctx.font='italic 900 74px Arial';ctx.fillText('ONCE INICIAL',80,236);
 ctx.fillStyle='#333';ctx.font='700 22px Arial';let title=$('title').value.trim()||'KORU · ONCE INICIAL';while(ctx.measureText(title).width>900&&title.length>1)title=title.slice(0,-2)+'…';ctx.fillText(title,85,276);
 const opponent=$('opponent').value.trim(),matchDate=$('match-date').value;
 const day=matchDate?new Date(`${matchDate}T12:00:00`).toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric'}):'';
 ctx.font='800 19px Arial';ctx.fillStyle='#c13b00';const info=[opponent?`VS ${opponent}`:'',day].filter(Boolean).join('  ·  ');ctx.fillText(info,85,308,910);
 ctx.strokeStyle='#c9c9c1';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(235,322);ctx.lineTo(845,322);ctx.lineTo(1030,1194);ctx.lineTo(50,1194);ctx.closePath();ctx.stroke();ctx.beginPath();ctx.moveTo(143,758);ctx.lineTo(937,758);ctx.stroke();ctx.beginPath();ctx.ellipse(540,758,126,65,0,0,Math.PI*2);ctx.stroke();ctx.strokeRect(340,322,400,117);ctx.strokeRect(260,1059,560,135);
 positions().forEach((pos,i)=>{const p=chosen[i],w=formation==='3-1-4-2'?132:144,h=formation==='3-1-4-2'?150:149,x=pos.x-w/2,y=pos.y-h/2;
 if(p){if(p.crop&&source){const [cx,cy,cw,ch]=p.cutoutCrop||p.crop;const ratio=Math.min(w/cw,(h-27)/ch);const dw=cw*ratio,dh=ch*ratio;ctx.drawImage(source,cx,cy,cw,ch,pos.x-dw/2,y+h-27-dh,dw,dh);}else if(p.image)ctx.drawImage(p.image,x,y,w,h-27);}else{ctx.fillStyle='#ffffffaa';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#ff51087a';ctx.lineWidth=2;ctx.setLineDash([7,5]);ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);ctx.fillStyle='#ff5108';ctx.font='700 50px Arial';ctx.textAlign='center';ctx.fillText('+',pos.x,pos.y+2);}
 const label=p?.name||pos.role;ctx.font='900 15px Arial';ctx.textAlign='left';if(p){ctx.fillStyle='#ff5108';ctx.fillRect(x,y+h-25,28,24);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(String(p.number),x+14,y+h-8);ctx.textAlign='left';ctx.fillStyle='#111';ctx.fillText(label,x+34,y+h-8,w-34);}else{ctx.fillStyle='#777';ctx.textAlign='center';ctx.fillText(label,pos.x,y+h-8);ctx.textAlign='left';}
 if(!p){ctx.fillStyle='#111';ctx.font='700 13px Arial';ctx.fillText(pos.role,x+4,y-5);}
 });
 ctx.fillStyle='#111';ctx.font='900 28px Arial';ctx.fillText(formation,85,1262);ctx.textAlign='right';ctx.font='italic 900 31px Arial';ctx.fillText('#BELIEVE',995,1262);ctx.textAlign='left';ctx.fillStyle='#ff5108';ctx.fillRect(80,1292,920,5);
 $('count').textContent=`${chosen.filter(Boolean).length}/11 jugadores colocados`;
}
function draft(){try{localStorage.setItem('koru-lineup-draft-v2',JSON.stringify({formation,chosen:chosen.map(p=>p?.key||null),title:$('title').value,opponent:$('opponent').value,matchDate:$('match-date').value}));}catch{}}
let pointerDrag=null,suppressClickUntil=0;
function bindPointerDrag(button,key){
 button.ondragstart=e=>e.preventDefault();
 button.onpointerdown=e=>{if(e.button!==0||e.pointerType==='touch')return;pointerDrag={key,x:e.clientX,y:e.clientY,moved:false};};
}
document.addEventListener('pointermove',e=>{
 if(!pointerDrag)return;
 if(!pointerDrag.moved&&Math.hypot(e.clientX-pointerDrag.x,e.clientY-pointerDrag.y)<6)return;
 pointerDrag.moved=true;e.preventDefault();document.body.classList.add('placing-player');
 let ghost=document.querySelector('.drag-ghost');if(!ghost){ghost=document.createElement('div');ghost.className='drag-ghost';const p=players.find(p=>p.key===pointerDrag.key);ghost.innerHTML=`<img src="${escape(p.avatarUrl)}" alt=""><strong>${escape(p.name)}</strong>`;document.body.append(ghost);}
 ghost.style.left=`${e.clientX+12}px`;ghost.style.top=`${e.clientY+12}px`;
 document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'));
 document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot]')?.classList.add('drop-target');
});
function finishDrag(e){if(!pointerDrag)return;const drag=pointerDrag;pointerDrag=null;document.querySelector('.drag-ghost')?.remove();document.body.classList.remove('placing-player');document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'));if(drag.moved){suppressClickUntil=performance.now()+400;const slot=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot]');if(slot)placePlayer(Number(slot.dataset.slot),drag.key);}}
document.addEventListener('pointerup',finishDrag);document.addEventListener('pointercancel',()=>{pointerDrag=null;document.querySelector('.drag-ghost')?.remove();document.body.classList.remove('placing-player');});
function placePlayer(index,key){
 const player=players.find(p=>p.key===key);if(!player)return;
 const previous=chosen[index],from=chosen.findIndex(p=>p?.key===key);
 if(from>=0&&from!==index)chosen[from]=previous||null;
 chosen[index]=player;pendingPlayer=null;render();
 $('status').textContent=`${player.name} colocado en ${positions()[index].role}.`;
}
function renderRoster(){
 const term=$('roster-filter').value.toLowerCase();
 $('roster-list').innerHTML=players.filter(p=>(p.name+' '+(p.aliases||[]).join(' ')).toLowerCase().includes(term)).map(p=>`<button type="button" draggable="true" class="roster-choice ${pendingPlayer===p.key?'picked':''}" data-roster-player="${escape(p.key)}" aria-pressed="${pendingPlayer===p.key}"><img draggable="false" src="${escape(p.avatarUrl)}" alt=""><span><strong>${escape(p.name)}</strong><small>#${p.number} · ${chosen.some(x=>x?.key===p.key)?'En el once':'Disponible'}</small></span><span aria-hidden="true">⠿</span></button>`).join('');
 document.querySelectorAll('[data-roster-player]').forEach(b=>{
  b.ondragstart=e=>{e.dataTransfer.setData('application/x-koru-player',b.dataset.rosterPlayer);e.dataTransfer.effectAllowed='move';document.body.classList.add('placing-player');};
  b.ondragend=()=>{document.body.classList.remove('placing-player');document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'));};
  bindPointerDrag(b,b.dataset.rosterPlayer);
  b.onclick=()=>{if(performance.now()<suppressClickUntil)return;pendingPlayer=pendingPlayer===b.dataset.rosterPlayer?null:b.dataset.rosterPlayer;renderRoster();$('status').textContent=pendingPlayer?'Pulsa el puesto donde quieres colocarlo.':'';if(pendingPlayer&&matchMedia('(max-width:800px)').matches)document.querySelector('.poster-panel').scrollIntoView({behavior:'smooth',block:'start'});};
 });
}
function render(){draw();$('slots').innerHTML=positions().map((p,i)=>`<button class="slot ${chosen[i]?'filled':'vacant'}" draggable="${!!chosen[i]}" style="left:${p.x/10.8}%;top:${p.y/13.5}%" data-slot="${i}" aria-label="${escape(p.role)}: ${escape(chosen[i]?.name||'Elegir jugador')}"><span>${escape(chosen[i]?.name||p.role)}</span></button>`).join('');
 document.querySelectorAll('[data-slot]').forEach(b=>{
  b.onclick=()=>{if(performance.now()<suppressClickUntil)return;active=Number(b.dataset.slot);if(pendingPlayer){placePlayer(active,pendingPlayer);return;}$('pick-title').textContent=`Elegir ${positions()[active].role}`;$('search').value='';renderPlayers();$('picker').showModal();$('search').focus();};
  b.ondragover=e=>{if([...e.dataTransfer.types].includes('application/x-koru-player')){e.preventDefault();e.dataTransfer.dropEffect='move';b.classList.add('drop-target');}};
  b.ondragleave=()=>b.classList.remove('drop-target');
  b.ondrop=e=>{e.preventDefault();document.body.classList.remove('placing-player');placePlayer(Number(b.dataset.slot),e.dataTransfer.getData('application/x-koru-player'));};
  b.ondragstart=e=>{const p=chosen[Number(b.dataset.slot)];if(!p){e.preventDefault();return;}e.dataTransfer.setData('application/x-koru-player',p.key);e.dataTransfer.effectAllowed='move';};
  if(chosen[Number(b.dataset.slot)])bindPointerDrag(b,chosen[Number(b.dataset.slot)].key);
 });renderRoster();draft();}

function renderPlayers(){const term=$('search').value.toLowerCase();$('players').innerHTML=players.filter(p=>(p.name+' '+p.aliases?.join(' ')).toLowerCase().includes(term)).map(p=>`<button class="player ${chosen[active]?.key===p.key?'selected':''}" data-player="${escape(p.key)}"><img src="${escape(p.avatarUrl)}" alt=""><strong>${escape(p.name)}</strong><small>${chosen.some(x=>x?.key===p.key)?'Ya colocado · mover aquí':'Seleccionar'}</small></button>`).join('');document.querySelectorAll('[data-player]').forEach(b=>b.onclick=()=>{$('picker').close();placePlayer(active,b.dataset.player);});}
async function refreshSaved(){saved=await tacticsApi.listLineupTemplates();$('saved').innerHTML='<option value="">Selecciona una alineación</option>'+saved.map(p=>`<option value="${escape(p.id)}">${escape(p.name)} · ${escape(p.formation)}</option>`).join('');}
async function task(button,fn){button.disabled=true;try{await fn();}catch(e){$('status').textContent=e.message||'No se pudo completar la acción';}finally{button.disabled=false;}}
$('roster-filter').oninput=renderRoster;
$('empty').onclick=()=>{formation='3-1-4-2';$('formation').value=formation;chosen=Array(11).fill(null);pendingPlayer=null;render();$('status').textContent='Once vacío preparado con vuestra 3-1-4-2.';};
$('habitual').onclick=()=>{formation='3-1-4-2';$('formation').value=formation;chosen=habitual.map(key=>players.find(p=>p.key===key));render();$('status').textContent='Once habitual cargado. Puedes cambiar cualquier jugador.';};
$('formation').innerHTML=Object.keys(formations).map(x=>`<option>${x}</option>`).join('');$('formation').onchange=()=>{formation=$('formation').value;render();};for(const id of ['title','opponent','match-date'])$(id).oninput=()=>{draw();draft();};$('close').onclick=()=>$('picker').close();$('search').oninput=renderPlayers;$('remove').onclick=()=>{chosen[active]=null;$('picker').close();render();};
$('save').onclick=e=>task(e.currentTarget,async()=>{if(chosen.some(p=>!p))throw Error('Completa los 11 puestos antes de guardar.');const result=await tacticsApi.createLineupTemplate({name:$('title').value.trim()||'Once KORU',formation,opponent:$('opponent').value.trim(),matchDate:$('match-date').value||null,players:chosen.map((p,i)=>({rosterKey:`club:${p.key}`,name:p.aliases?.[0]||p.name,number:p.number||0,positionLabel:positions()[i].role,avatarUrl:p.avatarUrl,position:{x:(positions()[i].y-322)/872*105,y:68-(positions()[i].x-75)/930*68}}))});await refreshSaved();$('saved').value=result.id;$('status').textContent='Once guardado en el club y disponible en la pizarra.';});
$('load').onclick=e=>task(e.currentTarget,async()=>{const s=saved.find(x=>x.id===$('saved').value);if(!s)throw Error('Selecciona una alineación guardada.');if(!formations[s.formation])throw Error('Esta formación de la pizarra no está disponible aquí.');formation=s.formation;$('formation').value=formation;$('title').value=s.name;$('opponent').value=s.opponent||'';$('match-date').value=s.matchDate||'';chosen=formations[formation].map((_,i)=>{const p=s.players[i];return p?players.find(x=>`club:${x.key}`===p.rosterKey||[x.name,...(x.aliases||[])].some(n=>n.toLowerCase()===p.name.toLowerCase()))||null:null;});render();$('status').textContent='Alineación cargada.';});
$('download').onclick=e=>task(e.currentTarget,async()=>{if(chosen.some(p=>!p))throw Error('Completa los 11 puestos antes de descargar.');draw();const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));if(!blob)throw Error('No se pudo generar la imagen.');const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=['KORU-once',$('opponent').value.trim().replace(/[^a-zA-Z0-9áéíóúñü -]/g,'').replace(/\s+/g,'-'),$('match-date').value].filter(Boolean).join('-')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);$('status').textContent='Cartel PNG descargado · 1080 × 1350.';});
async function init(){const crops=await fetch('/assets/roster/cutouts/crops.json').then(r=>{if(!r.ok)throw Error('No se pudieron cargar las siluetas');return r.json();});players=players.map(p=>({...p,cutoutCrop:crops[p.key]}));chosen=Array(11).fill(null);[source,logo]=await Promise.all([image('/assets/roster/koru-cutouts.png'),image('/assets/koru-logo.png')]);try{const d=JSON.parse(localStorage.getItem('koru-lineup-draft-v2'));if(d&&formations[d.formation]){formation=d.formation;$('formation').value=formation;$('title').value=d.title||'KORU · ONCE INICIAL';$('opponent').value=d.opponent||'';$('match-date').value=d.matchDate||'';chosen=Array.from({length:11},(_,i)=>players.find(p=>p.key===d.chosen?.[i])||null);}}catch{}render();await refreshSaved();}
init().catch(e=>{$('status').textContent='No se pudo cargar el creador: '+e.message;});
