import {test} from 'node:test';
import assert from 'node:assert/strict';
import {positionRank,sortPlayersByPosition} from '../static/player-positions.js';
test('Spanish and English positions share a tactical order, including PLG forward codes',()=>{
 for(const [a,b] of [['PO','GK'],['POR','GK'],['DFC','CB'],['LI','LB'],['CAD','RWB'],['MCD','CDM'],['MC','CM'],['MI','LM'],['MCO','CAM'],['EI','LW'],['DC','ST'],['DI','ST'],['DD','ST']])assert.equal(positionRank(a),positionRank(b));
 const list=[{name:'Atacante',position:'ST'},{name:'Libre',position:'LIBRE'},{name:'Medio',position:' CM '},{name:'Portero',position:'GK'},{name:'Central',position:'CB / CDM'}];
 assert.deepEqual(sortPlayersByPosition(list).map(p=>p.name),['Portero','Central','Medio','Atacante','Libre']);
 assert.equal(list[0].name,'Atacante');
 assert.ok(positionRank('CDM')<positionRank('CM'));
 assert.ok(positionRank('CM')<positionRank('CAM'));
});
test('unknown and missing positions stay visible at the end with stable Spanish name ordering',()=>{
 assert.deepEqual(sortPlayersByPosition([{name:'Zeta',position:null},{name:'Álvaro',position:'XYZ'},{name:'A2',position:''},{name:'A10'}]).map(p=>p.name),['A2','A10','Álvaro','Zeta']);
});
