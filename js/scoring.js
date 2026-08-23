/* ============================================================================
 * scoring.js — Motor de cálculo de resultados de regata
 * Club Náutico Bariloche — Comisión de Vela y Motor
 * ----------------------------------------------------------------------------
 * Implementa:
 *   1) Corrección de tiempos por handicap
 *        · monotipo    → sin corrección (orden de llegada)
 *        · tot_phrf    → Tiempo sobre Tiempo PHRF: TCF = B / (A + Rating)
 *                        Tiempo corregido = Tiempo real × TCF        [DEFECTO CNB]
 *        · tot_factor  → Tiempo sobre Tiempo con factor directo (estilo IRC TCC)
 *                        Tiempo corregido = Tiempo real × Factor
 *        · tod         → Tiempo sobre Distancia: TC = TR − (Rating[s/MN] × Distancia)
 *   2) Sistema de Puntuación Baja — Apéndice A, RRV 2025-2028 (World Sailing / FAY)
 *        · A4  puntaje por puesto (1º = 1 punto ...)
 *        · A5  puntaje de barcos que no largan / no llegan / son descalificados
 *              = (nº de barcos inscriptos en la serie) + 1
 *        · A7  empates en una prueba: se suman los puntos de los puestos
 *              empatados y se reparten en partes iguales
 *        · Regla 30.2 (bandera Z) y 44.3(c): penalización de puntaje del 20 %
 *        · Descartes configurables (no descartables: DNE y DGM)
 *        · A8.1 / A8.2 desempate de la serie
 *
 * Uso en navegador:  window.Scoring
 * Uso en Node (test): require('./scoring.js')
 * ==========================================================================*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scoring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Códigos de puntuación (Apéndice A RRV) — descripción y tratamiento
  // -------------------------------------------------------------------------
  const CODIGOS = {
    OK:  { label: 'Llegó',                                    llega: true,  penaliza: false, descartable: true  },
    DNC: { label: 'No largó: no se presentó al área (DNC)',    llega: false, penaliza: true,  descartable: true  },
    DNS: { label: 'No largó (DNS)',                            llega: false, penaliza: true,  descartable: true  },
    OCS: { label: 'Del lado del recorrido en la largada (OCS)',llega: false, penaliza: true,  descartable: true  },
    UFD: { label: 'Descalificado bandera U — regla 30.3 (UFD)',llega: false, penaliza: true,  descartable: true  },
    BFD: { label: 'Descalificado bandera negra — 30.4 (BFD)',  llega: false, penaliza: true,  descartable: true  },
    ZFP: { label: 'Penalización 20 % bandera Z — 30.2 (ZFP)',  llega: true,  penaliza: false, descartable: true, pctPenal: 0.20 },
    SCP: { label: 'Penalización de puntaje — regla 44.3 (SCP)',llega: true,  penaliza: false, descartable: true, pctPenal: 0.20 },
    DNF: { label: 'No llegó (DNF)',                            llega: false, penaliza: true,  descartable: true  },
    RET: { label: 'Se retiró después de llegar (RET)',         llega: false, penaliza: true,  descartable: true  },
    NSC: { label: 'No cumplió el recorrido (NSC)',             llega: false, penaliza: true,  descartable: true  },
    DSQ: { label: 'Descalificado (DSQ)',                       llega: false, penaliza: true,  descartable: true  },
    DNE: { label: 'Descalificación no descartable (DNE)',      llega: false, penaliza: true,  descartable: false },
    DGM: { label: 'Descalificación por mala conducta (DGM)',   llega: false, penaliza: true,  descartable: false },
    RDG: { label: 'Reparación otorgada (RDG)',                 llega: false, penaliza: false, descartable: true, manual: true },
    DPI: { label: 'Penalización discrecional (DPI)',           llega: true,  penaliza: false, descartable: true, manual: true }
  };

  // -------------------------------------------------------------------------
  // Utilidades de tiempo
  // -------------------------------------------------------------------------
  /** "hh:mm:ss" | "hh:mm" → segundos desde 00:00. Devuelve null si es inválido. */
  function hmsASegundos(txt) {
    if (txt === null || txt === undefined || txt === '') return null;
    if (typeof txt === 'number') return Math.round(txt);
    const m = String(txt).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (m[3] ? +m[3] : 0);
  }

  /** segundos → "h:mm:ss" (para tiempos navegados) */
  function segundosAHms(s) {
    if (s === null || s === undefined || isNaN(s)) return '—';
    const neg = s < 0;
    s = Math.round(Math.abs(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), q = s % 60;
    return (neg ? '-' : '') + h + ':' + String(m).padStart(2, '0') + ':' + String(q).padStart(2, '0');
  }

  /** Tiempo navegado = llegada − largada, tolerando cruce de medianoche. */
  function tiempoNavegado(horaLargada, horaLlegada) {
    const l = hmsASegundos(horaLargada), f = hmsASegundos(horaLlegada);
    if (l === null || f === null) return null;
    let d = f - l;
    if (d < 0) d += 86400;
    return d;
  }

  // -------------------------------------------------------------------------
  // 1) CORRECCIÓN DE TIEMPOS
  // -------------------------------------------------------------------------
  /**
   * Factor de corrección TCF para Tiempo sobre Tiempo PHRF.
   * TCF = B / (A + Rating)   — valores usuales A = 550, B = 650 (s/MN).
   * Un barco más rápido tiene rating MENOR y por lo tanto TCF MAYOR:
   * su tiempo real se "castiga" al corregirlo.
   */
  function tcfPhrf(rating, A, B) {
    A = (A === undefined || A === null) ? 550 : Number(A);
    B = (B === undefined || B === null) ? 650 : Number(B);
    const r = Number(rating);
    if (!isFinite(r) || (A + r) === 0) return null;
    return B / (A + r);
  }

  /**
   * Tiempo corregido, en segundos.
   * @param {number}  tiempoRealS  tiempo navegado en segundos
   * @param {object}  cfg          { sistema, phrf_a, phrf_b }
   * @param {number}  rating       rating del barco (s/MN en PHRF, factor en tot_factor)
   * @param {number}  distanciaMN  distancia del recorrido en millas náuticas (sólo ToD)
   */
  function tiempoCorregido(tiempoRealS, cfg, rating, distanciaMN) {
    if (tiempoRealS === null || tiempoRealS === undefined || !isFinite(tiempoRealS)) return null;
    const sistema = (cfg && cfg.sistema) || 'monotipo';
    switch (sistema) {
      case 'monotipo':
        return tiempoRealS;
      case 'tot_phrf': {
        const tcf = tcfPhrf(rating, cfg.phrf_a, cfg.phrf_b);
        return tcf === null ? null : tiempoRealS * tcf;
      }
      case 'tot_factor': {
        const f = Number(rating);
        return isFinite(f) && f > 0 ? tiempoRealS * f : null;
      }
      case 'tod': {
        const r = Number(rating), d = Number(distanciaMN);
        if (!isFinite(r) || !isFinite(d)) return null;
        return tiempoRealS - (r * d);
      }
      default:
        return tiempoRealS;
    }
  }

  // -------------------------------------------------------------------------
  // 2) PUNTAJE DE UNA PRUEBA
  // -------------------------------------------------------------------------
  /** Redondeo "0,5 hacia arriba" que usa el RRV (regla 44.3(c)). */
  function redondeoRRV(x) { return Math.floor(x + 0.5); }

  /**
   * Calcula puestos y puntos de UNA prueba.
   * @param {Array} lineas  [{ inscripcionId, codigo, tiempoCorregidoS, puntosManual }]
   * @param {number} nSerie nº de barcos inscriptos en la serie (base de A5)
   * @returns {Map} inscripcionId → { puesto, puntos, codigo }
   *
   * Reglas aplicadas:
   *   · A4  los que llegan se ordenan por tiempo corregido creciente; 1º = 1 punto.
   *   · A7  empate exacto de tiempo corregido → promedio de los puntos en juego.
   *   · A5  los que no llegan puntúan nSerie + 1.
   *   · 30.2 / 44.3(c)  ZFP y SCP: se penaliza en round(20 % × nSerie) puestos,
   *          nunca peor que DNF.
   *   · RDG / DPI  puntaje manual del jurado (si no se carga, se usa el de llegada).
   */
  function puntuarPrueba(lineas, nSerie) {
    const puntosPenal = nSerie + 1;
    const res = new Map();

    // --- a) los que llegan, ordenados por tiempo corregido ------------------
    const llegan = lineas
      .filter(l => (CODIGOS[l.codigo] || CODIGOS.OK).llega && l.tiempoCorregidoS !== null && l.tiempoCorregidoS !== undefined)
      .slice()
      .sort((a, b) => a.tiempoCorregidoS - b.tiempoCorregidoS);

    // Asignación de puestos con manejo de empates exactos (A7)
    let i = 0;
    const puestoDe = new Map(), puntosBase = new Map();
    while (i < llegan.length) {
      let j = i;
      while (j + 1 < llegan.length &&
             Math.abs(llegan[j + 1].tiempoCorregidoS - llegan[i].tiempoCorregidoS) < 0.0005) j++;
      const cant = j - i + 1;
      // puntos de los puestos i+1 .. j+1 repartidos en partes iguales
      let suma = 0;
      for (let k = i; k <= j; k++) suma += (k + 1);
      const prom = suma / cant;
      for (let k = i; k <= j; k++) {
        puestoDe.set(llegan[k].inscripcionId, i + 1);
        puntosBase.set(llegan[k].inscripcionId, prom);
      }
      i = j + 1;
    }

    // --- b) resolución final por línea --------------------------------------
    lineas.forEach(l => {
      const def = CODIGOS[l.codigo] || CODIGOS.OK;
      let puesto = puestoDe.has(l.inscripcionId) ? puestoDe.get(l.inscripcionId) : null;
      let puntos;

      if (def.penaliza) {
        puntos = puntosPenal;
        puesto = null;
      } else if (l.codigo === 'ZFP' || l.codigo === 'SCP') {
        const base = puestoDe.get(l.inscripcionId);
        if (base === undefined) {
          puntos = puntosPenal;
          puesto = null;
        } else {
          const pct = (def.pctPenal || 0.20);
          const lugares = Math.max(1, redondeoRRV(pct * nSerie));
          puntos = Math.min(base + lugares, puntosPenal);
        }
      } else if (def.manual) {
        puntos = (l.puntosManual !== null && l.puntosManual !== undefined && isFinite(l.puntosManual))
          ? Number(l.puntosManual)
          : (puntosBase.has(l.inscripcionId) ? puntosBase.get(l.inscripcionId) : puntosPenal);
      } else if (puntosBase.has(l.inscripcionId)) {
        puntos = puntosBase.get(l.inscripcionId);
      } else {
        // llegó pero sin tiempo corregido cargado → todavía no puntuable
        puntos = puntosPenal;
        puesto = null;
      }

      // El jurado siempre puede imponer puntaje (reparación, DPI, acuerdo)
      if (l.puntosManual !== null && l.puntosManual !== undefined && isFinite(l.puntosManual) && def.manual) {
        puntos = Number(l.puntosManual);
      }

      res.set(l.inscripcionId, {
        puesto: puesto,
        puntos: Math.round(puntos * 100) / 100,
        codigo: l.codigo || 'OK'
      });
    });

    return res;
  }

  // -------------------------------------------------------------------------
  // 3) DESCARTES
  // -------------------------------------------------------------------------
  /**
   * Cantidad de descartes según la configuración de la clase.
   * Ej. descarte_desde = 4, descarte_cada = 4 → 1 descarte con 4 pruebas válidas,
   *     2 con 8, etc. Nunca se descartan todas: siempre computa al menos una.
   */
  function cantidadDescartes(nValidas, cfg) {
    const desde = Number(cfg.descarte_desde || 0);
    const cada  = Number(cfg.descarte_cada  || 0);
    const max   = cfg.descartes_max === null || cfg.descartes_max === undefined ? 99 : Number(cfg.descartes_max);
    if (!desde || nValidas < desde) return 0;
    let n = 1;
    if (cada > 0) n = Math.floor((nValidas - desde) / cada) + 1;
    return Math.max(0, Math.min(n, max, nValidas - 1));
  }

  // -------------------------------------------------------------------------
  // 4) SERIE COMPLETA (clasificación general)
  // -------------------------------------------------------------------------
  /**
   * @param {Object} args
   *   inscripciones : [{ id, nombre_barco, num_vela, timonel_nombre, club, rating }]
   *   pruebas       : [{ id, numero, estado, distancia_mn }]
   *   resultados    : [{ prueba_id, inscripcion_id, codigo, tiempo_real_s,
   *                      tiempo_corregido_s, puntos_manual, hora_largada, hora_llegada }]
   *   config        : { sistema, phrf_a, phrf_b, descarte_desde, descarte_cada, descartes_max }
   * @returns {Object} { pruebas, filas, nSerie, descartes }
   */
  function calcularSerie(args) {
    const inscripciones = args.inscripciones || [];
    const cfg           = Object.assign({ sistema: 'monotipo', phrf_a: 550, phrf_b: 650,
                                          descarte_desde: 0, descarte_cada: 0, descartes_max: 0 }, args.config || {});
    const pruebas = (args.pruebas || [])
      .filter(p => p.estado === 'valida')
      .slice()
      .sort((a, b) => a.numero - b.numero);

    const nSerie    = inscripciones.length;
    const nValidas  = pruebas.length;
    const nDescartes = cantidadDescartes(nValidas, cfg);

    // Índice de resultados por prueba
    const porPrueba = new Map();
    (args.resultados || []).forEach(r => {
      if (!porPrueba.has(r.prueba_id)) porPrueba.set(r.prueba_id, []);
      porPrueba.get(r.prueba_id).push(r);
    });

    // --- puntaje prueba por prueba ------------------------------------------
    const puntajes = new Map();  // inscripcionId → [{ pruebaId, puesto, puntos, codigo }]
    inscripciones.forEach(ins => puntajes.set(ins.id, []));

    pruebas.forEach(p => {
      const cargados = porPrueba.get(p.id) || [];
      const porInsc  = new Map(cargados.map(r => [r.inscripcion_id, r]));

      const lineas = inscripciones.map(ins => {
        const r = porInsc.get(ins.id);
        if (!r) return { inscripcionId: ins.id, codigo: 'DNC', tiempoCorregidoS: null, puntosManual: null };

        let tr = (r.tiempo_real_s !== null && r.tiempo_real_s !== undefined)
          ? Number(r.tiempo_real_s)
          : tiempoNavegado(r.hora_largada || p.hora_largada, r.hora_llegada);

        let tc = (r.tiempo_corregido_s !== null && r.tiempo_corregido_s !== undefined)
          ? Number(r.tiempo_corregido_s)
          : tiempoCorregido(tr, cfg, ins.rating, p.distancia_mn);

        return {
          inscripcionId: ins.id,
          codigo: r.codigo || 'OK',
          tiempoRealS: tr,
          tiempoCorregidoS: tc,
          puntosManual: r.puntos_manual
        };
      });

      const out = puntuarPrueba(lineas, nSerie);
      const linPorId = new Map(lineas.map(l => [l.inscripcionId, l]));
      inscripciones.forEach(ins => {
        const o = out.get(ins.id);
        const l = linPorId.get(ins.id);
        puntajes.get(ins.id).push({
          pruebaId: p.id, numero: p.numero,
          puesto: o.puesto, puntos: o.puntos, codigo: o.codigo,
          tiempoRealS: l ? l.tiempoRealS : null,
          tiempoCorregidoS: l ? l.tiempoCorregidoS : null,
          descartado: false
        });
      });
    });

    // --- descartes y total ---------------------------------------------------
    const filas = inscripciones.map(ins => {
      const lista = puntajes.get(ins.id);
      // candidatos a descarte: peores puntajes entre los códigos descartables
      const idx = lista
        .map((x, k) => ({ k, x }))
        .filter(o => (CODIGOS[o.x.codigo] || CODIGOS.OK).descartable)
        .sort((a, b) => b.x.puntos - a.x.puntos || b.x.numero - a.x.numero);

      for (let d = 0; d < nDescartes && d < idx.length; d++) lista[idx[d].k].descartado = true;

      const total = lista.reduce((s, x) => s + (x.descartado ? 0 : x.puntos), 0);
      const bruto = lista.reduce((s, x) => s + x.puntos, 0);

      return {
        inscripcion: ins,
        pruebas: lista,
        total: Math.round(total * 100) / 100,
        totalBruto: Math.round(bruto * 100) / 100
      };
    });

    // --- orden y desempate (A8) ----------------------------------------------
    filas.sort((a, b) => (a.total - b.total) || desempate(a, b));

    let pos = 0, prev = null;
    filas.forEach((f, k) => {
      if (prev === null || f.total !== prev || desempate(f, filas[k - 1]) !== 0) pos = k + 1;
      f.posicion = pos;
      prev = f.total;
    });

    return {
      pruebas: pruebas,
      filas: filas,
      nSerie: nSerie,
      nValidas: nValidas,
      descartes: nDescartes,
      config: cfg
    };
  }

  /**
   * Desempate del RRV:
   *   A8.1 — se comparan los puntajes COMPUTADOS (sin los descartados) ordenados
   *          de mejor a peor; gana el que tenga el mejor en el primer punto de
   *          diferencia.
   *   A8.2 — si persiste, gana el que quedó mejor en la última prueba, luego en
   *          la anteúltima, y así sucesivamente. Acá SÍ se usan los descartados.
   */
  function desempate(a, b) {
    // A8.1
    const sa = a.pruebas.filter(x => !x.descartado).map(x => x.puntos).sort((m, n) => m - n);
    const sb = b.pruebas.filter(x => !x.descartado).map(x => x.puntos).sort((m, n) => m - n);
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      const va = sa[i] === undefined ? Infinity : sa[i];
      const vb = sb[i] === undefined ? Infinity : sb[i];
      if (va !== vb) return va - vb;
    }
    // A8.2
    const la = a.pruebas.slice().sort((m, n) => n.numero - m.numero);
    const lb = b.pruebas.slice().sort((m, n) => n.numero - m.numero);
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      const va = la[i] ? la[i].puntos : Infinity;
      const vb = lb[i] ? lb[i].puntos : Infinity;
      if (va !== vb) return va - vb;
    }
    return 0;
  }

  // -------------------------------------------------------------------------
  // 5) EXPORTACIÓN A CSV (planilla de resultados)
  // -------------------------------------------------------------------------
  function serieACSV(serie, titulo) {
    const cols = ['Pos', 'Nº Vela', 'Barco', 'Timonel', 'Club'];
    if (serie.config.sistema !== 'monotipo') cols.push('Rating');
    serie.pruebas.forEach(p => cols.push('R' + p.numero));
    cols.push('Total', 'Bruto');

    const filas = serie.filas.map(f => {
      const r = [f.posicion, f.inscripcion.num_vela, f.inscripcion.nombre_barco,
                 f.inscripcion.timonel_nombre, f.inscripcion.club || ''];
      if (serie.config.sistema !== 'monotipo') r.push(f.inscripcion.rating ?? '');
      serie.pruebas.forEach(p => {
        const x = f.pruebas.find(y => y.pruebaId === p.id);
        if (!x) { r.push(''); return; }
        const txt = x.codigo === 'OK' ? String(x.puntos) : (x.codigo + ' ' + x.puntos);
        r.push(x.descartado ? '(' + txt + ')' : txt);
      });
      r.push(f.total, f.totalBruto);
      return r;
    });

    const esc = v => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const cab = (titulo ? titulo + '\n' : '') +
      'Sistema: ' + serie.config.sistema + ' — Inscriptos: ' + serie.nSerie +
      ' — Pruebas válidas: ' + serie.nValidas + ' — Descartes: ' + serie.descartes + '\n\n';
    return cab + [cols, ...filas].map(r => r.map(esc).join(';')).join('\n');
  }

  // -------------------------------------------------------------------------
  return {
    CODIGOS,
    hmsASegundos, segundosAHms, tiempoNavegado,
    tcfPhrf, tiempoCorregido,
    puntuarPrueba, cantidadDescartes, calcularSerie, serieACSV
  };
});
