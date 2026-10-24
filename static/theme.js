(() => {
  const key = 'koru-theme';
  let selected = 'light';
  try { selected = localStorage.getItem(key) === 'dark' ? 'dark' : 'light'; } catch {}
  const apply = theme => {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.textContent = theme === 'dark' ? '☀ Claro' : '☾ Oscuro';
      button.setAttribute('aria-label', theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro');
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    });
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101010' : '#f4f4f2');
  };
  apply(selected);
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'theme-toggle'; button.dataset.themeToggle = '';
    const host = document.querySelector('.hero-topbar') || document.querySelector('.topbar, .top, .history-header, .editor-header .header-actions, .viewer-header');
    if (host) host.append(button);
    else { button.classList.add('theme-toggle-floating'); document.body.append(button); }
    button.addEventListener('click', () => {
      const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, theme); } catch {}
      apply(theme);
    });
    apply(document.documentElement.dataset.theme);
  });
  window.addEventListener('storage', event => { if (event.key === key) apply(event.newValue === 'dark' ? 'dark' : 'light'); });
  // Shared navigation on private club pages; public spectators and login stay isolated.
  document.addEventListener('DOMContentLoaded', () => {
    if(location.pathname==='/login'||location.pathname.startsWith('/watch/')||location.pathname.startsWith('/potw/vote/'))return;
    document.body.classList.add('has-club-navigation');
    const icons={panel:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',once:'M3 3h18v18H3z M3 12h18 M12 3v18 M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',tactics:'M4 3h16v18H4z M4 12h16 M9 12h6 M9 7h6 M9 17h6',people:'M9 11a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M2 21v-2a7 7 0 0 1 14 0v2 M17 4a4 4 0 0 1 0 8 M18 15a5 5 0 0 1 4 5',more:'M5 12h.01 M12 12h.01 M19 12h.01'};
    const svg=key=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[key]}"></path></svg>`;
    const routes=[['/','Panel','panel'],['/lineup','Once inicial','once'],['/tactics','Pizarra','tactics'],['/gestion-plantilla','Plantilla','people']];
    const nav=document.createElement('nav');nav.className='club-mobile-nav';nav.setAttribute('aria-label','Secciones del club');
    nav.innerHTML=routes.map(([href,label,icon])=>`<a href="${href}" ${location.pathname===href?'aria-current="page"':''}>${svg(icon)}<span>${label}</span></a>`).join('')+`<button type="button" class="club-more" aria-label="Más secciones" aria-haspopup="dialog">${svg('more')}<span>Más</span></button>`;
    const menu=document.createElement('dialog');menu.className='club-mobile-menu';menu.setAttribute('aria-label','Todas las secciones');
    menu.innerHTML=`<header><div><small>KORU eCLUB</small><h2>Tu club, a mano.</h2></div><button type="button" aria-label="Cerrar menú">✕</button></header><div class="club-menu-links"><a href="/">Dashboard <span>Resumen del club →</span></a><a href="/#partidos">Calendario <span>Partidos y resultados →</span></a><a href="/lineup">Once inicial <span>Crear y descargar alineación →</span></a><a href="/tactics">Pizarra táctica <span>Preparar jugadas en 2D y 3D →</span></a><a href="/gestion-plantilla">Plantilla <span>Asistencia y jugadores →</span></a><a href="/players">Buscar jugador <span>Estadísticas y trayectoria por ID →</span></a><a href="/potw">Jugador de la semana <span>Rendimiento y premio →</span></a><a href="/match-history">Historial <span>Expedientes de partidos →</span></a><a href="/#archivo">Notas y archivos <span>Documentos del equipo →</span></a></div>`;
    document.body.append(nav,menu);
    nav.querySelector('button').onclick=()=>menu.showModal();menu.querySelector('button').onclick=()=>menu.close();
    menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',event=>{event.preventDefault();const href=a.href;menu.close();location.assign(href);}));
    nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',event=>{event.preventDefault();location.assign(a.href);}));
    menu.addEventListener('keydown',event=>event.stopPropagation());
    menu.addEventListener('click',event=>{if(event.target===menu)menu.close();});
    // Compact actions in the once builder, without hiding any controls.
    if(location.pathname==='/lineup'||location.pathname.endsWith('/lineup.html')){
      const poster=document.querySelector('.poster-panel');
      if(poster){const jump=document.createElement('button');jump.className='lineup-mobile-jump';jump.type='button';jump.textContent='Elegir formación y jugadores ↓';jump.onclick=()=>document.querySelector('.controls').scrollIntoView({behavior:'smooth',block:'start'});poster.after(jump);}
    }
  });

})();
