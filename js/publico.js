/* ============================================================================
 * publico.js — Portal público: calendario, ficha de evento, avisos,
 *              instrucciones, lista de inscriptos y resultados oficiales.
 * ==========================================================================*/
(function () {
  'use strict';
  const S = window.Scoring, D = window.DocsRegata;

  const estado = { temporadas: [], clases: [], eventos: [], eventoClases: [], evento: null, tab: 'info' };

  // =========================================================================
  // ARRANQUE
  // =========================================================================
  document.addEventListener('DOMContentLoaded', async () => {
    const idEvento = U.param('evento');
    try {
      const [tp, cl] = await Promise.all([
        db.from('temporadas').select('*').order('fecha_inicio', { ascending: false }),
        db.from('clases').select('*').eq('activa', true).order('orden')
      ]);
      estado.temporadas = tp.data || [];
      estado.clases = cl.data || [];
    } catch (e) { console.error(e); }

    if (idEvento) { await abrirEvento(idEvento); }
    else { await iniciarLista(); }
  });

  // =========================================================================
  // LISTADO / CALENDARIO
  // =========================================================================
  async function iniciarLista() {
    const fT = U.$('#fTemporada');
    fT.innerHTML = estado.temporadas.map(t =>
      `<option value="${t.id}" ${t.activa ? 'selected' : ''}>${U.esc(t.nombre)}</option>`).join('')
      || '<option value="">(sin temporadas cargadas)</option>';

    U.$('#fTipo').innerHTML = '<option value="">Todos</option>' +
      Object.keys(U.TIPOS).map(k => `<option value="${k}">${U.TIPOS[k]}</option>`).join('');
    U.$('#fClase').innerHTML = '<option value="">Todas</option>' +
      estado.clases.map(c => `<option value="${c.id}">${U.esc(c.nombre)}</option>`).join('');

    const act = estado.temporadas.find(t => t.activa) || estado.temporadas[0];
    U.$('#temporadaNombre').textContent = act ? act.nombre : '—';

    ['fTemporada', 'fTipo', 'fClase', 'fEstado'].forEach(id =>
      U.$('#' + id).addEventListener('change', cargarEventos));
    U.$('#btnICS').addEventListener('click', () => {
      const t = estado.temporadas.find(x => x.id === U.$('#fTemporada').value);
      U.descargar('regatas-cnb-' + (t ? t.nombre : 'calendario') + '.ics',
        U.ics(estado.eventos, 'Regatas CNB ' + (t ? t.nombre : '')), 'text/calendar');
    });
    U.$('#navResultados').addEventListener('click', e => {
      e.preventDefault();
      U.$('#fEstado').value = 'finalizado'; cargarEventos();
    });

    await cargarEventos();
  }

  async function cargarEventos() {
    const cont = U.$('#listaEventos');
    cont.innerHTML = '<div class="card muted">Cargando…</div>';

    let q = db.from('eventos').select('*').neq('estado', 'borrador').order('fecha_inicio');
    const tid = U.$('#fTemporada').value;
    if (tid) q = q.eq('temporada_id', tid);
    const tipo = U.$('#fTipo').value;
    if (tipo) q = q.eq('tipo', tipo);

    const { data, error } = await q;
    if (error) { cont.innerHTML = '<div class="alert error">' + U.esc(U.err(error)) + '</div>'; return; }

    let evs = data || [];

    // filtro por clase → requiere evento_clases
    const claseId = U.$('#fClase').value;
    if (claseId) {
      const { data: ec } = await db.from('evento_clases').select('evento_id').eq('clase_id', claseId);
      const ids = new Set((ec || []).map(x => x.evento_id));
      evs = evs.filter(e => ids.has(e.id));
    }

    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const f = U.$('#fEstado').value;
    if (f === 'proximos')            evs = evs.filter(e => U.fecha(e.fecha_fin || e.fecha_inicio) >= hoy && e.estado !== 'cancelado');
    else if (f === 'inscripcion_abierta') evs = evs.filter(e => e.estado === 'inscripcion_abierta');
    else if (f === 'finalizado')     evs = evs.filter(e => e.estado === 'finalizado' || U.fecha(e.fecha_fin || e.fecha_inicio) < hoy);

    estado.eventos = evs;
    pintarKPIs(data || [], hoy);

    if (!evs.length) {
      cont.innerHTML = '<div class="card center muted">No hay eventos que coincidan con el filtro.</div>';
      return;
    }
    cont.innerHTML = evs.map(fichaEvento).join('');
  }

  function pintarKPIs(todos, hoy) {
    const prox = todos.filter(e => U.fecha(e.fecha_fin || e.fecha_inicio) >= hoy && e.estado !== 'cancelado');
    const abiertos = todos.filter(e => e.estado === 'inscripcion_abierta');
    const regatas = todos.filter(e => e.tipo === 'regata' || e.tipo === 'campeonato');
    U.$('#kpis').innerHTML = [
      { v: todos.length, l: 'Eventos en la temporada' },
      { v: regatas.length, l: 'Regatas y campeonatos' },
      { v: prox.length, l: 'Próximos' },
      { v: abiertos.length, l: 'Con inscripción abierta' }
    ].map(k => `<div class="kpi"><div class="v">${k.v}</div><div class="l">${k.l}</div></div>`).join('');
  }

  function fichaEvento(e) {
    const d = U.fecha(e.fecha_inicio);
    const insc = e.estado === 'inscripcion_abierta';
    return `<div class="evento">
      <div class="fecha">
        <span class="d">${d.getDate()}</span>
        <span class="m">${U.MESES[d.getMonth()]}</span>
        <span class="y">${d.getFullYear()}</span>
      </div>
      <div class="cuerpo">
        <h3><a href="index.html?evento=${e.id}">${U.esc(e.nombre)}</a></h3>
        <div class="small muted">${U.rango(e.fecha_inicio, e.fecha_fin)}
          ${e.hora_senal_atencion ? ' · 1ª señal de atención ' + U.hora(e.hora_senal_atencion) + ' h' : ''}
          · ${U.esc(e.area_regata || e.sede || 'CNB')}</div>
        <div class="row" style="margin-top:7px">
          <span class="chip">${U.esc(U.TIPOS[e.tipo] || e.tipo)}</span>
          ${U.chipEstado(e.estado)}
          ${e.campeonato ? '<span class="chip azul">' + U.esc(e.campeonato) + '</span>' : ''}
          <span class="chip mono">${U.esc(e.codigo)}</span>
        </div>
        ${e.descripcion ? '<p class="small" style="margin:8px 0 0">' + U.esc(e.descripcion) + '</p>' : ''}
      </div>
      <div class="acciones">
        <a class="btn sec sm" href="index.html?evento=${e.id}">Ver evento</a>
        ${insc ? `<a class="btn sm" href="inscripcion.html?evento=${e.id}">Inscribirse</a>` : ''}
      </div>
    </div>`;
  }

  // =========================================================================
  // DETALLE DE EVENTO
  // =========================================================================
  async function abrirEvento(id) {
    U.$('#vistaLista').style.display = 'none';
    U.$('#vistaDetalle').style.display = '';

    const { data: ev, error } = await db.from('eventos').select('*').eq('id', id).single();
    if (error || !ev) {
      U.$('#panelDetalle').innerHTML = '<div class="alert error">No se encontró el evento solicitado.</div>';
      return;
    }
    estado.evento = ev;

    const { data: ec } = await db.from('evento_clases').select('*').eq('evento_id', id).order('orden_largada');
    estado.eventoClases = (ec || []).map(x =>
      Object.assign({}, x, estado.clases.find(c => c.id === x.clase_id) || {}, { id: x.id, clase_id: x.clase_id }));

    U.$('#evNombre').textContent = ev.nombre;
    U.$('#evSub').innerHTML = U.rango(ev.fecha_inicio, ev.fecha_fin) + ' · ' +
      U.esc(ev.sede || 'Club Náutico Bariloche') + ' · ' + (U.TIPOS[ev.tipo] || ev.tipo);

    U.$$('#tabsDetalle button').forEach(b => b.addEventListener('click', () => {
      U.$$('#tabsDetalle button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      estado.tab = b.dataset.t;
      pintarTab();
    }));

    const t = U.param('tab');
    if (t) {
      const b = U.$('#tabsDetalle button[data-t="' + t + '"]');
      if (b) { U.$$('#tabsDetalle button').forEach(x => x.classList.remove('on')); b.classList.add('on'); estado.tab = t; }
    }
    pintarTab();
  }

  function pintarTab() {
    const p = U.$('#panelDetalle');
    p.innerHTML = '<div class="card muted">Cargando…</div>';
    ({ info: tabInfo, aviso: () => tabDoc('aviso'), ir: () => tabDoc('instrucciones'),
       inscriptos: tabInscriptos, resultados: tabResultados })[estado.tab]();
  }

  // --- Información ---------------------------------------------------------
  function tabInfo() {
    const e = estado.evento;
    const insc = e.estado === 'inscripcion_abierta';
    const filas = [
      ['Código', '<span class="mono">' + U.esc(e.codigo) + '</span>'],
      ['Tipo', U.TIPOS[e.tipo] || e.tipo],
      ['Estado', U.chipEstado(e.estado)],
      ['Fechas', U.rango(e.fecha_inicio, e.fecha_fin)],
      ['Reunión de timoneles', e.hora_briefing ? U.hora(e.hora_briefing) + ' h' : '—'],
      ['1ª señal de atención', e.hora_senal_atencion ? U.hora(e.hora_senal_atencion) + ' h' : '—'],
      ['Sede', e.sede || '—'],
      ['Área de regatas', e.area_regata || '—'],
      ['Canal VHF', e.canal_vhf || '—'],
      ['Autoridad Organizadora', e.autoridad_organizadora || '—'],
      ['Oficial Principal de Regata', e.oficial_principal || '—'],
      ['Comité de Regata', e.comite_regata || '—'],
      ['Comité de Protestas', e.comite_protestas || '—'],
      ['Campeonato', e.campeonato || '—'],
      ['Cierre de inscripción', e.inscripcion_cierre ? new Date(e.inscripcion_cierre).toLocaleString('es-AR') : '—'],
      ['Arancel socios', e.arancel_socio ? '$ ' + Number(e.arancel_socio).toLocaleString('es-AR') : 'Sin cargo'],
      ['Arancel invitados', e.arancel_invitado ? '$ ' + Number(e.arancel_invitado).toLocaleString('es-AR') : 'Sin cargo'],
      ['Contacto', [e.contacto_nombre, e.contacto_email, e.contacto_tel].filter(Boolean).join(' · ') || '—']
    ];

    U.$('#panelDetalle').innerHTML = `
      ${insc ? `<div class="alert ok"><strong>Inscripción abierta.</strong>
        Completá el formulario en línea. <a class="btn sm" style="margin-left:8px"
        href="inscripcion.html?evento=${e.id}">Inscribirme</a></div>` : ''}
      <div class="grid g2">
        <div class="card">
          <h2>Datos del evento</h2>
          <div class="tabla-wrap"><table class="t"><tbody>
            ${filas.map(f => `<tr><th style="width:44%">${f[0]}</th><td style="white-space:normal">${f[1]}</td></tr>`).join('')}
          </tbody></table></div>
        </div>
        <div>
          <div class="card">
            <h2>Clases participantes</h2>
            ${estado.eventoClases.length ? `<div class="tabla-wrap"><table class="t">
              <thead><tr><th>Clase</th><th>Sistema de puntaje</th><th class="num">Pruebas</th><th>Descartes</th></tr></thead>
              <tbody>${estado.eventoClases.map(c => `<tr>
                <td>${U.esc(c.nombre || '')}</td>
                <td style="white-space:normal">${U.esc(D.nombreSistema(c.sistema))}</td>
                <td class="num">${c.pruebas_previstas || '—'}</td>
                <td>${c.descarte_desde ? '1 desde ' + c.descarte_desde : 'Sin descarte'}</td>
              </tr>`).join('')}</tbody></table></div>`
              : '<p class="muted">Todavía no se cargaron las clases participantes.</p>'}
          </div>
          ${e.descripcion ? '<div class="card"><h2>Descripción</h2><p style="white-space:pre-wrap">' + U.esc(e.descripcion) + '</p></div>' : ''}
          ${e.premios ? '<div class="card"><h2>Premios</h2><p style="white-space:pre-wrap">' + U.esc(e.premios) + '</p></div>' : ''}
          <div class="card">
            <h2>Seguridad</h2>
            <p class="small">Uso permanente de chaleco salvavidas obligatorio (modifica la regla 40 del RRV).
            Registro obligatorio de salida y regreso. Todo barco que se retire debe avisar al Comité de Regata
            por VHF canal ${U.esc(e.canal_vhf || '71')} antes de dejar el área de regatas.</p>
            <p class="small"><strong>Regla 3 del RRV — Decisión de regatear:</strong> la responsabilidad de la
            decisión de un barco de participar en una prueba o de continuar en regata es solamente suya.</p>
          </div>
        </div>
      </div>`;
  }

  // --- Aviso / Instrucciones ----------------------------------------------
  async function tabDoc(tipo) {
    const e = estado.evento;
    const { data } = await db.from('documentos_regata').select('*')
      .eq('evento_id', e.id).eq('tipo', tipo).eq('publicado', true)
      .order('version', { ascending: false }).limit(1);

    const doc = (data || [])[0];
    const p = U.$('#panelDetalle');

    if (!doc) {
      p.innerHTML = `<div class="alert info">Todavía no se publicó ${tipo === 'aviso'
        ? 'el Aviso de Regata' : 'las Instrucciones de Regata'} de este evento.</div>`;
      return;
    }

    const html = doc.html || D.renderHTML(
      tipo === 'aviso' ? D.avisoDeRegata(e, estado.eventoClases, doc.contenido || {})
                       : D.instruccionesDeRegata(e, estado.eventoClases, doc.contenido || {}),
      e, { logo: (window.CNB_CONFIG || {}).LOGO, version: doc.version });

    p.innerHTML = `<div class="row no-print" style="margin-bottom:12px">
        <span class="chip azul">Versión ${doc.version}</span>
        ${doc.fecha_publicacion ? '<span class="chip">Publicado ' + new Date(doc.fecha_publicacion).toLocaleDateString('es-AR') + '</span>' : ''}
        <div class="spacer"></div>
        ${doc.url_archivo ? '<a class="btn sec sm" target="_blank" href="' + U.esc(doc.url_archivo) + '">Descargar PDF</a>' : ''}
        <button class="btn sm" id="btnImp">Imprimir / Guardar PDF</button>
      </div>` + html;
    U.$('#btnImp').addEventListener('click', () => U.imprimir(html, doc.titulo));
  }

  // --- Inscriptos -----------------------------------------------------------
  async function tabInscriptos() {
    const e = estado.evento;
    const { data, error } = await db.from('v_inscriptos_publico').select('*').eq('evento_id', e.id);
    const p = U.$('#panelDetalle');
    if (error) { p.innerHTML = '<div class="alert error">' + U.esc(U.err(error)) + '</div>'; return; }

    const ins = data || [];
    if (!ins.length) {
      p.innerHTML = '<div class="alert info">Todavía no hay inscripciones confirmadas para este evento.' +
        (e.estado === 'inscripcion_abierta' ? ' <a href="inscripcion.html?evento=' + e.id + '">Inscribite acá</a>.' : '') + '</div>';
      return;
    }

    const porClase = {};
    ins.forEach(i => { (porClase[i.clase_id] = porClase[i.clase_id] || []).push(i); });

    p.innerHTML = Object.keys(porClase).map(cid => {
      const c = estado.clases.find(x => x.id === cid) || { nombre: 'Clase' };
      const lista = porClase[cid].sort((a, b) => String(a.num_vela).localeCompare(String(b.num_vela), 'es', { numeric: true }));
      const handicap = lista.some(x => x.rating !== null && x.rating !== undefined);
      return `<div class="card"><h2>${U.esc(c.nombre)} <span class="chip">${lista.length} barcos</span></h2>
        <div class="tabla-wrap"><table class="t">
          <thead><tr><th class="num">#</th><th>Nº vela</th><th>Barco</th><th>Timonel</th><th>Club</th>
          ${handicap ? '<th class="num">Rating</th>' : ''}<th>Estado</th></tr></thead>
          <tbody>${lista.map((i, k) => `<tr>
            <td class="num">${k + 1}</td>
            <td class="mono">${U.esc(i.num_vela)}</td>
            <td>${U.esc(i.nombre_barco)}</td>
            <td>${U.esc(i.timonel_nombre)}</td>
            <td>${U.esc(i.club || '')}</td>
            ${handicap ? '<td class="num">' + (i.rating ?? '—') + '</td>' : ''}
            <td><span class="chip ${(U.ESTADOS_INSC[i.estado] || {}).chip || ''}">${(U.ESTADOS_INSC[i.estado] || {}).txt || i.estado}</span></td>
          </tr>`).join('')}</tbody></table></div></div>`;
    }).join('');
  }

  // --- Resultados -----------------------------------------------------------
  async function tabResultados() {
    const e = estado.evento;
    const p = U.$('#panelDetalle');

    const [ri, rp, rr] = await Promise.all([
      db.from('v_inscriptos_publico').select('*').eq('evento_id', e.id),
      db.from('pruebas').select('*').eq('evento_id', e.id).order('numero'),
      db.from('resultados').select('*')
    ]);

    const insc = (ri.data || []).filter(i => i.estado === 'confirmada');
    const pruebas = rp.data || [];
    const idsPruebas = new Set(pruebas.map(x => x.id));
    const resultados = (rr.data || []).filter(r => idsPruebas.has(r.prueba_id));

    if (!pruebas.filter(x => x.estado === 'valida').length) {
      p.innerHTML = '<div class="alert info">Todavía no hay pruebas válidas cargadas para este evento.</div>';
      return;
    }

    p.innerHTML = estado.eventoClases.map(ec => {
      const ins = insc.filter(i => i.clase_id === ec.clase_id);
      if (!ins.length) return '';
      const pr = pruebas.filter(x => !x.clase_id || x.clase_id === ec.clase_id);
      const serie = S.calcularSerie({
        inscripciones: ins, pruebas: pr,
        resultados: resultados.filter(r => pr.some(x => x.id === r.prueba_id)),
        config: ec
      });
      return tablaSerie(serie, ec, e);
    }).join('') || '<div class="alert info">Sin clases con inscriptos confirmados.</div>';

    U.$$('[data-csv]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.csv;
      const ec = estado.eventoClases[i];
      const ins = insc.filter(x => x.clase_id === ec.clase_id);
      const pr = pruebas.filter(x => !x.clase_id || x.clase_id === ec.clase_id);
      const serie = S.calcularSerie({ inscripciones: ins, pruebas: pr,
        resultados: resultados.filter(r => pr.some(x => x.id === r.prueba_id)), config: ec });
      U.descargar('resultados-' + e.codigo + '-' + (ec.codigo || 'clase') + '.csv',
        S.serieACSV(serie, e.nombre + ' — ' + ec.nombre), 'text/csv');
    }));
  }

  function tablaSerie(serie, ec, ev) {
    const idx = estado.eventoClases.indexOf(ec);
    const hand = ec.sistema !== 'monotipo';
    return `<div class="card">
      <div class="row">
        <h2 class="mt0 mb0">${U.esc(ec.nombre || 'Clase')}</h2>
        <span class="chip azul">${U.esc(D.nombreSistema(ec.sistema))}</span>
        <span class="chip">${serie.nValidas} prueba(s) válida(s)</span>
        <span class="chip">${serie.descartes} descarte(s)</span>
        <span class="chip">${serie.nSerie} inscriptos</span>
        <div class="spacer"></div>
        <button class="btn sec sm no-print" data-csv="${idx}">↓ CSV</button>
      </div>
      <div class="tabla-wrap" style="margin-top:11px"><table class="t">
        <thead><tr>
          <th class="num">Pos</th><th>Nº vela</th><th>Barco</th><th>Timonel</th><th>Club</th>
          ${hand ? '<th class="num">Rating</th>' : ''}
          ${serie.pruebas.map(p => '<th class="num" title="' + U.esc(p.recorrido || '') + '">R' + p.numero + '</th>').join('')}
          <th class="num">Total</th>
        </tr></thead>
        <tbody>${serie.filas.map(f => `<tr class="${f.posicion <= 3 ? 'podio' + f.posicion : ''}">
          <td class="num"><strong>${f.posicion}</strong></td>
          <td class="mono">${U.esc(f.inscripcion.num_vela)}</td>
          <td>${U.esc(f.inscripcion.nombre_barco)}</td>
          <td>${U.esc(f.inscripcion.timonel_nombre)}</td>
          <td>${U.esc(f.inscripcion.club || '')}</td>
          ${hand ? '<td class="num">' + (f.inscripcion.rating ?? '—') + '</td>' : ''}
          ${f.pruebas.map(x => `<td class="num ${x.descartado ? 'desc' : ''}"
             title="${x.codigo !== 'OK' ? U.esc((S.CODIGOS[x.codigo] || {}).label || x.codigo) : ''}">
             ${x.descartado ? '(' : ''}${x.codigo !== 'OK' ? x.codigo + ' ' : ''}${x.puntos}${x.descartado ? ')' : ''}</td>`).join('')}
          <td class="num"><strong>${f.total}</strong></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="small muted" style="margin:9px 0 0">
        Sistema de Puntuación Baja — Apéndice A del RRV 2025-2028. Entre paréntesis, el puntaje descartado.
        Empates resueltos según la regla A8. Los puntajes de barcos que no largan, no llegan o son
        descalificados equivalen a ${serie.nSerie + 1} puntos (inscriptos + 1).
      </p>
    </div>`;
  }
})();
