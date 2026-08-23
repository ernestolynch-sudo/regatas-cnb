/* Verificación del motor de puntajes — node js/scoring.test.js */
const S = require('./scoring.js');
let ok = 0, fail = 0;
function chk(nombre, real, esperado) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a === b) { ok++; console.log('  ✓ ' + nombre); }
  else { fail++; console.log('  ✗ ' + nombre + '\n      obtenido: ' + a + '\n      esperado: ' + b); }
}

console.log('\n1) Conversión de tiempos');
chk('14:32:10 → s', S.hmsASegundos('14:32:10'), 52330);
chk('navegado 13:00:00→14:35:20', S.tiempoNavegado('13:00:00', '14:35:20'), 5720);
chk('cruce de medianoche', S.tiempoNavegado('23:30:00', '00:15:00'), 2700);
chk('formato 5720 s', S.segundosAHms(5720), '1:35:20');

console.log('\n2) PHRF Tiempo sobre Tiempo — TCF = B/(A+R), A=550 B=650');
chk('R=100 → TCF 1.000', +S.tcfPhrf(100, 550, 650).toFixed(6), 1);
chk('R=0   → TCF 1.181818', +S.tcfPhrf(0, 550, 650).toFixed(6), 1.181818);
chk('R=200 → TCF 0.866667', +S.tcfPhrf(200, 550, 650).toFixed(6), 0.866667);
// Barco rápido (R=60) 2h00m vs barco lento (R=180) 2h15m
const cfg = { sistema: 'tot_phrf', phrf_a: 550, phrf_b: 650 };
const tcRapido = S.tiempoCorregido(7200, cfg, 60);   // 7200 × 650/610 = 7672.13
const tcLento  = S.tiempoCorregido(8100, cfg, 180);  // 8100 × 650/730 = 7212.33
chk('TC barco rápido R=60', +tcRapido.toFixed(2), 7672.13);
chk('TC barco lento  R=180', +tcLento.toFixed(2), 7212.33);
chk('gana el lento por corregido', tcLento < tcRapido, true);

console.log('\n3) Tiempo sobre Distancia — TC = TR − R×D');
chk('TR 7200 s, R=30 s/MN, D=12 MN', S.tiempoCorregido(7200, { sistema: 'tod' }, 30, 12), 6840);

console.log('\n4) Puntaje de una prueba (Apéndice A4/A5/A7)');
const nSerie = 8;
let pts = S.puntuarPrueba([
  { inscripcionId: 'a', codigo: 'OK',  tiempoCorregidoS: 1000 },
  { inscripcionId: 'b', codigo: 'OK',  tiempoCorregidoS: 1010 },
  { inscripcionId: 'c', codigo: 'OK',  tiempoCorregidoS: 1010 },  // empate A7
  { inscripcionId: 'd', codigo: 'OK',  tiempoCorregidoS: 1050 },
  { inscripcionId: 'e', codigo: 'DNF', tiempoCorregidoS: null },
  { inscripcionId: 'f', codigo: 'DSQ', tiempoCorregidoS: null },
  { inscripcionId: 'g', codigo: 'DNC', tiempoCorregidoS: null },
  { inscripcionId: 'h', codigo: 'ZFP', tiempoCorregidoS: 1005 }
], nSerie);
// Orden por TC: a(1000)=1º, h(1005)=2º, b(1010)=3º, c(1010)=3º, d(1050)=5º
chk('1º = 1 punto', pts.get('a').puntos, 1);
chk('empate b/c reparte 3º y 4º → 3.5', [pts.get('b').puntos, pts.get('c').puntos], [3.5, 3.5]);
chk('el que sigue al empate es 5º', pts.get('d').puntos, 5);
chk('DNF = inscriptos+1', pts.get('e').puntos, 9);
chk('DSQ = inscriptos+1', pts.get('f').puntos, 9);
chk('DNC = inscriptos+1', pts.get('g').puntos, 9);
// ZFP: llegaba 2º, penalización 20% de 8 = 1.6 → redondeo RRV = 2 lugares → 4 puntos
chk('ZFP 20 % (2º + 2 lugares)', pts.get('h').puntos, 4);

console.log('\n5) Descartes');
chk('3 pruebas, desde 4 → 0 descartes', S.cantidadDescartes(3, { descarte_desde: 4, descarte_cada: 4, descartes_max: 2 }), 0);
chk('4 pruebas → 1 descarte',          S.cantidadDescartes(4, { descarte_desde: 4, descarte_cada: 4, descartes_max: 2 }), 1);
chk('7 pruebas → 1 descarte',          S.cantidadDescartes(7, { descarte_desde: 4, descarte_cada: 4, descartes_max: 2 }), 1);
chk('8 pruebas → 2 descartes',         S.cantidadDescartes(8, { descarte_desde: 4, descarte_cada: 4, descartes_max: 2 }), 2);
chk('tope descartes_max',              S.cantidadDescartes(20, { descarte_desde: 4, descarte_cada: 4, descartes_max: 2 }), 2);

console.log('\n6) Serie completa monotipo con descarte y desempate A8.1');
// 4 barcos, 4 pruebas válidas, 1 descarte (desde 4)
const ins = [
  { id: '1', num_vela: 'ARG 1', nombre_barco: 'Uno',    timonel_nombre: 'A', club: 'CNB' },
  { id: '2', num_vela: 'ARG 2', nombre_barco: 'Dos',    timonel_nombre: 'B', club: 'CNB' },
  { id: '3', num_vela: 'ARG 3', nombre_barco: 'Tres',   timonel_nombre: 'C', club: 'CNB' },
  { id: '4', num_vela: 'ARG 4', nombre_barco: 'Cuatro', timonel_nombre: 'D', club: 'CNB' }
];
const pruebas = [1, 2, 3, 4].map(n => ({ id: 'p' + n, numero: n, estado: 'valida', distancia_mn: 6 }));
// Puestos (tiempo corregido = orden): P1 1-2-3-4 · P2 2-1-4-3 · P3 1-2-4-3 · P4 4-3-1-2
const puestos = {
  p1: { '1': 100, '2': 200, '3': 300, '4': 400 },
  p2: { '2': 100, '1': 200, '4': 300, '3': 400 },
  p3: { '1': 100, '2': 200, '4': 300, '3': 400 },
  p4: { '3': 100, '4': 200, '2': 300, '1': 400 }
};
const resultados = [];
Object.keys(puestos).forEach(pid => Object.keys(puestos[pid]).forEach(iid =>
  resultados.push({ prueba_id: pid, inscripcion_id: iid, codigo: 'OK', tiempo_corregido_s: puestos[pid][iid] })));

const serie = S.calcularSerie({
  inscripciones: ins, pruebas, resultados,
  config: { sistema: 'monotipo', descarte_desde: 4, descarte_cada: 4, descartes_max: 2 }
});
// Puntos brutos: 1 → 1+2+1+4=8 (descarta 4) = 4
//                2 → 2+1+2+3=8 (descarta 3) = 5
//                3 → 3+4+4+1=12 (descarta 4) = 8
//                4 → 4+3+3+2=12 (descarta 4) = 8
chk('descartes calculados', serie.descartes, 1);
chk('totales netos', serie.filas.map(f => [f.inscripcion.id, f.total]),
    [['1', 4], ['2', 5], ['3', 8], ['4', 8]]);
// Desempate 3 vs 4 por A8.1: computados 3 → [1,3,4]  ·  4 → [2,3,3]
// primer punto de diferencia: 1 < 2 → gana el barco 3
chk('desempate A8.1 favorece al 3', serie.filas[2].inscripcion.id, '3');
chk('posiciones 1..4', serie.filas.map(f => f.posicion), [1, 2, 3, 4]);

console.log('\n7) Serie PHRF ToT con DNF y tiempos reales');
const insC = [
  { id: 'c1', num_vela: 'A 10', nombre_barco: 'Sudestada', timonel_nombre: 'E', club: 'CNB', rating: 60 },
  { id: 'c2', num_vela: 'A 22', nombre_barco: 'Kayen',     timonel_nombre: 'F', club: 'CNB', rating: 180 },
  { id: 'c3', num_vela: 'A 31', nombre_barco: 'Vendaval',  timonel_nombre: 'G', club: 'CNB', rating: 120 }
];
const serieC = S.calcularSerie({
  inscripciones: insC,
  pruebas: [{ id: 'q1', numero: 1, estado: 'valida', distancia_mn: 10, hora_largada: '14:00:00' }],
  resultados: [
    { prueba_id: 'q1', inscripcion_id: 'c1', codigo: 'OK',  hora_largada: '14:00:00', hora_llegada: '16:00:00' },
    { prueba_id: 'q1', inscripcion_id: 'c2', codigo: 'OK',  hora_largada: '14:00:00', hora_llegada: '16:15:00' },
    { prueba_id: 'q1', inscripcion_id: 'c3', codigo: 'DNF' }
  ],
  config: { sistema: 'tot_phrf', phrf_a: 550, phrf_b: 650, descarte_desde: 0 }
});
chk('gana Kayen por corregido', serieC.filas[0].inscripcion.nombre_barco, 'Kayen');
chk('DNF puntúa inscriptos+1', serieC.filas[2].total, 4);
chk('sin descartes con 1 prueba', serieC.descartes, 0);

console.log('\n8) CSV');
const csv = S.serieACSV(serie, 'Campeonato de prueba');
chk('CSV tiene encabezado de posiciones', csv.split('\n')[3].startsWith('Pos;'), true);
chk('CSV marca el descarte con paréntesis', /\(\d+\)/.test(csv), true);

console.log('\n──────────────────────────────');
console.log(ok + ' OK · ' + fail + ' fallidas');
process.exit(fail ? 1 : 0);
