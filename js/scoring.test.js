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

console.log('\n2) Fórmulas de la planilla PHRF del CNB — Tcf = (√rating + 2,6) / 10');
chk('rating 25 → Tcf 0,76', +S.tcfPhrf(25).toFixed(6), 0.76);
chk('rating 30,5 → Tcf 0,812268', +S.tcfPhrf(30.5).toFixed(6), 0.812268);
chk('rating 18,4 → Tcf 0,688952', +S.tcfPhrf(18.4).toFixed(6), 0.688952);
chk('s/m rating 25 = 5226 / 7,6', +S.segPorMilla(25).toFixed(6), 687.631579);
chk('rating vacío → sin Tcf', S.tcfPhrf(null), null);
chk('rating vacío "" → sin Tcf', S.tcfPhrf(''), null);
chk('rating negativo → sin Tcf', S.tcfPhrf(-4), null);
chk('rating 0 sigue siendo válido (Tcf 0,26)', S.tcfPhrf(0), 0.26);

// ---- Caso de referencia: se cargó en la planilla del Comité (hojas Config y Planilla)
// y la calculó un motor de hojas de cálculo. Largada 15:00:00, distancia 14 mn.
// Los números de abajo son los que devolvió la PLANILLA, no los de esta app.
const LARGADA = '15:00:00', DIST = 14;
const flota = [   // nombre, rating, llegada, [T en T, pos], [T en D, pos]
  ['Alfa',   25.0, '19:41:48', 16908, 12850, 4, 16289, 3],
  ['Bravo',  25.2, '19:35:10', 16510, 12581, 2, 15916, 2],
  ['Charly', 18.4, '20:10:05', 18605, 12818, 3, 16993, 5],
  ['Delta',  22.0, '19:59:59', 17999, 13122, 5, 16971, 4],
  ['Eco',    30.5, '18:50:00', 13800, 11209, 1, 13800, 1]
];
const scratch = S.ratingScratch(flota.map(f => f[1]));
chk('scratch = el de mayor rating', scratch, 30.5);
chk('s/m del scratch', +S.segPorMilla(scratch).toFixed(6), 643.383671);

console.log('\n3) Tiempo sobre Tiempo contra la planilla');
flota.forEach(([n, r, ll, real, tot]) => {
  chk(n + ': tiempo real ' + ll, S.tiempoNavegado(LARGADA, ll), real);
  chk(n + ': corregido T en T', S.tiempoCorregido(real, { sistema: 'tot_phrf' }, r), tot);
});

console.log('\n3 bis) Tiempo sobre Distancia contra la planilla');
const cfgTod = { sistema: 'tod', rating_scratch: scratch };
flota.forEach(([n, r, , real, , , tod]) => {
  chk(n + ': corregido T en D', S.tiempoCorregido(real, cfgTod, r, DIST), tod);
});
chk('el scratch no se compensa a sí mismo', S.tiempoCorregido(13800, cfgTod, 30.5, DIST), 13800);
chk('ToD sin distancia → null', S.tiempoCorregido(16908, cfgTod, 25, null), null);
chk('ToD sin scratch → null', S.tiempoCorregido(16908, { sistema: 'tod' }, 25, DIST), null);
chk('ToD sin rating → null', S.tiempoCorregido(16908, cfgTod, null, DIST), null);

console.log('\n3 ter) Scratch');
chk('scratch manual del Comité pisa al automático', S.ratingScratch([25, 30.5], 32), 32);
chk('manual vacío → automático', S.ratingScratch([25, 30.5], ''), 30.5);
chk('ignora barcos sin rating', S.ratingScratch([25, null, '', 22]), 25);
chk('flota sin ratings → sin scratch', S.ratingScratch([null, '']), null);

console.log('\n3 quater) Redondeo y sistemas');
// El producto da 676,4999999999999 en coma flotante pero la planilla (Excel/LibreOffice
// redondean sobre 15 dígitos) lo ve como 676,5 y sube. Math.round pelado daría 676.
// OJO: este caso NO lo confirmó el motor de la herramienta (redondea en binario puro):
// es el comportamiento documentado de Excel, a verificar en una planilla real.
chk('empate exacto en .5 sube, como el ROUND de Excel', S.tiempoCorregido(1025, { sistema: 'tot_phrf' }, 16), 677);
chk('el tiempo real también se redondea al segundo', S.tiempoCorregido(16908.4, { sistema: 'tot_phrf' }, 25), 12850);
chk('los sistemas son monotipo, tot_phrf y tod',
    Object.keys(S.SISTEMAS).join(','), 'monotipo,tot_phrf,tod');
chk('tot_factor ya no corrige', S.tiempoCorregido(7200, { sistema: 'tot_factor' }, 24.9), null);
chk('sistema desconocido no corrige', S.tiempoCorregido(7200, { sistema: 'xx' }, 100), null);
chk('monotipo devuelve el tiempo real', S.tiempoCorregido(7200, { sistema: 'monotipo' }, null), 7200);

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

console.log('\n7) Serie completa contra la planilla (T en T y T en D, con un DNF)');
const insC = flota.map(([n, r], i) => ({ id: 'c' + i, num_vela: String(101 + i), nombre_barco: n,
  timonel_nombre: 'T' + i, club: 'CNB', rating: r }));
insC.push({ id: 'cF', num_vela: '106', nombre_barco: 'Foxtrot', timonel_nombre: 'TF', club: 'CNB', rating: 20 });
const resC = flota.map(([, , ll], i) => ({ prueba_id: 'q1', inscripcion_id: 'c' + i, codigo: 'OK',
  hora_largada: LARGADA, hora_llegada: ll }));
resC.push({ prueba_id: 'q1', inscripcion_id: 'cF', codigo: 'DNF' });
const pruebaC = [{ id: 'q1', numero: 1, estado: 'valida', distancia_mn: DIST, hora_largada: LARGADA }];

const orden = sistema => S.calcularSerie({ inscripciones: insC, pruebas: pruebaC, resultados: resC,
  config: { sistema, descarte_desde: 0 } }).filas.map(f => f.inscripcion.nombre_barco);
chk('orden oficial en Tiempo sobre Tiempo (Eco, Bravo, Charly, Alfa, Delta, Foxtrot)',
    orden('tot_phrf'), ['Eco', 'Bravo', 'Charly', 'Alfa', 'Delta', 'Foxtrot']);
chk('orden oficial en Tiempo sobre Distancia (Eco, Bravo, Alfa, Delta, Charly, Foxtrot)',
    orden('tod'), ['Eco', 'Bravo', 'Alfa', 'Delta', 'Charly', 'Foxtrot']);

const serieC = S.calcularSerie({ inscripciones: insC, pruebas: pruebaC, resultados: resC,
  config: { sistema: 'tot_phrf', descarte_desde: 0 } });
chk('DNF puntúa inscriptos+1 (6 barcos → 7)', serieC.filas[5].total, 7);
chk('sin descartes con 1 prueba', serieC.descartes, 0);

// El corregido guardado en la base se calculó con el scratch de ese momento. Si después
// se confirma un barco más rápido, la serie tiene que reflejarlo igual: se recalcula.
const resViejos = resC.map(r => Object.assign({}, r, { tiempo_corregido_s: 1 }));   // valor guardado falso
chk('ignora el corregido guardado y recalcula', S.calcularSerie({ inscripciones: insC, pruebas: pruebaC,
  resultados: resViejos, config: { sistema: 'tot_phrf', descarte_desde: 0 } }).filas.map(f => f.inscripcion.nombre_barco),
  ['Eco', 'Bravo', 'Charly', 'Alfa', 'Delta', 'Foxtrot']);
const insNuevo = insC.concat([{ id: 'cZ', num_vela: '107', nombre_barco: 'Zeta', timonel_nombre: 'TZ', club: 'CNB', rating: 35 }]);
const conZeta = S.calcularSerie({ inscripciones: insNuevo, pruebas: pruebaC,
  resultados: resC.concat([{ prueba_id: 'q1', inscripcion_id: 'cZ', codigo: 'DNC' }]),
  config: { sistema: 'tod', descarte_desde: 0 } });
chk('un barco nuevo de mayor rating cambia el scratch y por lo tanto el ToD de todos',
    conZeta.filas.slice(0, 5).map(f => f.inscripcion.nombre_barco), ['Eco', 'Bravo', 'Alfa', 'Delta', 'Charly']);
chk('scratch manual en la config se respeta', S.calcularSerie({ inscripciones: insC, pruebas: pruebaC,
  resultados: resC, config: { sistema: 'tod', rating_scratch: 30.5, descarte_desde: 0 } })
  .filas.map(f => f.inscripcion.nombre_barco), ['Eco', 'Bravo', 'Alfa', 'Delta', 'Charly', 'Foxtrot']);

console.log('\n7 bis) Rating con / sin spinnaker (rating aplicado)');
const dosRatings = { rating: 25, rating_sin_spi: 23.5 }, unSolo = { rating: 18.4 };
chk('usó spinnaker → rating con spi', S.ratingAplicado(dosRatings, 'con'), 25);
chk('no usó spinnaker → rating sin spi', S.ratingAplicado(dosRatings, 'sin'), 23.5);
chk('dos ratings y sin declarar spi → no se puede aplicar', S.ratingAplicado(dosRatings, null), null);
chk('un solo rating y sin declarar spi → ese rating', S.ratingAplicado(unSolo, null), 18.4);
chk('declaró «sin» pero no tiene rating sin spi → null', S.ratingAplicado(unSolo, 'sin'), null);
chk('sólo tiene rating sin spi y no declaró → null', S.ratingAplicado({ rating_sin_spi: 20 }, null), null);
chk('rating_sin_spi vacío cuenta como que no lo tiene', S.ratingAplicado({ rating: 18.4, rating_sin_spi: '' }, null), 18.4);

console.log('\n7 ter) Carrera con spinnakers mixtos contra la planilla');
// Mismo recorrido (15:00, 14 mn). Cargado en la planilla del Comité y calculado por ella:
// aplicado = rating con o sin spi según el spinnaker usado; scratch = mayor rating APLICADO.
const spi = [   // nombre, con, sin, spi usado, llegada, [T en T], [T en D]
  ['Alfa',   25.0, 23.5, 'con', '19:41:48', 12850, 16552],
  ['Bravo',  25.2, 24.0, 'sin', '19:35:10', 12381, 16025],
  ['Charly', 18.4, null, 'con', '20:10:05', 12818, 17257],
  ['Delta',  22.0, 20.5, 'sin', '19:59:59', 12829, 17005],
  ['Eco',    30.5, 28.0, 'sin', '18:50:00', 10890, 13800]
];
const aplic = spi.map(f => S.ratingAplicado({ rating: f[1], rating_sin_spi: f[2] }, f[3]));
chk('ratings aplicados', aplic, [25, 24, 18.4, 20.5, 28]);
const scrSpi = S.ratingScratch(aplic);
chk('el scratch sale de los ratings APLICADOS (28 y no 30,5)', scrSpi, 28);
spi.forEach(([n, , , , ll, tot, tod], i) => {
  const real = S.tiempoNavegado(LARGADA, ll);
  chk(n + ': T en T con rating aplicado', S.tiempoCorregido(real, { sistema: 'tot_phrf' }, aplic[i]), tot);
  chk(n + ': T en D con rating aplicado', S.tiempoCorregido(real, { sistema: 'tod', rating_scratch: scrSpi }, aplic[i], DIST), tod);
});

const insS = spi.map(([n, con, sin], i) => ({ id: 's' + i, num_vela: String(201 + i), nombre_barco: n,
  timonel_nombre: 'T' + i, club: 'CNB', rating: con, rating_sin_spi: sin }));
insS.push({ id: 'sF', num_vela: '206', nombre_barco: 'Foxtrot', timonel_nombre: 'TF', club: 'CNB', rating: 20, rating_sin_spi: 19 });
insS.push({ id: 'sG', num_vela: '207', nombre_barco: 'Golf', timonel_nombre: 'TG', club: 'CNB', rating: 21, rating_sin_spi: 19.5 });
const resS = spi.map(([, , , sp, ll], i) => ({ prueba_id: 'q1', inscripcion_id: 's' + i, codigo: 'OK',
  hora_largada: LARGADA, hora_llegada: ll, spinnaker: sp }));
resS.push({ prueba_id: 'q1', inscripcion_id: 'sF', codigo: 'DNF' });                       // sin spinnaker declarado
resS.push({ prueba_id: 'q1', inscripcion_id: 'sG', codigo: 'OK', hora_largada: LARGADA, hora_llegada: '20:00:00' }); // tiene los 2 ratings y no declaró
const serieS = sis => S.calcularSerie({ inscripciones: insS, pruebas: pruebaC, resultados: resS,
  config: { sistema: sis, descarte_desde: 0 } });
chk('orden oficial T en T (Eco, Bravo, Charly, Delta, Alfa)',
    serieS('tot_phrf').filas.slice(0, 5).map(f => f.inscripcion.nombre_barco), ['Eco', 'Bravo', 'Charly', 'Delta', 'Alfa']);
chk('orden oficial T en D (Eco, Bravo, Alfa, Delta, Charly)',
    serieS('tod').filas.slice(0, 5).map(f => f.inscripcion.nombre_barco), ['Eco', 'Bravo', 'Alfa', 'Delta', 'Charly']);
const golf = serieS('tod').filas.find(f => f.inscripcion.nombre_barco === 'Golf').pruebas[0];
chk('Golf llegó pero no declaró spinnaker: queda sin tiempo corregido', golf.tiempoCorregidoS, null);
chk('y sin rating aplicado', golf.ratingAplicado, null);
const bravo = serieS('tod').filas.find(f => f.inscripcion.nombre_barco === 'Bravo').pruebas[0];
chk('la serie informa el rating aplicado y el spinnaker de cada barco', [bravo.ratingAplicado, bravo.spinnaker], [24, 'sin']);

console.log('\n8) CSV');
const csv = S.serieACSV(serie, 'Campeonato de prueba');
chk('CSV tiene encabezado de posiciones', csv.split('\n')[3].startsWith('Pos;'), true);
chk('CSV marca el descarte con paréntesis', /\(\d+\)/.test(csv), true);

console.log('\n──────────────────────────────');
console.log(ok + ' OK · ' + fail + ' fallidas');
process.exit(fail ? 1 : 0);
