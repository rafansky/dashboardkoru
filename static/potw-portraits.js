// Original club artwork, cropped at display time to preserve every face exactly.
export const roster = [{"key": "muro", "name": "MURO", "aliases": ["MUROlokillo"], "crop": [345, 150, 189, 216]}, {"key": "fransardi", "name": "FRANSARDI", "aliases": [], "crop": [550, 150, 189, 216]}, {"key": "farenn", "name": "FARENN", "aliases": ["FarennTM"], "crop": [754, 150, 189, 216]}, {"key": "pulpi", "name": "PULPI", "aliases": [], "crop": [958, 150, 189, 216]}, {"key": "boxeador", "name": "BOXEADOR", "aliases": [], "crop": [345, 412, 189, 199]}, {"key": "maku", "name": "MAKU", "aliases": ["Makuryno"], "crop": [550, 412, 189, 199]}, {"key": "sergio3", "name": "SERGIO³", "aliases": [], "crop": [754, 412, 189, 199]}, {"key": "helwex", "name": "HELWEX", "aliases": ["Helwex"], "crop": [958, 412, 189, 199]}, {"key": "javi", "name": "JAVI", "aliases": ["Javi-NB94"], "crop": [345, 658, 189, 199]}, {"key": "zamora", "name": "ZAMORA", "aliases": ["Zam0r4"], "crop": [550, 658, 189, 199]}, {"key": "rufino", "name": "RUFINO", "aliases": ["rufino_22_"], "crop": [754, 658, 189, 199]}, {"key": "busi", "name": "BUSI", "aliases": ["M-Buskets"], "crop": [958, 658, 189, 199]}, {"key": "andy", "name": "ANDY", "aliases": ["Andyelmessy"], "crop": [345, 903, 189, 199]}, {"key": "moragues", "name": "MORAGUES", "aliases": [], "crop": [550, 903, 189, 199]}, {"key": "maroto", "name": "MAROTO", "aliases": ["MrMaroto91"], "crop": [754, 903, 189, 199]}, {"key": "penpig", "name": "PENPIG", "aliases": ["Penpig33"], "crop": [958, 903, 189, 199]}, {"key": "rafansky", "name": "RAFANSKY", "aliases": ["Rafansky84YT"], "crop": [345, 1148, 189, 199]}, {"key": "joselito", "name": "JOSELITO", "aliases": ["JoselitoMerino9"], "crop": [550, 1148, 189, 199]}, {"key": "edgar", "name": "EDGAR", "aliases": ["EdgarFdezz9"], "crop": [754, 1148, 189, 199]}, {"key": "guaire", "name": "GUAIRE", "aliases": ["Guaire-_Jg"], "crop": [958, 1148, 189, 199]}];
const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function portraitFor(player) {
  return roster.find(p => [p.name, p.key, ...p.aliases].some(n => normalize(n) === normalize(player.name)));
}
export function portraitMarkup(player, escape) {
  const p = portraitFor(player);
  if (!p) return `<span class="portrait portrait-missing" role="img" aria-label="Retrato no disponible">K</span>`;
  return `<svg class="portrait" viewBox="${p.crop.join(' ')}" role="img" aria-label="${escape(p.name)}" xmlns="http://www.w3.org/2000/svg"><image href="/assets/roster/koru-squad.jpeg" width="1200" height="1500"/></svg>`;
}

export function portraitUrlFor(player) {
  const portrait = portraitFor({name: player.name || player.username});
  return portrait ? `/assets/roster/${portrait.key}.svg` : null;
}

export function tacticalAvatarFor(player, team = player.teamId || 'home') {
  const existing = player.metadata?.avatarUrl || player.avatarUrl;
  const source = player.metadata?.source || player.source;
  if (team !== 'home' || (existing && (source === 'custom' || /^\/(uploads|imageneskoru)\//.test(existing)))) return existing || null;
  return portraitUrlFor(player) || existing || null;
}

const clubNumbers = {muro:29,fransardi:99,farenn:96,pulpi:89,boxeador:23,maku:3,sergio3:17,helwex:28,javi:6,zamora:4,rufino:22,busi:5,andy:40,moragues:20,maroto:91,penpig:33,rafansky:12,joselito:7,edgar:9,guaire:10};
export function clubNumberFor(player) {
  return clubNumbers[portraitFor({name:player.name || player.username})?.key] ?? null;
}
