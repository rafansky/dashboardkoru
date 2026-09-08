import { test, expect } from '@playwright/test';

test('captain creates a squad, saves a full lineup, reviews attendance and exports to tactics', async ({page}) => {
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  await page.request.post('/api/login',{form:{password:'test-password'}});
  const unique=Date.now();
  const members=[];
  for(let i=0;i<10;i++) {
    const r=await page.request.post('/api/squad/players',{data:{name:`Test ${unique} ${i}`,number:i+1,position:i===0?'POR':'MC'}});
    expect(r.ok()).toBeTruthy();members.push(await r.json());
  }
  await page.goto('/gestion-plantilla');
  await page.getByRole('button',{name:'Nuevo jugador',exact:true}).click();
  await page.getByLabel('ID / nombre en el juego').fill(`Captain ${unique}`);
  await page.getByLabel('Dorsal',{exact:true}).fill('11');
  await page.locator('#photo-upload').setInputFiles('static/assets/tactical-ball.png');
  await expect(page.locator('[name=avatarUrl]')).not.toHaveValue('');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await expect(page.locator('#player-table')).toContainText(`Captain ${unique}`);
  members.push((await (await page.request.get('/api/squad/players')).json()).find(p=>p.name===`Captain ${unique}`));
  await page.getByRole('button',{name:'Dia de partido',exact:true}).click();
  await page.locator('#day-date').fill('2031-02-12');
  await page.locator('#day-date').dispatchEvent('change');
  await expect(page.locator('#day-date')).toHaveValue('2031-02-12');
  for(let i=0;i<11;i++){
    await page.locator(`.slot[data-id="${i}"]`).click();
    await page.locator(`#pick-list [data-id="${members[i].id}"]`).click();
  }
  await expect(page.locator('.section-title').first()).toContainText('11/11');
  await page.getByRole('button',{name:'Marcar titulares presentes'}).click();
  await page.getByRole('button',{name:'Anadir partido',exact:true}).click();
  await page.getByLabel('Rival',{exact:true}).fill('Rival de prueba');
  await page.getByLabel('Competicion',{exact:true}).selectOption('PLG');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(page.locator('.fixture').first()).toContainText('Rival de prueba');
  await page.getByRole('button',{name:'Guardar dia',exact:true}).click();
  await expect(page.locator('#save-state')).toHaveText('Guardado');
  await page.getByRole('button',{name:'A pizarra',exact:true}).click();
  await expect(page.locator('#toast')).toContainText('Once disponible');
  const templates=await (await page.request.get('/api/tactical-lineup-templates')).json();
  expect(templates.find(t=>t.name==='KORU 2031-02-12').players).toHaveLength(11);
  await page.getByLabel(`Disponibilidad de ${members[0].name}`,{exact:true}).selectOption('unavailable');
  await expect(page.locator('.section-title').first()).toContainText('10/11');
  await page.getByRole('button',{name:'Guardar dia',exact:true}).click();
  await expect(page.locator('#save-state')).toHaveText('Guardado');
  const saved=await (await page.request.get('/api/squad/days/2031-02-12')).json();
  expect(saved.responses[members[0].id].attendance).toBe('present');
  expect(saved.lineup[0]).toBeNull();
  await page.getByRole('button',{name:'Asistencia mensual',exact:true}).click();
  await page.locator('#month').fill('2031-02');
  await page.locator('#month').dispatchEvent('change');
  await page.getByRole('button',{name:'Mes completo',exact:true}).click();
  await expect(page.locator('.attendance-calendar')).toContainText('Lunes');
  await expect(page.locator('#player-history')).toBeVisible();
  await page.getByRole('button',{name:'Pruebas',exact:true}).click();
  await page.getByRole('button',{name:'Nuevo candidato'}).click();
  await page.getByLabel('Nombre',{exact:true}).fill('Candidato e2e');
  await page.getByLabel('Estado',{exact:true}).selectOption('scheduled');
  await page.getByLabel('Fecha de prueba').fill('2031-02-15');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(page.locator('#workspace')).toContainText('Candidato e2e');
  await page.getByRole('button',{name:'Dia de partido',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'artifacts/squad-desktop.png',fullPage:true});
  await page.setViewportSize({width:375,height:812});
  await page.screenshot({path:'artifacts/squad-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(await page.locator('.response-row .person').evaluateAll(items=>items.every(el=>el.scrollWidth<=el.clientWidth+1))).toBeTruthy();
  expect(errors).toEqual([]);
});

test('calendar distinguishes actual participation and opens exact player dates',async({page})=>{
  await page.request.post('/api/login',{form:{password:'test-password'}});
  const p=await (await page.request.post('/api/squad/players',{data:{name:'Capitan calendario',number:8,position:'MC'}})).json();
  const states=[
    {availability:'available',attendance:'present',participation:'played'},
    {availability:'available',attendance:'present',participation:'not_played',note:'Rotacion: estaba disponible'},
    {availability:'available',attendance:'absent',participation:'not_played'},
    {availability:'unavailable',attendance:'excused',participation:'not_played'},
    {availability:'available',attendance:'present'},
  ];
  for(let i=0;i<states.length;i++){
    const date='2026-06-0'+(i+1);
    const old=await (await page.request.get('/api/squad/days/'+date)).json();
    const {id,updatedAt,...data}=old;
    data.responses[p.id]=states[i];
    expect((await page.request.put('/api/squad/days/'+date,{data})).ok()).toBeTruthy();
  }
  await page.goto('/gestion-plantilla');
  await page.getByRole('button',{name:'Asistencia mensual',exact:true}).click();
  await page.locator('#month').fill('2026-06');
  await page.locator('#month').dispatchEvent('change');
  await page.getByRole('button',{name:'Semana',exact:true}).click();
  await expect(page.locator('.week-group')).toContainText('1 al 7');
  await expect(page.locator('.attendance-calendar thead')).toContainText('Lunes');
  await expect(page.locator('.attendance-calendar thead')).toContainText('Domingo');
  await page.locator('#history-player').selectOption(p.id);
  await expect(page.locator('[data-filter=confirmedNoPlay] strong')).toHaveText('2');
  await expect(page.locator('[data-filter=played] strong')).toHaveText('1');
  await page.locator('[data-filter=confirmedNoPlay]').click();
  await expect(page.locator('.history-record')).toHaveCount(2);
  await expect(page.locator('.history-records')).toContainText('martes, 2 de junio');
  await page.locator('[data-filter=absent]').click();
  await expect(page.locator('.history-record')).toHaveCount(2);
  await page.locator('[data-cal=record][data-date="2026-06-05"][data-id="'+p.id+'"]').click();
  await page.getByLabel('Participación real',{exact:true}).selectOption('played');
  await page.getByLabel('Observación / motivo').fill('Jugo en la segunda parte');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await expect(page.locator('[data-filter=played] strong')).toHaveText('2');
  const saved=await (await page.request.get('/api/squad/days/2026-06-05')).json();
  expect(saved.responses[p.id].participation).toBe('played');
  await page.locator('#history-filter').selectOption('all');
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'artifacts/calendar-desktop.png',fullPage:true});
  await page.setViewportSize({width:375,height:812});
  await page.screenshot({path:'artifacts/calendar-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
