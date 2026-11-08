// Display order only: position labels and saved lineups are kept unchanged.
const groups = [
 ['POR','PO','GK','PORTERO','GOALKEEPER'],
 ['DFC','CB','LCB','RCB','DEFENSA CENTRAL'],
 ['LI','LD','LB','RB','LATERAL IZQUIERDO','LATERAL DERECHO'],
 ['CAI','CAD','CAR','LWB','RWB'],
 ['MCD','CDM','LDM','RDM'],
 ['MC','CM','LCM','RCM','MV'],
 ['MI','MD','LM','RM'],
 ['MCO','CAM','LAM','RAM'],
 ['EI','ED','LW','RW'],
 ['SD','CF','LF','RF'],
 ['DC','ST','LS','RS','DI','DD','DELANTERO'],
];
const ranks = new Map(groups.flatMap((codes,index)=>codes.map(code=>[code,index])));
const collator = new Intl.Collator('es',{sensitivity:'base',numeric:true});
export function positionRank(position) {
 const code=String(position??'').trim().toUpperCase().split(/[\/,;|]/)[0].trim();
 return ranks.get(code)??groups.length;
}
export function sortPlayersByPosition(players) {
 return [...players].sort((a,b)=>positionRank(a.position)-positionRank(b.position)||collator.compare(a.name??'',b.name??''));
}
