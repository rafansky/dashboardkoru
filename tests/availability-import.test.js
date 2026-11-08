import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseConfirmations,confirmationUpdates,applyConfirmations} from '../static/availability-import.js';
const players=[{id:'r',name:'RAFANSKY'},{id:'f',name:'FRANSARDI'},{id:'b',name:'BOXEADOR'},{id:'z',name:'Zam0r4'},{id:'a',name:'Andyelmessy'},{id:'u',name:'Urbina'},{id:'s',name:'Sergio'},{id:'j',name:'Joselito'}];
test('WhatsApp headers, roles, nicknames, timing and unmarked players',()=>{
 const parsed=parseConfirmations('🌀*MIÉRCOLES | PLG • VPG*\nGK - Fran✅\nDFC - Boxe✅(22:15/20)\nCAR - Rafa❌\nMCD - Zamora✅\n🅰️MV/DC - Andy✅\nDC - Joselito\n🐮*Backups*\nUtillero - Sergio\n----\nDC/CAR Urbina ✅',players);
 assert.equal(parsed.weekday,3);assert.equal(parsed.rows.length,8);
 assert.deepEqual(confirmationUpdates(parsed.rows).map(r=>r.id),['f','b','r','z','a','u']);
 assert.equal(parsed.rows[1].note,'(22:15/20)');
});
test('preserves attendance, lineup, unmarked records and existing notes',()=>{
 const day={id:'2026-11-04',version:4,lineup:Array(11).fill(null),responses:{r:{attendance:'present',participation:'played',availability:'maybe',note:'Anterior'},j:{availability:'available'}},notes:'Sesión'};
 const next=applyConfirmations(day,parseConfirmations('CAR - Rafa❌(tarde)\nDC - Joselito',players).rows);
 assert.deepEqual(next.responses.r,{attendance:'present',participation:'played',availability:'unavailable',note:'Anterior · (tarde)'});
 assert.deepEqual(next.responses.j,day.responses.j);assert.equal(day.responses.r.availability,'maybe');assert.equal(next.version,4);
 day.lineup[0]='r';assert.throws(()=>applyConfirmations(day,[{id:'r',name:'Rafa',status:'unavailable'}]),/once/);
});
test('unknown or ambiguous names are skipped; conflicting marks rejected',()=>{
 assert.equal(parseConfirmations('GK - Fran✅',[...players,{id:'other',name:'Fran'}]).rows[0].id,'');
 assert.equal(confirmationUpdates(parseConfirmations('DC - Desconocido✅',players).rows).length,0);
 assert.throws(()=>confirmationUpdates(parseConfirmations('CAR - Rafa✅\nCAR - Rafa❌',players).rows),/contradictorias/);
 assert.throws(()=>confirmationUpdates(parseConfirmations('CAR - Rafa✅❌',players).rows),/marca/);
});
