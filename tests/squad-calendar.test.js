import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gameWeeks,monthWeeks,playerRecords,recordFilters,dateLabel,simpleAttendance,simpleResponse} from '../static/squad-calendar.js';

test('simple attendance separates absences from present non-players without guessing from availability',()=>{
  assert.equal(simpleAttendance({availability:'unavailable'}),'pending');
  assert.equal(simpleAttendance({attendance:'excused',participation:'not_played'}),'absent');
  assert.equal(simpleAttendance({attendance:'late',participation:'not_played'}),'bench');
  assert.equal(simpleAttendance({attendance:'present',participation:'played'}),'present');
  for(const state of ['pending','present','absent','bench']) {
    const row=simpleResponse(state,{note:'Se conserva',availability:'maybe',participation:'played'});
    assert.equal(simpleAttendance(row),state);
    assert.equal(row.note,'Se conserva');
    assert.equal(row.availability,'maybe');
  }
});

test('weeks start on Monday and include every month date once, including leap day',()=>{
  const weeks=monthWeeks('2028-02');
  assert.equal(weeks.flat().length,29);
  assert.equal(weeks.flat().at(-1),'2028-02-29');
  for(const week of weeks.slice(1))assert.equal(new Date(week[0]+'T12:00Z').getUTCDay(),1);
  assert.equal(monthWeeks('2026-09')[0][0],'2026-09-01');
  assert.match(dateLabel('2026-09-08'),/martes/);
  assert.match(dateLabel('2026-10-25'),/domingo/);
});
test('unknown participation and starting selection never imply played or did not play',()=>{
  const records=playerRecords([
    {id:'2026-09-01',lineup:['a'],responses:{a:{availability:'available',attendance:'present'}}},
    {id:'2026-09-02',lineup:[],responses:{a:{availability:'available',attendance:'present',participation:'not_played'}}},
    {id:'2026-09-03',lineup:[],responses:{a:{availability:'available',attendance:'absent',participation:'not_played'}}},
    {id:'2026-09-04',lineup:['b'],responses:{}},
    {id:'2026-09-05',lineup:[],responses:{a:{availability:'available',attendance:'late',participation:'played'}}},
  ],'a');
  assert.equal(records.length,4);
  assert.equal(records.filter(recordFilters.confirmedNoPlay).length,2);
  assert.equal(records.filter(recordFilters.confirmedAbsent).length,1);
  assert.equal(records.filter(recordFilters.present).length,3);
  assert.equal(records.filter(recordFilters.played).length,1);
  assert.equal(records.filter(recordFilters.unknown).length,1);
});

test('playing calendar includes only Monday to Thursday and skips empty partial weeks',()=>{
 for(const month of ['2026-11','2027-01','2028-02']) {
  const weeks=gameWeeks(month);
  assert.ok(weeks.every(week=>week.length>0));
  assert.ok(weeks.flat().every(date=>{const day=new Date(date+'T12:00Z').getUTCDay();return day>=1&&day<=4;}));
  assert.equal(new Set(weeks.flat()).size,weeks.flat().length);
 }
 assert.deepEqual(gameWeeks('2026-11')[0],['2026-11-02','2026-11-03','2026-11-04','2026-11-05']);
 assert.equal(gameWeeks('2027-01')[0][0],'2027-01-04');
 const entries=playerRecords([{id:'2026-11-06',lineup:[],responses:{a:{attendance:'present'}}}],'a');
 assert.equal(entries.length,1,'Friday history is preserved');
});
