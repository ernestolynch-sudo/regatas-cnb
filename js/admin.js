/* ============================================================================
 * admin.js — Panel de la Comisión de Vela y Motor
 * ABM de eventos, clases y puntaje, generación y publicación de Aviso de Regata
 * e Instrucciones de Regata, gestión de inscripciones, carga de llegadas,
 * cálculo de resultados y checklist organizativo.
 * ==========================================================================*/
(function () {
  'use strict';
  const S = window.Scoring, D = window.DocsRegata, C = window.CNB_CONFIG || {};

  const st = {
    usuario: null, rol: null,
    temporadas: [], clases: [], eventos: [],
    ev: null, evClases: [], insc: [], pruebas: [], resultados: [],
    tabEv: 'clases', tabCfg: 'temporadas'
  };

  // Roles habilitados por función (debe reflejar las políticas RLS de supabase/schema.sql)
  const ROL_ADMIN     = ['admin'];
  const ROL_COMISION  = ['admin', 'comision'];       // eventos, temporadas, clases, docs, checklist
  const ROL_OFICIAL   = ['admin', 'comision', 'oficial'];   // pruebas y resultados
  const ROL_SECRETARIA = ['admin', 'comision', 'secretaria']; // inscripciones
  const puede = roles => !roles || roles.includes(st.rol);

  const TABS_EV = { clases: ROL_COMISION, docs: ROL_COMISION, insc: ROL_SECRETARIA,
                     pruebas: ROL_OFICIAL, org: ROL_COMISION, difusion: null };

  /** Muestra/oculta según el rol los controles que disparan escrituras restringidas por RLS. */
  function aplicarPermisosUI() {
    U.$('#btnNuevoEvento').style.display = puede(ROL_COMISION) ? '' : 'none';
    U.$('#btnEditarEvento').style.display = puede(ROL_COMISION) ? '' : 'none';
    U.$('#selEstado').style.display = puede(ROL_COMISION) ? '' : 'none';
    const navConfig = U.$('#nav a[data-v="config"]');
    if (navConfig) navConfig.style.display = puede(ROL_COMISION) ? '' : 'none';
    Object.keys(TABS_EV).forEach(t => {
      const btn = U.$('#tabsEv button[data-t="' + t + '"]');
      if (btn) btn.style.display = puede(TABS_EV[t]) ? '' : 'none';
    });
    const btnUsuarios = U.$('#tabsCfg button[data-t="usuarios"]');
    if (btnUsuarios) btnUsuarios.style.display = puede(ROL_ADMIN) ? '' : 'none';
    if (!puede(TABS_EV[st.tabEv])) {
      st.tabEv = Object.keys(TABS_EV).find(t => puede(TABS_EV[t])) || 'difusion';
      U.$$('#tabsEv button').forEach(b => b.classList.toggle('on', b.dataset.t === st.tabEv));
    }
  }

  // =========================================================================
  // AUTENTICACIÓN
  // =========================================================================
  document.addEventListener('DOMContentLoaded', async () => {
    U.$('#btnLoginPin').addEventListener('click', loginPin);
    U.$('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') loginPin(); });
    U.$('#email').addEventListener('keydown', e => { if (e.key === 'Enter') loginPin(); });

    U.$('#linkConfigurarPin').addEventListener('click', e => {
      e.preventDefault();
      U.$('#emailPin').value = U.$('#email').value;
      U.$('#cardLoginPin').style.display = 'none';
      U.$('#cardConfigurarPin').style.display = '';
    });
    U.$('#linkVolverLoginPin').addEventListener('click', e => {
      e.preventDefault();
      U.$('#cardConfigurarPin').style.display = 'none';
      U.$('#cardLoginPin').style.display = '';
    });
    U.$('#btnEnviarRecuperoPin').addEventListener('click', enviarRecuperoPin);
    U.$('#emailPin').addEventListener('keydown', e => { if (e.key === 'Enter') enviarRecuperoPin(); });
    U.$('#btnGuardarNuevoPin').addEventListener('click', guardarNuevoPin);
    U.$('#nuevoPin').addEventListener('keydown', e => { if (e.key === 'Enter') guardarNuevoPin(); });

    U.$('#btnSalir').addEventListener('click', async () => { await db.auth.signOut(); location.reload(); });

    db.auth.onAuthStateChange((evt, s) => {
      if (evt === 'PASSWORD_RECOVERY') { mostrarNuevoPin(); return; }
      if (s && !st.usuario) verificar(s);
    });
    const { data } = await db.auth.getSession();
    if (data && data.session) verificar(data.session);
  });

  function mostrarNuevoPin() {
    U.$('#cardLoginPin').style.display = 'none';
    U.$('#cardConfigurarPin').style.display = 'none';
    U.$('#cardNuevoPin').style.display = '';
  }

  async function loginPin() {
    const email = U.$('#email').value.trim().toLowerCase();
    const pin = U.$('#pin').value.trim();
    if (!email || !pin) return;
    if (!/^\d{6}$/.test(pin)) { U.aviso('#loginAviso', 'error', 'El PIN debe tener 6 dígitos.'); return; }
    U.aviso('#loginAviso', 'info', 'Verificando…');
    const { error } = await db.auth.signInWithPassword({ email, password: pin });
    if (error) U.aviso('#loginAviso', 'error', U.esc(U.err(error)));
  }

  async function enviarRecuperoPin() {
    const email = U.$('#emailPin').value.trim().toLowerCase();
    if (!email) return;
    U.aviso('#pinAviso', 'info', 'Enviando enlace…');
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname
    });
    U.aviso('#pinAviso', error ? 'error' : 'ok',
      error ? U.esc(U.err(error))
            : 'Enlace enviado a <strong>' + U.esc(email) + '</strong>. Revisá tu correo (y la carpeta de spam) y abrilo en este mismo navegador.');
  }

  async function guardarNuevoPin() {
    const pin = U.$('#nuevoPin').value.trim();
    if (!/^\d{6}$/.test(pin)) { U.aviso('#nuevoPinAviso', 'error', 'El PIN debe tener 6 dígitos.'); return; }
    U.aviso('#nuevoPinAviso', 'info', 'Guardando…');
    const { error } = await db.auth.updateUser({ password: pin });
    if (error) { U.aviso('#nuevoPinAviso', 'error', U.esc(U.err(error))); return; }
    U.aviso('#nuevoPinAviso', 'ok', 'PIN guardado. Entrando…');
    const { data } = await db.auth.getSession();
    if (data && data.session) verificar(data.session);
  }

  async function verificar(session) {
    const email = session.user.email;
    const { data, error } = await db.from('usuarios_autorizados').select('*').ilike('email', email).maybeSingle();
    if (error || !data || !data.activo) {
      U.$('#cardNuevoPin').style.display = 'none';
      U.$('#cardConfigurarPin').style.display = 'none';
      U.$('#cardLoginPin').style.display = '';
      U.aviso('#loginAviso', 'error',
        'El correo <strong>' + U.esc(email) + '</strong> no está habilitado en el sistema. ' +
        'Pedile a un administrador que lo agregue en <code>usuarios_autorizados</code>.');
      await db.auth.signOut();
      return;
    }
    st.usuario = data; st.rol = data.rol;
    U.$('#login').style.display = 'none';
    U.$('#app').style.display = '';
    U.$('#nav').style.display = '';
    aplicarPermisosUI();
    U.$$('#nav a[data-v]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      U.$$('#nav a[data-v]').forEach(x => x.classList.remove('on'));
      a.classList.add('on');
      mostrar(a.dataset.v);
    }));
    U.$('#btnVolver').addEventListener('click', () => mostrar('eventos'));
    U.$('#btnNuevoEvento').addEventListener('click', () => formEvento(null));
    U.$('#btnEditarEvento').addEventListener('click', () => formEvento(st.ev));
    U.$('#filTemporada').addEventListener('change', listarEventos);
    U.$('#filEstado').addEventListener('change', listarEventos);
    U.$$('#tabsEv button').forEach(b => b.addEventListener('click', () => {
      U.$$('#tabsEv button').forEach(x => x.classList.remove('on')); b.classList.add('on');
      st.tabEv = b.dataset.t; pintarTabEv();
    }));
    U.$$('#tabsCfg button').forEach(b => b.addEventListener('click', () => {
      U.$$('#tabsCfg button').forEach(x => x.classList.remove('on')); b.classList.add('on');
      st.tabCfg = b.dataset.t; pintarTabCfg();
    }));
    U.$('#selEstado').innerHTML = Object.keys(U.ESTADOS)
      .map(k => `<option value="${k}">${U.ESTADOS[k].txt}</option>`).join('');
    U.$('#selEstado').addEventListener('change', async () => {
      await guardar('eventos', { id: st.ev.id, estado: U.$('#selEstado').value });
      st.ev.estado = U.$('#selEstado').value;
      U.$('#tEvEstado').innerHTML = U.chipEstado(st.ev.estado);
    });
    U.$('#filEstado').innerHTML = '<option value="">Todos los estados</option>' +
      Object.keys(U.ESTADOS).map(k => `<option value="${k}">${U.ESTADOS[k].txt}</option>`).join('');

    await recargarCatalogos();
    mostrar('eventos');
  }

  function mostrar(v) {
    U.$('#heroEventos').style.display = v === 'eventos' ? '' : 'none';
    U.$('#vEventos').style.display = v === 'eventos' ? '' : 'none';
    U.$('#vEvento').style.display  = v === 'evento'  ? '' : 'none';
    U.$('#vConfig').style.display  = v === 'config'  ? '' : 'none';
    if (v === 'eventos') listarEventos();
    if (v === 'config')  pintarTabCfg();
  }

  // =========================================================================
  // HELPERS DE DATOS
  // =========================================================================
  async function recargarCatalogos() {
    const [t, c] = await Promise.all([
      db.from('temporadas').select('*').order('fecha_inicio', { ascending: false }),
      db.from('clases').select('*').order('orden')
    ]);
    st.temporadas = t.data || []; st.clases = c.data || [];
    const act = st.temporadas.find(x => x.activa) || st.temporadas[0];
    U.$('#filTemporada').innerHTML = '<option value="">Todas las temporadas</option>' +
      st.temporadas.map(x => `<option value="${x.id}" ${act && x.id === act.id ? 'selected' : ''}>${U.esc(x.nombre)}</option>`).join('');
  }

  async function guardar(tabla, reg) {
    const { data, error } = reg.id
      ? await db.from(tabla).update(reg).eq('id', reg.id).select().single()
      : await db.from(tabla).insert(reg).select().single();
    if (error) { alert('Error: ' + U.err(error)); throw error; }
    return data;
  }

  async function borrar(tabla, id, msg) {
    if (!confirm(msg || '¿Confirmás la eliminación? Esta acción no se puede deshacer.')) return false;
    const { error } = await db.from(tabla).delete().eq('id', id);
    if (error) { alert('Error: ' + U.err(error)); return false; }
    return true;
  }

  // =========================================================================
  // MODAL
  // =========================================================================
  function modal(titulo, cuerpoHTML, botones) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal">
      <header><h2>${U.esc(titulo)}</h2><button class="x">&times;</button></header>
      <div class="body">${cuerpoHTML}</div>
      <footer></footer></div>`;
    const cerrar = () => bg.remove();
    bg.querySelector('.x').addEventListener('click', cerrar);
    bg.addEventListener('click', e => { if (e.target === bg) cerrar(); });
    const foot = bg.querySelector('footer');
    (botones || [{ txt: 'Cerrar', cls: 'ghost' }]).forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || '');
      el.textContent = b.txt;
      el.addEventListener('click', async () => { if (!b.fn || (await b.fn(bg)) !== false) cerrar(); });
      foot.appendChild(el);
    });
    U.$('#modales').appendChild(bg);
    return bg;
  }

  // =========================================================================
  // LISTA DE EVENTOS
  // =========================================================================
  async function listarEventos() {
    const cont = U.$('#tablaEventos');
    cont.innerHTML = '<div class="card muted">Cargando…</div>';
    let q = db.from('eventos').select('*').order('fecha_inicio', { ascending: false });
    if (U.$('#filTemporada').value) q = q.eq('temporada_id', U.$('#filTemporada').value);
    if (U.$('#filEstado').value)    q = q.eq('estado', U.$('#filEstado').value);
    const { data, error } = await q;
    if (error) { cont.innerHTML = '<div class="alert error">' + U.esc(U.err(error)) + '</div>'; return; }
    st.eventos = data || [];

    // conteo de inscripciones por evento
    const { data: ins } = await db.from('inscripciones').select('evento_id, estado');
    const cuenta = {};
    (ins || []).forEach(i => {
      cuenta[i.evento_id] = cuenta[i.evento_id] || { t: 0, c: 0, p: 0 };
      cuenta[i.evento_id].t++;
      if (i.estado === 'confirmada') cuenta[i.evento_id].c++;
      if (i.estado === 'pendiente')  cuenta[i.evento_id].p++;
    });

    if (!st.eventos.length) { cont.innerHTML = '<div class="card center muted">Todavía no hay eventos cargados.</div>'; return; }

    cont.innerHTML = `<div class="tabla-wrap"><table class="t">
      <thead><tr><th>Código</th><th>Fecha</th><th>Evento</th><th>Tipo</th><th>Estado</th>
        <th class="num">Inscriptos</th><th class="num">Pend.</th><th></th></tr></thead>
      <tbody>${st.eventos.map(e => {
        const n = cuenta[e.id] || { t: 0, c: 0, p: 0 };
        return `<tr>
          <td class="mono">${U.esc(e.codigo)}</td>
          <td>${U.fechaCorta(e.fecha_inicio)}</td>
          <td><a href="#" data-ev="${e.id}">${U.esc(e.nombre)}</a></td>
          <td>${U.esc(U.TIPOS[e.tipo] || e.tipo)}</td>
          <td>${U.chipEstado(e.estado)}</td>
          <td class="num">${n.c}</td>
          <td class="num">${n.p ? '<span class="chip naranja">' + n.p + '</span>' : '—'}</td>
          <td class="right"><button class="btn sec sm" data-ev="${e.id}">Abrir</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;

    U.$$('[data-ev]', cont).forEach(a => a.addEventListener('click', e => {
      e.preventDefault(); abrirEvento(a.dataset.ev);
    }));
  }

  // =========================================================================
  // FORMULARIO DE EVENTO
  // =========================================================================
  /** Formatea un timestamp para <input type="datetime-local"> en hora LOCAL del navegador (no UTC). */
  function isoLocal(d) {
    const dt = new Date(d);
    const pad = n => String(n).padStart(2, '0');
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()) +
      'T' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
  }

  function formEvento(ev) {
    ev = ev || {};
    const t = st.temporadas.find(x => x.activa) || st.temporadas[0] || {};
    const f = (id, val) => U.esc(ev[id] ?? val ?? '');
    const html = `
      <div class="grid g2">
        <div class="field"><label>Temporada *</label><select id="f_temporada_id">
          ${st.temporadas.map(x => `<option value="${x.id}" ${(ev.temporada_id || t.id) === x.id ? 'selected' : ''}>${U.esc(x.nombre)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Código *</label><input id="f_codigo" value="${f('codigo')}" placeholder="REG-2627-01"></div>
      </div>
      <div class="field"><label>Nombre del evento *</label><input id="f_nombre" value="${f('nombre')}" placeholder="Regata de Apertura de Temporada"></div>
      <div class="grid g3">
        <div class="field"><label>Tipo</label><select id="f_tipo">
          ${Object.keys(U.TIPOS).map(k => `<option value="${k}" ${ev.tipo === k ? 'selected' : ''}>${U.TIPOS[k]}</option>`).join('')}
        </select></div>
        <div class="field"><label>Campeonato / serie</label><input id="f_campeonato" value="${f('campeonato')}" placeholder="Campeonato Nahuel Huapi"></div>
        <div class="field"><label>Estado</label><select id="f_estado">
          ${Object.keys(U.ESTADOS).map(k => `<option value="${k}" ${(ev.estado || 'borrador') === k ? 'selected' : ''}>${U.ESTADOS[k].txt}</option>`).join('')}
        </select></div>
      </div>
      <div class="grid g4">
        <div class="field"><label>Fecha inicio *</label><input type="date" id="f_fecha_inicio" value="${f('fecha_inicio')}"></div>
        <div class="field"><label>Fecha fin *</label><input type="date" id="f_fecha_fin" value="${f('fecha_fin')}"></div>
        <div class="field"><label>Briefing</label><input type="time" id="f_hora_briefing" value="${f('hora_briefing').slice(0,5)}"></div>
        <div class="field"><label>1ª señal atención</label><input type="time" id="f_hora_senal_atencion" value="${f('hora_senal_atencion').slice(0,5)}"></div>
      </div>
      <div class="grid g3">
        <div class="field"><label>Sede</label><input id="f_sede" value="${f('sede', 'Club Náutico Bariloche')}"></div>
        <div class="field"><label>Área de regatas</label><input id="f_area_regata" value="${f('area_regata')}" placeholder="Bahía del Club — Nahuel Huapi"></div>
        <div class="field"><label>Canal VHF</label><input id="f_canal_vhf" value="${f('canal_vhf', C.CANAL_VHF_DEFECTO || '71')}"></div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Autoridad Organizadora</label><input id="f_autoridad_organizadora" value="${f('autoridad_organizadora', 'Club Náutico Bariloche — Comisión de Vela y Motor')}"></div>
        <div class="field"><label>Oficial Principal de Regata</label><input id="f_oficial_principal" value="${f('oficial_principal')}"></div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Comité de Regata</label><input id="f_comite_regata" value="${f('comite_regata')}"></div>
        <div class="field"><label>Comité de Protestas</label><input id="f_comite_protestas" value="${f('comite_protestas')}"></div>
      </div>
      <div class="grid g4">
        <div class="field"><label>Apertura inscripción</label><input type="datetime-local" id="f_inscripcion_apertura" value="${ev.inscripcion_apertura ? isoLocal(ev.inscripcion_apertura) : ''}"></div>
        <div class="field"><label>Cierre inscripción</label><input type="datetime-local" id="f_inscripcion_cierre" value="${ev.inscripcion_cierre ? isoLocal(ev.inscripcion_cierre) : ''}"></div>
        <div class="field"><label>Arancel socios ($)</label><input type="number" step="0.01" id="f_arancel_socio" value="${f('arancel_socio', 0)}"></div>
        <div class="field"><label>Arancel invitados ($)</label><input type="number" step="0.01" id="f_arancel_invitado" value="${f('arancel_invitado', 0)}"></div>
      </div>
      <div class="field"><label>Datos de pago (alias / CBU / instrucciones)</label><input id="f_datos_pago" value="${f('datos_pago')}"></div>
      <div class="field"><label>Descripción</label><textarea id="f_descripcion">${f('descripcion')}</textarea></div>
      <div class="field"><label>Premios</label><textarea id="f_premios">${f('premios')}</textarea></div>
      <div class="grid g3">
        <div class="field"><label>Contacto — nombre</label><input id="f_contacto_nombre" value="${f('contacto_nombre')}"></div>
        <div class="field"><label>Contacto — email</label><input id="f_contacto_email" value="${f('contacto_email')}"></div>
        <div class="field"><label>Contacto — teléfono</label><input id="f_contacto_tel" value="${f('contacto_tel')}"></div>
      </div>`;

    modal(ev.id ? 'Editar evento' : 'Nuevo evento', html, [
      { txt: 'Cancelar', cls: 'ghost' },
      { txt: 'Guardar', fn: async (bg) => {
        const g = id => { const el = U.$('#f_' + id, bg); return el ? el.value : ''; };
        const reg = {
          temporada_id: g('temporada_id'), codigo: g('codigo').trim(), nombre: g('nombre').trim(),
          tipo: g('tipo'), campeonato: g('campeonato').trim() || null, estado: g('estado'),
          fecha_inicio: g('fecha_inicio'), fecha_fin: g('fecha_fin') || g('fecha_inicio'),
          hora_briefing: g('hora_briefing') || null, hora_senal_atencion: g('hora_senal_atencion') || null,
          sede: g('sede'), area_regata: g('area_regata') || null, canal_vhf: g('canal_vhf') || null,
          autoridad_organizadora: g('autoridad_organizadora'),
          oficial_principal: g('oficial_principal') || null,
          comite_regata: g('comite_regata') || null, comite_protestas: g('comite_protestas') || null,
          inscripcion_apertura: g('inscripcion_apertura') ? new Date(g('inscripcion_apertura')).toISOString() : null,
          inscripcion_cierre:   g('inscripcion_cierre')   ? new Date(g('inscripcion_cierre')).toISOString()   : null,
          arancel_socio: +g('arancel_socio') || 0, arancel_invitado: +g('arancel_invitado') || 0,
          datos_pago: g('datos_pago') || null,
          descripcion: g('descripcion') || null, premios: g('premios') || null,
          contacto_nombre: g('contacto_nombre') || null, contacto_email: g('contacto_email') || null,
          contacto_tel: g('contacto_tel') || null,
          creado_por: st.usuario.email
        };
        if (!reg.codigo || !reg.nombre || !reg.fecha_inicio) { alert('Código, nombre y fecha de inicio son obligatorios.'); return false; }
        if (ev.id) reg.id = ev.id;
        const out = await guardar('eventos', reg);
        if (st.ev && st.ev.id === out.id) { st.ev = out; abrirEvento(out.id); }
        else listarEventos();
      } }
    ]);
  }

  // =========================================================================
  // FICHA DE EVENTO
  // =========================================================================
  async function abrirEvento(id) {
    const { data, error } = await db.from('eventos').select('*').eq('id', id).single();
    if (error) { alert(U.err(error)); return; }
    st.ev = data;
    U.$('#tEvNombre').textContent = data.nombre;
    U.$('#tEvEstado').innerHTML = U.chipEstado(data.estado);
    U.$('#selEstado').value = data.estado;
    mostrar('evento');
    await refrescarEvento();
    pintarTabEv();
  }

  async function refrescarEvento() {
    const id = st.ev.id;
    const [ec, ins, pr] = await Promise.all([
      db.from('evento_clases').select('*').eq('evento_id', id).order('orden_largada'),
      db.from('inscripciones').select('*').eq('evento_id', id).order('created_at'),
      db.from('pruebas').select('*').eq('evento_id', id).order('numero')
    ]);
    st.evClases = (ec.data || []).map(x =>
      Object.assign({}, st.clases.find(c => c.id === x.clase_id) || {}, x));
    st.insc = ins.data || [];
    st.pruebas = pr.data || [];
    if (st.pruebas.length) {
      const { data } = await db.from('resultados').select('*').in('prueba_id', st.pruebas.map(p => p.id));
      st.resultados = data || [];
    } else st.resultados = [];
  }

  function pintarTabEv() {
    ({ clases: tabClases, docs: tabDocs, insc: tabInsc,
       pruebas: tabPruebas, org: tabOrg, difusion: tabDifusion })[st.tabEv]();
  }

  // ---------------------------------------------------------------- CLASES
  function tabClases() {
    const p = U.$('#panelEv');
    const disp = st.clases.filter(c => c.activa && !st.evClases.some(e => e.clase_id === c.id));
    p.innerHTML = `<div class="card">
      <div class="row">
        <h2 class="mt0 mb0">Clases participantes y sistema de puntaje</h2>
        <div class="spacer"></div>
        <select id="addClase" style="width:auto">
          <option value="">— agregar clase —</option>
          ${disp.map(c => `<option value="${c.id}">${U.esc(c.nombre)}</option>`).join('')}
        </select>
      </div>
      ${st.evClases.length ? `<div class="tabla-wrap" style="margin-top:12px"><table class="t">
        <thead><tr><th>Clase</th><th>Sistema</th><th class="num">A</th><th class="num">B</th>
          <th class="num">Pruebas</th><th class="num">Mín.</th><th class="num">Desc. desde</th>
          <th class="num">Desc. cada</th><th class="num">Máx.</th><th>Bandera</th><th></th></tr></thead>
        <tbody>${st.evClases.map(c => `<tr data-ec="${c.id}">
          <td><strong>${U.esc(c.nombre || '')}</strong></td>
          <td><select class="c-sistema">
            ${['monotipo','tot_phrf','tot_factor','tod'].map(s =>
              `<option value="${s}" ${c.sistema === s ? 'selected' : ''}>${D.nombreSistema(s)}</option>`).join('')}
          </select></td>
          <td class="num"><input class="c-a" type="number" step="1" value="${c.phrf_a ?? 550}" style="width:74px"></td>
          <td class="num"><input class="c-b" type="number" step="1" value="${c.phrf_b ?? 650}" style="width:74px"></td>
          <td class="num"><input class="c-pp" type="number" value="${c.pruebas_previstas ?? 3}" style="width:64px"></td>
          <td class="num"><input class="c-pm" type="number" value="${c.pruebas_minimas ?? 1}" style="width:64px"></td>
          <td class="num"><input class="c-dd" type="number" value="${c.descarte_desde ?? 4}" style="width:64px"></td>
          <td class="num"><input class="c-dc" type="number" value="${c.descarte_cada ?? 4}" style="width:64px"></td>
          <td class="num"><input class="c-dm" type="number" value="${c.descartes_max ?? 2}" style="width:64px"></td>
          <td><input class="c-bd" value="${U.esc(c.bandera_clase || '')}" style="width:110px" placeholder="ej. D"></td>
          <td class="right"><button class="btn ghost sm c-del">✕</button></td>
        </tr>`).join('')}</tbody></table></div>
        <div class="row end" style="margin-top:12px"><button class="btn" id="btnGuardarClases">Guardar configuración</button></div>`
        : '<p class="muted" style="margin-top:12px">Todavía no agregaste clases a este evento.</p>'}
      <div class="alert info small" style="margin-top:14px">
        <strong>PHRF Tiempo sobre Tiempo:</strong> <code>TCF = B / (A + Rating)</code> y
        <code>Tiempo corregido = Tiempo real × TCF</code>. Con A=550 y B=650 un barco de rating 100
        tiene TCF = 1,000. Bajar A endurece la corrección entre barcos de ratings distintos.<br>
        <strong>Descartes:</strong> «desde 4 / cada 4 / máx. 2» significa 1 descarte al completarse
        4 pruebas válidas y 2 al completarse 8. Poner «desde 0» para no descartar.
      </div>
    </div>`;

    U.$('#addClase').addEventListener('change', async e => {
      if (!e.target.value) return;
      const cl = st.clases.find(c => c.id === e.target.value);
      await guardar('evento_clases', {
        evento_id: st.ev.id, clase_id: cl.id,
        sistema: cl.tipo === 'handicap' ? 'tot_phrf' : 'monotipo',
        phrf_a: C.PHRF_A || 550, phrf_b: C.PHRF_B || 650,
        orden_largada: st.evClases.length + 1
      });
      await refrescarEvento(); tabClases();
    });

    U.$$('.c-del', p).forEach(b => b.addEventListener('click', async () => {
      const id = b.closest('tr').dataset.ec;
      if (await borrar('evento_clases', id, '¿Quitar esta clase del evento?')) { await refrescarEvento(); tabClases(); }
    }));

    const btn = U.$('#btnGuardarClases');
    if (btn) btn.addEventListener('click', async () => {
      for (const tr of U.$$('tr[data-ec]', p)) {
        await guardar('evento_clases', {
          id: tr.dataset.ec,
          sistema: U.$('.c-sistema', tr).value,
          phrf_a: +U.$('.c-a', tr).value, phrf_b: +U.$('.c-b', tr).value,
          pruebas_previstas: +U.$('.c-pp', tr).value, pruebas_minimas: +U.$('.c-pm', tr).value,
          descarte_desde: +U.$('.c-dd', tr).value, descarte_cada: +U.$('.c-dc', tr).value,
          descartes_max: +U.$('.c-dm', tr).value,
          bandera_clase: U.$('.c-bd', tr).value.trim() || null
        });
      }
      await refrescarEvento(); tabClases();
      alert('Configuración de clases guardada.');
    });
  }

  // ------------------------------------------------- AVISO / INSTRUCCIONES
  async function tabDocs() {
    const p = U.$('#panelEv');
    const { data } = await db.from('documentos_regata').select('*')
      .eq('evento_id', st.ev.id).order('tipo').order('version', { ascending: false });
    const docs = data || [];

    p.innerHTML = ['aviso', 'instrucciones'].map(tipo => {
      const propios = docs.filter(d => d.tipo === tipo);
      const nombre = tipo === 'aviso' ? 'Aviso de Regata' : 'Instrucciones de Regata';
      return `<div class="card">
        <div class="row">
          <h2 class="mt0 mb0">${nombre}</h2>
          <span class="chip">Apéndice ${tipo === 'aviso' ? 'J1' : 'J2'} · RRV ${D.RRV_CICLO}</span>
          <div class="spacer"></div>
          <button class="btn sec sm" data-prev="${tipo}">Previsualizar</button>
          <button class="btn sm" data-gen="${tipo}">Generar nueva versión</button>
        </div>
        ${propios.length ? `<div class="tabla-wrap" style="margin-top:12px"><table class="t">
          <thead><tr><th class="num">Ver.</th><th>Título</th><th>Publicado</th><th>Fecha</th><th></th></tr></thead>
          <tbody>${propios.map(d => `<tr>
            <td class="num">${d.version}</td>
            <td>${U.esc(d.titulo)}</td>
            <td>${d.publicado ? '<span class="chip verde">Publicado</span>' : '<span class="chip">Borrador</span>'}</td>
            <td>${d.fecha_publicacion ? U.fechaCorta(d.fecha_publicacion) : '—'}</td>
            <td class="right">
              <button class="btn ghost sm" data-ver="${d.id}">Ver</button>
              <button class="btn ghost sm" data-edit="${d.id}">Editar</button>
              <button class="btn ${d.publicado ? 'ghost' : 'ok'} sm" data-pub="${d.id}">${d.publicado ? 'Despublicar' : 'Publicar'}</button>
              <button class="btn ghost sm" data-del="${d.id}">✕</button>
            </td></tr>`).join('')}</tbody></table></div>`
          : `<p class="muted" style="margin-top:12px">Todavía no hay ${nombre.toLowerCase()} para este evento.
             «Generar nueva versión» crea el texto completo conforme al Apéndice J del RRV, con los datos del
             evento y las particularidades del Nahuel Huapi ya cargados. Después lo podés editar sección por sección.</p>`}
      </div>`;
    }).join('');

    U.$$('[data-gen]', p).forEach(b => b.addEventListener('click', () => generarDoc(b.dataset.gen, docs)));
    U.$$('[data-prev]', p).forEach(b => b.addEventListener('click', () => previsualizar(b.dataset.prev)));
    U.$$('[data-ver]', p).forEach(b => b.addEventListener('click', () => verDoc(docs.find(d => d.id === b.dataset.ver))));
    U.$$('[data-edit]', p).forEach(b => b.addEventListener('click', () => editarDoc(docs.find(d => d.id === b.dataset.edit))));
    U.$$('[data-pub]', p).forEach(b => b.addEventListener('click', async () => {
      const d = docs.find(x => x.id === b.dataset.pub);
      await guardar('documentos_regata', { id: d.id, publicado: !d.publicado,
        fecha_publicacion: !d.publicado ? new Date().toISOString() : null });
      tabDocs();
    }));
    U.$$('[data-del]', p).forEach(b => b.addEventListener('click', async () => {
      if (await borrar('documentos_regata', b.dataset.del, '¿Eliminar esta versión del documento?')) tabDocs();
    }));
  }

  function armar(tipo, opc) {
    return tipo === 'aviso'
      ? D.avisoDeRegata(st.ev, st.evClases, opc || {})
      : D.instruccionesDeRegata(st.ev, st.evClases, opc || {});
  }

  function previsualizar(tipo) {
    const doc = armar(tipo);
    const html = D.renderHTML(doc, st.ev, { logo: C.LOGO, version: '—' });
    modal('Previsualización — ' + doc.titulo, html,
      [{ txt: 'Imprimir', cls: 'sec', fn: () => { U.imprimir(html, doc.titulo); return false; } },
       { txt: 'Cerrar', cls: 'ghost' }]);
  }

  async function generarDoc(tipo, docs) {
    if (!st.evClases.length && !confirm('El evento todavía no tiene clases cargadas: el documento saldrá incompleto. ¿Continuar igual?')) return;
    const ver = Math.max(0, ...docs.filter(d => d.tipo === tipo).map(d => d.version)) + 1;
    const doc = armar(tipo);
    await guardar('documentos_regata', {
      evento_id: st.ev.id, tipo, version: ver, titulo: doc.titulo + ' — ' + st.ev.nombre,
      contenido: { secciones: doc.secciones, opciones: {} },
      html: D.renderHTML(doc, st.ev, { logo: C.LOGO, version: ver }),
      publicado: false, creado_por: st.usuario.email
    });
    tabDocs();
  }

  function verDoc(d) {
    const html = d.html || D.renderHTML(
      { titulo: d.titulo, secciones: (d.contenido || {}).secciones || [] }, st.ev, { logo: C.LOGO, version: d.version });
    modal(d.titulo, html,
      [{ txt: 'Imprimir / PDF', cls: 'sec', fn: () => { U.imprimir(html, d.titulo); return false; } },
       { txt: 'Cerrar', cls: 'ghost' }]);
  }

  function editarDoc(d) {
    const secs = (d.contenido || {}).secciones || [];
    const html = `<p class="small muted">Editá el texto de cada sección. Se admite HTML simple
      (<code>&lt;p&gt;</code>, <code>&lt;ul&gt;</code>, <code>&lt;table&gt;</code>, <code>&lt;strong&gt;</code>).
      Al guardar se regenera el documento publicable.</p>
      <div class="field"><label>Título</label><input id="d_titulo" value="${U.esc(d.titulo)}"></div>
      ${secs.map((s, i) => `<div class="field">
        <label>${i + 1}. <input class="s-tit" data-i="${i}" value="${U.esc(s.titulo)}" style="display:inline-block;width:auto;min-width:280px"></label>
        <textarea class="s-cue" data-i="${i}" style="min-height:120px">${U.esc(s.cuerpo)}</textarea>
      </div>`).join('')}`;

    modal('Editar — ' + d.titulo, html, [
      { txt: 'Cancelar', cls: 'ghost' },
      { txt: 'Guardar', fn: async bg => {
        const nuevas = secs.map((s, i) => ({
          id: s.id,
          titulo: U.$('.s-tit[data-i="' + i + '"]', bg).value,
          cuerpo: U.$('.s-cue[data-i="' + i + '"]', bg).value
        }));
        const titulo = U.$('#d_titulo', bg).value;
        await guardar('documentos_regata', {
          id: d.id, titulo,
          contenido: Object.assign({}, d.contenido, { secciones: nuevas }),
          html: D.renderHTML({ titulo: titulo.split('—')[0].trim(), secciones: nuevas }, st.ev,
                             { logo: C.LOGO, version: d.version })
        });
        tabDocs();
      } }
    ]);
  }

  // ------------------------------------------------------------ INSCRIPCIONES
  function tabInsc() {
    const p = U.$('#panelEv');
    const porEstado = e => st.insc.filter(i => i.estado === e).length;
    p.innerHTML = `
      <div class="grid g4" style="margin-bottom:14px">
        ${[['Total', st.insc.length], ['Confirmadas', porEstado('confirmada')],
           ['Pendientes', porEstado('pendiente')], ['Pagadas', st.insc.filter(i => i.pago_estado === 'pagado').length]]
          .map(k => `<div class="kpi"><div class="v">${k[1]}</div><div class="l">${k[0]}</div></div>`).join('')}
      </div>
      <div class="card">
        <div class="row">
          <h2 class="mt0 mb0">Inscripciones</h2>
          <div class="spacer"></div>
          <button class="btn sec sm" id="btnConfirmarTodas">Confirmar pendientes</button>
          <button class="btn sec sm" id="btnCSVInsc">↓ CSV</button>
          <button class="btn sec sm" id="btnLargada">Lista de largada (imprimir)</button>
          <button class="btn sm" id="btnNuevaInsc">+ Inscripción manual</button>
        </div>
        ${st.insc.length ? `<div class="tabla-wrap" style="margin-top:12px"><table class="t">
          <thead><tr><th>Folio</th><th>Clase</th><th>Nº vela</th><th>Barco</th><th>Timonel</th>
            <th>Club</th><th class="num">Rating</th><th>Contacto</th><th>Seguro</th><th>Estado</th><th>Pago</th><th></th></tr></thead>
          <tbody>${st.insc.map(i => {
            const cl = st.clases.find(c => c.id === i.clase_id) || {};
            const ee = U.ESTADOS_INSC[i.estado] || {};
            return `<tr>
              <td class="mono small">${U.esc(i.folio || '—')}</td>
              <td>${U.esc(cl.codigo || '')}</td>
              <td class="mono">${U.esc(i.num_vela)}</td>
              <td>${U.esc(i.nombre_barco)}</td>
              <td>${U.esc(i.timonel_nombre)}</td>
              <td>${U.esc(i.club || '')}</td>
              <td class="num">${i.rating ?? '—'}</td>
              <td class="small">${U.esc(i.timonel_tel || '')}</td>
              <td>${i.seguro_poliza ? '<span class="chip verde">Sí</span>' : '<span class="chip rojo">Falta</span>'}</td>
              <td><span class="chip ${ee.chip || ''}">${ee.txt || i.estado}</span></td>
              <td><span class="chip ${i.pago_estado === 'pagado' ? 'verde' : i.pago_estado === 'exento' ? 'azul' : 'naranja'}">${i.pago_estado}</span></td>
              <td class="right"><button class="btn ghost sm" data-i="${i.id}">Abrir</button></td>
            </tr>`;
          }).join('')}</tbody></table></div>`
          : '<p class="muted" style="margin-top:12px">Todavía no hay inscripciones.</p>'}
      </div>`;

    U.$$('[data-i]', p).forEach(b => b.addEventListener('click', () => fichaInsc(st.insc.find(x => x.id === b.dataset.i))));
    U.$('#btnNuevaInsc').addEventListener('click', () => fichaInsc(null));
    U.$('#btnCSVInsc').addEventListener('click', exportarInsc);
    U.$('#btnLargada').addEventListener('click', listaLargada);
    U.$('#btnConfirmarTodas').addEventListener('click', async () => {
      const pend = st.insc.filter(i => i.estado === 'pendiente');
      if (!pend.length) { alert('No hay inscripciones pendientes.'); return; }
      if (!confirm('¿Confirmar las ' + pend.length + ' inscripciones pendientes?')) return;
      for (const i of pend) await guardar('inscripciones', { id: i.id, estado: 'confirmada',
        revisado_por: st.usuario.email, revisado_at: new Date().toISOString() });
      await refrescarEvento(); tabInsc();
    });
  }

  const DOCS_INSC = [
    { campo: 'seguro_archivo_path',       nombre: 'seguro',       txt: 'Constancia de seguro' },
    { campo: 'comprobante_pago_path',     nombre: 'comprobante',  txt: 'Comprobante de pago' },
    { campo: 'tripulantes_archivo_path',  nombre: 'tripulantes',  txt: 'Listado de tripulantes' },
    { campo: 'carnet_archivo_path',       nombre: 'carnet',       txt: 'Carnet de timonel' },
    { campo: 'licencia_fay_archivo_path', nombre: 'licencia_fay', txt: 'Licencia FAY' }
  ];
  const MAX_ARCHIVO = 10 * 1024 * 1024; // 10 MB, igual al límite del bucket 'inscripciones-docs'

  async function verDocInsc(path) {
    const { data, error } = await db.storage.from('inscripciones-docs').createSignedUrl(path, 120);
    if (error) { alert('No se pudo abrir el archivo: ' + U.err(error)); return; }
    window.open(data.signedUrl, '_blank');
  }

  async function subirDocInsc(inscripcionId, campo, nombreBase, file) {
    if (file.size > MAX_ARCHIVO) { alert('El archivo pesa más de 10 MB.'); return null; }
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = inscripcionId + '/' + nombreBase + '.' + ext;
    const { error: eUp } = await db.storage.from('inscripciones-docs')
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (eUp) { alert('No se pudo subir el archivo: ' + U.err(eUp)); return null; }
    await guardar('inscripciones', { id: inscripcionId, [campo]: path });
    return path;
  }

  function fichaInsc(i) {
    i = i || {};
    const trip = Array.isArray(i.tripulantes) ? i.tripulantes : [];
    const html = `
      <div class="grid g3">
        <div class="field"><label>Clase</label><select id="i_clase_id">
          ${st.evClases.map(c => `<option value="${c.clase_id}" ${i.clase_id === c.clase_id ? 'selected' : ''}>${U.esc(c.nombre)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Nº de vela</label><input id="i_num_vela" value="${U.esc(i.num_vela || '')}"></div>
        <div class="field"><label>Nombre del barco</label><input id="i_nombre_barco" value="${U.esc(i.nombre_barco || '')}"></div>
      </div>
      <div class="grid g3">
        <div class="field"><label>Modelo</label><input id="i_modelo" value="${U.esc(i.modelo || '')}"></div>
        <div class="field"><label>Club</label><input id="i_club" value="${U.esc(i.club || '')}"></div>
        <div class="field"><label>Rating (s/MN)</label><input type="number" step="0.1" id="i_rating" value="${i.rating ?? ''}"></div>
      </div>
      <div class="grid g3">
        <div class="field"><label>Matrícula REY</label><input id="i_matricula_rey" value="${U.esc(i.matricula_rey || '')}"></div>
      </div>
      <div class="grid g3">
        <div class="field"><label>Timonel</label><input id="i_timonel_nombre" value="${U.esc(i.timonel_nombre || '')}"></div>
        <div class="field"><label>Email</label><input id="i_timonel_email" value="${U.esc(i.timonel_email || '')}"></div>
        <div class="field"><label>Teléfono</label><input id="i_timonel_tel" value="${U.esc(i.timonel_tel || '')}"></div>
      </div>
      <div class="grid g3">
        <div class="field"><label>Estado</label><select id="i_estado">
          ${Object.keys(U.ESTADOS_INSC).map(k => `<option value="${k}" ${(i.estado || 'pendiente') === k ? 'selected' : ''}>${U.ESTADOS_INSC[k].txt}</option>`).join('')}
        </select></div>
        <div class="field"><label>Pago</label><select id="i_pago_estado">
          ${['impago','pagado','exento'].map(k => `<option value="${k}" ${(i.pago_estado || 'impago') === k ? 'selected' : ''}>${k}</option>`).join('')}
        </select></div>
        <div class="field"><label>Monto ($)</label><input type="number" step="0.01" id="i_monto" value="${i.monto ?? ''}"></div>
      </div>
      <fieldset><legend>Tripulación y seguridad</legend>
        <p class="small">${trip.length ? trip.map(t => U.esc(t.nombre) + (t.dni ? ' (DNI ' + U.esc(t.dni) + ')' : '')).join(' · ') : '<span class="muted">Sin tripulantes declarados.</span>'}</p>
        <p class="small"><strong>Emergencia:</strong> ${U.esc(i.emergencia_nombre || '—')} · ${U.esc(i.emergencia_tel || '—')}<br>
        <strong>Seguro:</strong> ${U.esc(i.seguro_compania || '—')} · póliza ${U.esc(i.seguro_poliza || '—')} ·
        vence ${i.seguro_vencimiento ? U.fechaCorta(i.seguro_vencimiento) : '—'}<br>
        <strong>Licencia FAY:</strong> ${U.esc(i.timonel_licencia_fay || '—')} ·
        <strong>Socio:</strong> ${i.timonel_socio ? 'sí' : 'no'} ·
        <strong>Menor con autorización:</strong> ${i.autoriza_menor ? 'sí' : 'no'}</p>
        ${i.observaciones ? '<p class="small"><strong>Observaciones:</strong> ' + U.esc(i.observaciones) + '</p>' : ''}
      </fieldset>
      <fieldset><legend>Documentos adjuntos</legend>
        ${i.id ? DOCS_INSC.map(d => `
          <div class="doc-adjunto">
            <span class="txt">${i[d.campo] ? '<span class="chip verde">Sí</span>' : '<span class="chip rojo">Falta</span>'} ${U.esc(d.txt)}</span>
            ${i[d.campo] ? `<button type="button" class="btn ghost sm" data-ver="${d.campo}">Ver</button>` : ''}
            <input type="file" accept="application/pdf,image/*" data-subir="${d.campo}" data-nombre="${d.nombre}" style="width:auto;flex:1;min-width:180px">
          </div>`).join('')
        : '<p class="small muted">Guardá la inscripción para poder adjuntar documentos.</p>'}
      </fieldset>
      <div class="field"><label>Motivo de rechazo (si corresponde)</label><input id="i_motivo_rechazo" value="${U.esc(i.motivo_rechazo || '')}"></div>`;

    const botones = [{ txt: 'Cancelar', cls: 'ghost' }];
    if (i.id) botones.push({ txt: 'Eliminar', cls: 'danger', fn: async () => {
      if (await borrar('inscripciones', i.id, '¿Eliminar la inscripción de ' + i.nombre_barco + '?')) { await refrescarEvento(); tabInsc(); }
      else return false;
    } });
    botones.push({ txt: 'Guardar', fn: async bg => {
      const g = id => U.$('#i_' + id, bg).value;
      const reg = {
        evento_id: st.ev.id, clase_id: g('clase_id'),
        num_vela: g('num_vela').trim().toUpperCase(), nombre_barco: g('nombre_barco').trim(),
        modelo: g('modelo') || null, club: g('club') || null,
        rating: g('rating') === '' ? null : +g('rating'),
        matricula_rey: g('matricula_rey').trim().toUpperCase() || null,
        timonel_nombre: g('timonel_nombre').trim(), timonel_email: g('timonel_email').trim(),
        timonel_tel: g('timonel_tel').trim(),
        estado: g('estado'), pago_estado: g('pago_estado'),
        monto: g('monto') === '' ? null : +g('monto'),
        motivo_rechazo: g('motivo_rechazo') || null,
        revisado_por: st.usuario.email, revisado_at: new Date().toISOString()
      };
      if (!i.id) { reg.acepta_rrv = true; reg.acepta_riesgo = true; }
      if (i.id) reg.id = i.id;
      await guardar('inscripciones', reg);
      await refrescarEvento(); tabInsc();
    } });

    const bg = modal(i.id ? 'Inscripción ' + (i.folio || '') : 'Nueva inscripción (carga manual)', html, botones);
    U.$$('[data-ver]', bg).forEach(b => b.addEventListener('click', () => verDocInsc(i[b.dataset.ver])));
    U.$$('[data-subir]', bg).forEach(inp => inp.addEventListener('change', async () => {
      const file = inp.files[0];
      if (!file) return;
      const campo = inp.dataset.subir;
      const path = await subirDocInsc(i.id, campo, inp.dataset.nombre, file);
      if (path) { i[campo] = path; bg.remove(); fichaInsc(i); }
    }));
  }

  function exportarInsc() {
    const cols = [
      { titulo: 'Folio', valor: 'folio' },
      { titulo: 'Clase', valor: i => (st.clases.find(c => c.id === i.clase_id) || {}).nombre || '' },
      { titulo: 'Nº vela', valor: 'num_vela' }, { titulo: 'Barco', valor: 'nombre_barco' },
      { titulo: 'Modelo', valor: 'modelo' }, { titulo: 'Club', valor: 'club' },
      { titulo: 'Rating', valor: 'rating' }, { titulo: 'Matrícula REY', valor: 'matricula_rey' },
      { titulo: 'Timonel', valor: 'timonel_nombre' }, { titulo: 'DNI', valor: 'timonel_dni' },
      { titulo: 'Nacimiento', valor: 'timonel_nacimiento' },
      { titulo: 'Email', valor: 'timonel_email' }, { titulo: 'Teléfono', valor: 'timonel_tel' },
      { titulo: 'Licencia FAY', valor: 'timonel_licencia_fay' },
      { titulo: 'Socio', valor: i => i.timonel_socio ? 'SI' : 'NO' },
      { titulo: 'Tripulantes', valor: i => (i.tripulantes || []).map(t => t.nombre).join(' | ') },
      { titulo: 'Emergencia', valor: i => (i.emergencia_nombre || '') + ' ' + (i.emergencia_tel || '') },
      { titulo: 'Seguro', valor: i => (i.seguro_compania || '') + ' ' + (i.seguro_poliza || '') },
      { titulo: 'Vto. seguro', valor: 'seguro_vencimiento' },
      { titulo: 'Doc. seguro', valor: i => i.seguro_archivo_path ? 'SI' : 'NO' },
      { titulo: 'Doc. comprobante pago', valor: i => i.comprobante_pago_path ? 'SI' : 'NO' },
      { titulo: 'Doc. tripulantes', valor: i => i.tripulantes_archivo_path ? 'SI' : 'NO' },
      { titulo: 'Doc. carnet', valor: i => i.carnet_archivo_path ? 'SI' : 'NO' },
      { titulo: 'Doc. licencia FAY', valor: i => i.licencia_fay_archivo_path ? 'SI' : 'NO' },
      { titulo: 'Estado', valor: 'estado' }, { titulo: 'Pago', valor: 'pago_estado' },
      { titulo: 'Monto', valor: 'monto' }, { titulo: 'Observaciones', valor: 'observaciones' }
    ];
    U.descargar('inscripciones-' + st.ev.codigo + '.csv', U.csv(st.insc, cols), 'text/csv');
  }

  function listaLargada() {
    const conf = st.insc.filter(i => i.estado === 'confirmada');
    const html = `<article class="doc-regata">
      <header class="doc-head"><div><div class="doc-club">CLUB NÁUTICO BARILOCHE</div>
        <div class="doc-sub">Comisión de Vela y Motor</div></div></header>
      <h1>LISTA DE LARGADA Y CONTROL DE SALIDA</h1>
      <div class="doc-evento"><strong>${U.esc(st.ev.nombre)}</strong><br>
        ${D.rangoFechas(st.ev.fecha_inicio, st.ev.fecha_fin)} · VHF canal ${U.esc(st.ev.canal_vhf || '71')}</div>
      ${st.evClases.map(c => {
        const l = conf.filter(i => i.clase_id === c.clase_id)
                      .sort((a, b) => String(a.num_vela).localeCompare(String(b.num_vela), 'es', { numeric: true }));
        if (!l.length) return '';
        return `<section class="sec"><h2>${U.esc(c.nombre)} — ${l.length} barcos</h2>
          <table><tr><th>Nº vela</th><th>Barco</th><th>Timonel</th><th>Tripulación</th>
          ${c.sistema !== 'monotipo' ? '<th>Rating</th><th>TCF</th>' : ''}
          <th>Salida</th><th>Regreso</th></tr>
          ${l.map(i => `<tr><td>${U.esc(i.num_vela)}</td><td>${U.esc(i.nombre_barco)}</td>
            <td>${U.esc(i.timonel_nombre)}</td>
            <td>${U.esc((i.tripulantes || []).map(t => t.nombre).join(', '))}</td>
            ${c.sistema !== 'monotipo' ? '<td>' + (i.rating ?? '—') + '</td><td>' +
              (i.rating != null ? S.tcfPhrf(i.rating, c.phrf_a, c.phrf_b).toFixed(4) : '—') + '</td>' : ''}
            <td style="width:60px"></td><td style="width:60px"></td></tr>`).join('')}
        </table></section>`;
      }).join('')}
      <section class="sec"><h2>Control</h2>
        <p>Oficial Principal de Regata: ${U.esc(st.ev.oficial_principal || '________________________')} ·
        Firma: ________________________</p>
        <p class="small">Todo barco debe registrar salida y regreso. El barco que se retira debe avisar
        al Comité de Regata por VHF canal ${U.esc(st.ev.canal_vhf || '71')} antes de dejar el área de regatas.</p>
      </section>
    </article>`;
    U.imprimir(html, 'Lista de largada — ' + st.ev.codigo);
  }

  // -------------------------------------------------- PRUEBAS Y RESULTADOS
  function tabPruebas() {
    const p = U.$('#panelEv');
    p.innerHTML = `<div class="card">
      <div class="row">
        <h2 class="mt0 mb0">Pruebas</h2>
        <div class="spacer"></div>
        <button class="btn sm" id="btnNuevaPrueba">+ Nueva prueba</button>
      </div>
      ${st.pruebas.length ? `<div class="tabla-wrap" style="margin-top:12px"><table class="t">
        <thead><tr><th class="num">Nº</th><th>Clase</th><th>Fecha</th><th>Largada</th><th>Recorrido</th>
          <th class="num">MN</th><th>Viento</th><th>Estado</th><th class="num">Llegadas</th><th></th></tr></thead>
        <tbody>${st.pruebas.map(x => {
          const cl = st.clases.find(c => c.id === x.clase_id);
          const n = st.resultados.filter(r => r.prueba_id === x.id).length;
          return `<tr>
            <td class="num"><strong>${x.numero}</strong></td>
            <td>${cl ? U.esc(cl.codigo) : '<span class="muted">todas</span>'}</td>
            <td>${x.fecha ? U.fechaCorta(x.fecha) : '—'}</td>
            <td>${U.hora(x.hora_largada)}</td>
            <td style="white-space:normal">${U.esc(x.recorrido || '—')}</td>
            <td class="num">${x.distancia_mn ?? '—'}</td>
            <td>${x.viento_dir || ''} ${x.viento_nudos ? x.viento_nudos + ' kt' : ''}</td>
            <td><span class="chip ${x.estado === 'valida' ? 'verde' : x.estado === 'anulada' ? 'rojo' : 'naranja'}">${x.estado}</span></td>
            <td class="num">${n}</td>
            <td class="right">
              <button class="btn sm" data-lleg="${x.id}">Cargar llegadas</button>
              <button class="btn ghost sm" data-pe="${x.id}">Editar</button>
              <button class="btn ghost sm" data-pd="${x.id}">✕</button>
            </td></tr>`;
        }).join('')}</tbody></table></div>`
        : '<p class="muted" style="margin-top:12px">Todavía no hay pruebas cargadas.</p>'}
    </div>
    <div id="clasif"></div>`;

    U.$('#btnNuevaPrueba').addEventListener('click', () => formPrueba(null));
    U.$$('[data-pe]', p).forEach(b => b.addEventListener('click', () => formPrueba(st.pruebas.find(x => x.id === b.dataset.pe))));
    U.$$('[data-pd]', p).forEach(b => b.addEventListener('click', async () => {
      if (await borrar('pruebas', b.dataset.pd, '¿Eliminar la prueba y todas sus llegadas?')) { await refrescarEvento(); tabPruebas(); }
    }));
    U.$$('[data-lleg]', p).forEach(b => b.addEventListener('click', () => cargarLlegadas(st.pruebas.find(x => x.id === b.dataset.lleg))));

    pintarClasificacion();
  }

  function formPrueba(x) {
    x = x || {};
    const html = `<div class="grid g3">
      <div class="field"><label>Número *</label><input type="number" id="p_numero" value="${x.numero ?? (st.pruebas.length + 1)}"></div>
      <div class="field"><label>Clase</label><select id="p_clase_id">
        <option value="">Todas las clases</option>
        ${st.evClases.map(c => `<option value="${c.clase_id}" ${x.clase_id === c.clase_id ? 'selected' : ''}>${U.esc(c.nombre)}</option>`).join('')}
      </select></div>
      <div class="field"><label>Estado</label><select id="p_estado">
        ${['programada','valida','anulada','no_corrida','postergada'].map(s =>
          `<option value="${s}" ${(x.estado || 'programada') === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select></div>
    </div>
    <div class="grid g3">
      <div class="field"><label>Fecha</label><input type="date" id="p_fecha" value="${U.esc(x.fecha || st.ev.fecha_inicio)}"></div>
      <div class="field"><label>Hora de largada</label><input type="time" step="1" id="p_hora_largada" value="${U.esc((x.hora_largada || '').slice(0,8))}"></div>
      <div class="field"><label>Distancia (MN)</label><input type="number" step="0.01" id="p_distancia_mn" value="${x.distancia_mn ?? ''}"></div>
    </div>
    <div class="field"><label>Recorrido</label><input id="p_recorrido" value="${U.esc(x.recorrido || '')}" placeholder="Barlovento-sotavento, 2 vueltas — L-1-2s-1-Ll"></div>
    <div class="grid g3">
      <div class="field"><label>Dirección del viento</label><input id="p_viento_dir" value="${U.esc(x.viento_dir || '')}" placeholder="O / SO"></div>
      <div class="field"><label>Intensidad (nudos)</label><input type="number" step="0.5" id="p_viento_nudos" value="${x.viento_nudos ?? ''}"></div>
      <div class="field"><label>Tiempo límite (min)</label><input type="number" id="p_tiempo_limite_min" value="${x.tiempo_limite_min ?? ''}"></div>
    </div>
    <div class="field"><label>Notas</label><textarea id="p_notas">${U.esc(x.notas || '')}</textarea></div>
    <p class="small muted">Sólo las pruebas en estado <strong>válida</strong> se computan en la clasificación general.</p>`;

    modal(x.id ? 'Editar prueba ' + x.numero : 'Nueva prueba', html, [
      { txt: 'Cancelar', cls: 'ghost' },
      { txt: 'Guardar', fn: async bg => {
        const g = id => U.$('#p_' + id, bg).value;
        const reg = {
          evento_id: st.ev.id, numero: +g('numero'), clase_id: g('clase_id') || null,
          fecha: g('fecha') || null, hora_largada: g('hora_largada') || null,
          distancia_mn: g('distancia_mn') === '' ? null : +g('distancia_mn'),
          recorrido: g('recorrido') || null, viento_dir: g('viento_dir') || null,
          viento_nudos: g('viento_nudos') === '' ? null : +g('viento_nudos'),
          tiempo_limite_min: g('tiempo_limite_min') === '' ? null : +g('tiempo_limite_min'),
          estado: g('estado'), notas: g('notas') || null
        };
        if (x.id) reg.id = x.id;
        await guardar('pruebas', reg);
        await refrescarEvento(); tabPruebas();
      } }
    ]);
  }

  function cargarLlegadas(pr) {
    const ins = st.insc.filter(i => i.estado === 'confirmada' && (!pr.clase_id || i.clase_id === pr.clase_id))
      .sort((a, b) => String(a.num_vela).localeCompare(String(b.num_vela), 'es', { numeric: true }));
    if (!ins.length) { alert('No hay inscripciones confirmadas para esta prueba.'); return; }
    const prev = new Map(st.resultados.filter(r => r.prueba_id === pr.id).map(r => [r.inscripcion_id, r]));

    const html = `
      <div class="row" style="margin-bottom:10px">
        <div class="field" style="margin:0"><label>Hora de largada de la prueba</label>
          <input type="time" step="1" id="l_largada" value="${U.esc((pr.hora_largada || '').slice(0,8))}"></div>
        <div class="field" style="margin:0"><label>Distancia (MN)</label>
          <input type="number" step="0.01" id="l_dist" value="${pr.distancia_mn ?? ''}"></div>
        <div class="spacer"></div>
        <div class="small muted" style="max-width:340px">Cargá la hora de llegada (hh:mm:ss). Si un barco largó
          con horario propio, completá su columna «Largada». El tiempo corregido se calcula solo.</div>
      </div>
      <div class="tabla-wrap"><table class="t">
        <thead><tr><th>Nº vela</th><th>Barco</th><th>Largada</th><th>Llegada</th><th>Código</th>
          <th class="num">Puntos manual</th><th>Notas</th></tr></thead>
        <tbody>${ins.map(i => {
          const r = prev.get(i.id) || {};
          return `<tr data-ins="${i.id}">
            <td class="mono">${U.esc(i.num_vela)}</td>
            <td>${U.esc(i.nombre_barco)}${i.rating != null ? ' <span class="chip small">R ' + i.rating + '</span>' : ''}</td>
            <td><input type="time" step="1" class="r-larg" value="${U.esc((r.hora_largada || '').slice(0,8))}" style="width:118px"></td>
            <td><input type="time" step="1" class="r-lleg" value="${U.esc((r.hora_llegada || '').slice(0,8))}" style="width:118px"></td>
            <td><select class="r-cod" style="width:112px">
              ${Object.keys(S.CODIGOS).map(k => `<option value="${k}" ${(r.codigo || 'OK') === k ? 'selected' : ''}>${k}</option>`).join('')}
            </select></td>
            <td class="num"><input type="number" step="0.1" class="r-pm" value="${r.puntos_manual ?? ''}" style="width:84px"></td>
            <td><input class="r-nt" value="${U.esc(r.notas || '')}" style="width:150px"></td>
          </tr>`;
        }).join('')}</tbody></table></div>
      <p class="small muted" style="margin-top:9px">Códigos: ${Object.keys(S.CODIGOS).map(k =>
        '<strong>' + k + '</strong> ' + S.CODIGOS[k].label.replace(/\s*\(.*\)/, '')).join(' · ')}.</p>`;

    modal('Prueba ' + pr.numero + ' — carga de llegadas', html, [
      { txt: 'Cancelar', cls: 'ghost' },
      { txt: 'Guardar y calcular', fn: async bg => {
        const largadaGral = U.$('#l_largada', bg).value;
        const dist = U.$('#l_dist', bg).value === '' ? null : +U.$('#l_dist', bg).value;
        await guardar('pruebas', { id: pr.id, hora_largada: largadaGral || null, distancia_mn: dist, estado: 'valida' });

        for (const tr of U.$$('tr[data-ins]', bg)) {
          const insId = tr.dataset.ins;
          const i = ins.find(x => x.id === insId);
          const ec = st.evClases.find(c => c.clase_id === i.clase_id) || { sistema: 'monotipo' };
          const larg = U.$('.r-larg', tr).value || largadaGral;
          const lleg = U.$('.r-lleg', tr).value;
          const cod  = U.$('.r-cod', tr).value;
          const pm   = U.$('.r-pm', tr).value;

          const tr_s = (larg && lleg) ? S.tiempoNavegado(larg, lleg) : null;
          const tc_s = tr_s !== null ? S.tiempoCorregido(tr_s, ec, i.rating, dist) : null;

          const existente = prev.get(insId);
          const reg = {
            prueba_id: pr.id, inscripcion_id: insId,
            hora_largada: U.$('.r-larg', tr).value || null,
            hora_llegada: lleg || null,
            tiempo_real_s: tr_s, tiempo_corregido_s: tc_s,
            codigo: cod, puntos_manual: pm === '' ? null : +pm,
            notas: U.$('.r-nt', tr).value || null
          };
          if (existente) reg.id = existente.id;
          if (!lleg && cod === 'OK' && !existente) continue;   // sin datos, no crear registro
          await guardar('resultados', reg);
        }
        await refrescarEvento(); tabPruebas();
      } }
    ]);
  }

  function pintarClasificacion() {
    const cont = U.$('#clasif');
    if (!cont) return;
    const validas = st.pruebas.filter(p => p.estado === 'valida');
    if (!validas.length) { cont.innerHTML = ''; return; }

    cont.innerHTML = st.evClases.map((ec, idx) => {
      const ins = st.insc.filter(i => i.estado === 'confirmada' && i.clase_id === ec.clase_id);
      if (!ins.length) return '';
      const pr = validas.filter(p => !p.clase_id || p.clase_id === ec.clase_id);
      const serie = S.calcularSerie({
        inscripciones: ins, pruebas: pr,
        resultados: st.resultados.filter(r => pr.some(x => x.id === r.prueba_id)),
        config: ec
      });
      const hand = ec.sistema !== 'monotipo';
      return `<div class="card">
        <div class="row">
          <h2 class="mt0 mb0">Clasificación — ${U.esc(ec.nombre)}</h2>
          <span class="chip azul">${U.esc(D.nombreSistema(ec.sistema))}</span>
          <span class="chip">${serie.nValidas} válidas · ${serie.descartes} descarte(s)</span>
          <div class="spacer"></div>
          <button class="btn sec sm" data-csv="${idx}">↓ CSV</button>
          <button class="btn sec sm" data-imp="${idx}">Imprimir</button>
        </div>
        <div class="tabla-wrap" style="margin-top:11px"><table class="t">
          <thead><tr><th class="num">Pos</th><th>Nº vela</th><th>Barco</th><th>Timonel</th>
            ${hand ? '<th class="num">Rating</th><th class="num">TCF</th>' : ''}
            ${serie.pruebas.map(p => '<th class="num">R' + p.numero + '</th>').join('')}
            <th class="num">Total</th></tr></thead>
          <tbody>${serie.filas.map(f => `<tr class="${f.posicion <= 3 ? 'podio' + f.posicion : ''}">
            <td class="num"><strong>${f.posicion}</strong></td>
            <td class="mono">${U.esc(f.inscripcion.num_vela)}</td>
            <td>${U.esc(f.inscripcion.nombre_barco)}</td>
            <td>${U.esc(f.inscripcion.timonel_nombre)}</td>
            ${hand ? '<td class="num">' + (f.inscripcion.rating ?? '—') + '</td><td class="num">' +
              (f.inscripcion.rating != null ? S.tcfPhrf(f.inscripcion.rating, ec.phrf_a, ec.phrf_b).toFixed(4) : '—') + '</td>' : ''}
            ${f.pruebas.map(x => `<td class="num ${x.descartado ? 'desc' : ''}">${x.descartado ? '(' : ''}${x.codigo !== 'OK' ? x.codigo + ' ' : ''}${x.puntos}${x.descartado ? ')' : ''}</td>`).join('')}
            <td class="num"><strong>${f.total}</strong></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
    }).join('');

    const series = i => {
      const ec = st.evClases[i];
      const ins = st.insc.filter(x => x.estado === 'confirmada' && x.clase_id === ec.clase_id);
      const pr = validas.filter(p => !p.clase_id || p.clase_id === ec.clase_id);
      return { ec, serie: S.calcularSerie({ inscripciones: ins, pruebas: pr,
        resultados: st.resultados.filter(r => pr.some(x => x.id === r.prueba_id)), config: ec }) };
    };
    U.$$('[data-csv]', cont).forEach(b => b.addEventListener('click', () => {
      const { ec, serie } = series(+b.dataset.csv);
      U.descargar('resultados-' + st.ev.codigo + '-' + (ec.codigo || '') + '.csv',
        S.serieACSV(serie, st.ev.nombre + ' — ' + ec.nombre), 'text/csv');
    }));
    U.$$('[data-imp]', cont).forEach(b => b.addEventListener('click', () => {
      const { ec, serie } = series(+b.dataset.imp);
      U.imprimir(`<article class="doc-regata">
        <header class="doc-head"><div><div class="doc-club">CLUB NÁUTICO BARILOCHE</div>
          <div class="doc-sub">Comisión de Vela y Motor</div></div></header>
        <h1>RESULTADOS OFICIALES</h1>
        <div class="doc-evento"><strong>${U.esc(st.ev.nombre)}</strong><br>${U.esc(ec.nombre)}<br>
          ${D.rangoFechas(st.ev.fecha_inicio, st.ev.fecha_fin)}</div>
        <table><tr><th>Pos</th><th>Nº vela</th><th>Barco</th><th>Timonel</th><th>Club</th>
          ${serie.pruebas.map(p => '<th>R' + p.numero + '</th>').join('')}<th>Total</th></tr>
          ${serie.filas.map(f => `<tr><td>${f.posicion}</td><td>${U.esc(f.inscripcion.num_vela)}</td>
            <td>${U.esc(f.inscripcion.nombre_barco)}</td><td>${U.esc(f.inscripcion.timonel_nombre)}</td>
            <td>${U.esc(f.inscripcion.club || '')}</td>
            ${f.pruebas.map(x => '<td>' + (x.descartado ? '(' : '') + (x.codigo !== 'OK' ? x.codigo + ' ' : '') + x.puntos + (x.descartado ? ')' : '') + '</td>').join('')}
            <td><strong>${f.total}</strong></td></tr>`).join('')}
        </table>
        <p class="small">Sistema de Puntuación Baja, Apéndice A del RRV ${D.RRV_CICLO}. ${serie.nSerie} inscriptos ·
          ${serie.nValidas} pruebas válidas · ${serie.descartes} descarte(s). Entre paréntesis, puntaje descartado.</p>
        <p>Oficial Principal de Regata: ${U.esc(st.ev.oficial_principal || '________________')} —
          Firma: ________________  Fecha: ${new Date().toLocaleDateString('es-AR')}</p>
      </article>`, 'Resultados — ' + ec.nombre);
    }));
  }

  // ------------------------------------------------------------- ORGANIZACIÓN
  const PLANTILLA_TAREAS = [
    ['Previa (D-30)', 'Definir fecha, clases participantes y sistema de puntaje', 30],
    ['Previa (D-30)', 'Redactar y publicar el Aviso de Regata', 30],
    ['Previa (D-30)', 'Designar Oficial Principal de Regata, Comité de Regata y Comité de Protestas', 28],
    ['Previa (D-30)', 'Abrir la inscripción en línea y difundir el link/QR', 25],
    ['Difusión (D-21)', 'Publicar en redes del Club y grupos de clase', 21],
    ['Difusión (D-21)', 'Invitar formalmente a clubes de la región y a la FAY si corresponde', 21],
    ['Difusión (D-21)', 'Gestionar cobertura de prensa local y contenidos para promoción turística', 18],
    ['Logística (D-14)', 'Confirmar embarcaciones de apoyo, patrones y combustible', 14],
    ['Logística (D-14)', 'Verificar boyas, fondeos, banderas de señales, bocina y cronómetros', 14],
    ['Logística (D-14)', 'Reservar sectores de armado y guardería para barcos visitantes', 14],
    ['Logística (D-14)', 'Coordinar Prefectura Naval y aviso de actividad en el área', 12],
    ['Logística (D-7)', 'Publicar las Instrucciones de Regata y el diagrama de recorridos', 7],
    ['Logística (D-7)', 'Cerrar inscripciones, verificar seguros y licencias, armar lista de largada', 5],
    ['Logística (D-7)', 'Confirmar catering, premios y sonido para la entrega', 5],
    ['Agua (D-0)', 'Chequeo de VHF en todas las embarcaciones oficiales y de apoyo', 0],
    ['Agua (D-0)', 'Fondear el campo de regata y tomar rumbo y presión del viento', 0],
    ['Agua (D-0)', 'Control de salida y regreso de cada barco', 0],
    ['Tierra (D-0)', 'Reunión de timoneles y entrega de documentación', 0],
    ['Tierra (D-0)', 'Tablero Oficial de Avisos operativo (físico y digital)', 0],
    ['Cierre', 'Cargar llegadas, publicar resultados provisorios y abrir plazo de protestas', 0],
    ['Cierre', 'Resolver protestas y publicar resultados definitivos', 0],
    ['Cierre', 'Entrega de premios y agradecimiento a auspiciantes', 0],
    ['Cierre', 'Cargar fotos, informe del evento y lecciones aprendidas para la próxima edición', 0]
  ];

  async function tabOrg() {
    const p = U.$('#panelEv');
    const { data } = await db.from('tareas_evento').select('*').eq('evento_id', st.ev.id).order('orden').order('created_at');
    const tareas = data || [];
    const bloques = [...new Set(tareas.map(t => t.bloque))];
    const hechas = tareas.filter(t => t.hecho).length;

    p.innerHTML = `<div class="card">
      <div class="row">
        <h2 class="mt0 mb0">Checklist organizativo</h2>
        ${tareas.length ? `<span class="chip ${hechas === tareas.length ? 'verde' : 'naranja'}">${hechas}/${tareas.length} completadas</span>` : ''}
        <div class="spacer"></div>
        ${!tareas.length ? '<button class="btn sm" id="btnPlantilla">Cargar checklist estándar de regata</button>' : ''}
        <button class="btn sec sm" id="btnAddTarea">+ Tarea</button>
      </div>
      ${tareas.length ? bloques.map(b => `<h3 style="margin:16px 0 7px">${U.esc(b)}</h3>
        <div class="tabla-wrap"><table class="t"><tbody>
          ${tareas.filter(t => t.bloque === b).map(t => `<tr>
            <td style="width:34px"><input type="checkbox" data-ch="${t.id}" ${t.hecho ? 'checked' : ''}></td>
            <td style="white-space:normal" class="${t.hecho ? 'muted' : ''}">${U.esc(t.descripcion)}</td>
            <td style="width:170px"><input data-resp="${t.id}" value="${U.esc(t.responsable || '')}" placeholder="responsable"></td>
            <td style="width:150px"><input type="date" data-vence="${t.id}" value="${U.esc(t.vence || '')}"></td>
            <td class="right" style="width:44px"><button class="btn ghost sm" data-tdel="${t.id}">✕</button></td>
          </tr>`).join('')}
        </tbody></table></div>`).join('')
        : '<p class="muted" style="margin-top:12px">Sin tareas. Cargá el checklist estándar y ajustalo al evento.</p>'}
    </div>`;

    const bp = U.$('#btnPlantilla');
    if (bp) bp.addEventListener('click', async () => {
      const base = U.fecha(st.ev.fecha_inicio);
      const filas = PLANTILLA_TAREAS.map((t, i) => {
        const d = new Date(base); d.setDate(d.getDate() - t[2]);
        return { evento_id: st.ev.id, bloque: t[0], descripcion: t[1], orden: i,
                 vence: d.toISOString().slice(0, 10) };
      });
      const { error } = await db.from('tareas_evento').insert(filas);
      if (error) alert(U.err(error));
      tabOrg();
    });

    U.$('#btnAddTarea').addEventListener('click', () => {
      modal('Nueva tarea', `
        <div class="field"><label>Bloque</label><input id="t_bloque" value="General"></div>
        <div class="field"><label>Descripción</label><input id="t_desc"></div>
        <div class="grid g2">
          <div class="field"><label>Responsable</label><input id="t_resp"></div>
          <div class="field"><label>Vence</label><input type="date" id="t_vence"></div>
        </div>`, [
        { txt: 'Cancelar', cls: 'ghost' },
        { txt: 'Agregar', fn: async bg => {
          const d = U.$('#t_desc', bg).value.trim();
          if (!d) return false;
          await guardar('tareas_evento', { evento_id: st.ev.id, bloque: U.$('#t_bloque', bg).value.trim() || 'General',
            descripcion: d, responsable: U.$('#t_resp', bg).value.trim() || null,
            vence: U.$('#t_vence', bg).value || null, orden: 999 });
          tabOrg();
        } }]);
    });

    U.$$('[data-ch]', p).forEach(c => c.addEventListener('change', async () => {
      await guardar('tareas_evento', { id: c.dataset.ch, hecho: c.checked }); tabOrg();
    }));
    U.$$('[data-resp]', p).forEach(i => i.addEventListener('change', () =>
      guardar('tareas_evento', { id: i.dataset.resp, responsable: i.value || null })));
    U.$$('[data-vence]', p).forEach(i => i.addEventListener('change', () =>
      guardar('tareas_evento', { id: i.dataset.vence, vence: i.value || null })));
    U.$$('[data-tdel]', p).forEach(b => b.addEventListener('click', async () => {
      if (await borrar('tareas_evento', b.dataset.tdel, '¿Eliminar la tarea?')) tabOrg();
    }));
  }

  // ----------------------------------------------------------------- DIFUSIÓN
  function tabDifusion() {
    const p = U.$('#panelEv');
    const base = location.origin + location.pathname.replace(/admin\.html$/, '');
    const linkInsc = base + 'inscripcion.html?evento=' + st.ev.id;
    const linkEv   = base + 'index.html?evento=' + st.ev.id;

    const clases = st.evClases.map(c => c.nombre).join(', ') || 'todas las clases';
    const texto =
`⛵ ${st.ev.nombre.toUpperCase()}
${D.rangoFechas(st.ev.fecha_inicio, st.ev.fecha_fin)} · Club Náutico Bariloche — Lago Nahuel Huapi

Clases: ${clases}
${st.ev.hora_briefing ? 'Reunión de timoneles: ' + U.hora(st.ev.hora_briefing) + ' h\n' : ''}${st.ev.hora_senal_atencion ? 'Primera señal de atención: ' + U.hora(st.ev.hora_senal_atencion) + ' h\n' : ''}${st.ev.area_regata ? 'Área de regatas: ' + st.ev.area_regata + '\n' : ''}
Inscripción en línea: ${linkInsc}
Aviso de Regata y resultados: ${linkEv}
${st.ev.contacto_nombre ? '\nConsultas: ' + st.ev.contacto_nombre + (st.ev.contacto_tel ? ' · ' + st.ev.contacto_tel : '') : ''}

Organiza: Comisión de Vela y Motor del CNB. Regata conforme al RRV ${D.RRV_CICLO} de World Sailing y las prescripciones de la FAY.`;

    p.innerHTML = `<div class="grid g2">
      <div class="card">
        <h2 class="mt0">Enlaces del evento</h2>
        <div class="field"><label>Formulario de inscripción (público)</label>
          <input id="lnk1" value="${U.esc(linkInsc)}" readonly></div>
        <div class="field"><label>Ficha pública del evento</label>
          <input id="lnk2" value="${U.esc(linkEv)}" readonly></div>
        <div class="row"><button class="btn sec sm" id="cp1">Copiar link de inscripción</button>
          <button class="btn sec sm" id="cp2">Copiar link del evento</button></div>
        <h3>Código QR de inscripción</h3>
        <div id="qr" style="display:inline-block;padding:11px;background:#fff;border:1px solid var(--gris-300);border-radius:8px"></div>
        <div class="row" style="margin-top:9px"><button class="btn sec sm" id="btnQRimp">Imprimir cartel con QR</button></div>
      </div>
      <div class="card">
        <h2 class="mt0">Texto para difusión (WhatsApp / redes)</h2>
        <textarea id="txtDif" style="min-height:330px">${U.esc(texto)}</textarea>
        <div class="row end" style="margin-top:9px"><button class="btn sec sm" id="cpTxt">Copiar texto</button></div>
      </div>
    </div>`;

    const copiar = (sel, btn) => U.$(btn).addEventListener('click', () => {
      U.$(sel).select(); document.execCommand('copy');
      U.$(btn).textContent = '✓ Copiado';
      setTimeout(() => { U.$(btn).textContent = U.$(btn).dataset.t; }, 1600);
    });
    ['cp1', 'cp2', 'cpTxt'].forEach(id => U.$('#' + id).dataset.t = U.$('#' + id).textContent);
    copiar('#lnk1', '#cp1'); copiar('#lnk2', '#cp2'); copiar('#txtDif', '#cpTxt');

    if (window.QRCode) {
      new QRCode(U.$('#qr'), { text: linkInsc, width: 190, height: 190, correctLevel: QRCode.CorrectLevel.M });
    } else {
      U.$('#qr').innerHTML = '<span class="muted small">No se pudo cargar el generador de QR.</span>';
    }

    U.$('#btnQRimp').addEventListener('click', () => {
      const img = U.$('#qr canvas') ? U.$('#qr canvas').toDataURL() : (U.$('#qr img') || {}).src;
      U.imprimir(`<article class="doc-regata" style="text-align:center">
        <header class="doc-head" style="justify-content:center"><div>
          <div class="doc-club">CLUB NÁUTICO BARILOCHE</div>
          <div class="doc-sub">Comisión de Vela y Motor</div></div></header>
        <h1 style="font-size:26px">${U.esc(st.ev.nombre)}</h1>
        <p style="text-align:center;font-size:16px">${D.rangoFechas(st.ev.fecha_inicio, st.ev.fecha_fin)}<br>
          ${U.esc(st.ev.area_regata || st.ev.sede || '')}</p>
        <p style="text-align:center;font-size:18px;font-weight:700;margin-top:24px">INSCRIBITE ACÁ</p>
        ${img ? '<img src="' + img + '" style="width:270px;height:270px">' : ''}
        <p style="text-align:center;font-size:12px">${U.esc(linkInsc)}</p>
        <p style="text-align:center">Clases: ${U.esc(clases)}</p>
      </article>`, 'QR — ' + st.ev.codigo);
    });
  }

  // =========================================================================
  // CONFIGURACIÓN
  // =========================================================================
  function pintarTabCfg() {
    ({ temporadas: cfgTemporadas, clases: cfgClases, usuarios: cfgUsuarios })[st.tabCfg]();
  }

  async function cfgTemporadas() {
    await recargarCatalogos();
    U.$('#panelCfg').innerHTML = `<div class="card">
      <div class="row"><h2 class="mt0 mb0">Temporadas</h2><div class="spacer"></div>
        <button class="btn sm" id="btnNT">+ Nueva temporada</button></div>
      <div class="tabla-wrap" style="margin-top:12px"><table class="t">
        <thead><tr><th>Nombre</th><th>Inicio</th><th>Fin</th><th>Activa</th><th></th></tr></thead>
        <tbody>${st.temporadas.map(t => `<tr>
          <td><strong>${U.esc(t.nombre)}</strong></td><td>${U.fechaCorta(t.fecha_inicio)}</td>
          <td>${U.fechaCorta(t.fecha_fin)}</td>
          <td>${t.activa ? '<span class="chip verde">Activa</span>' : '<button class="btn ghost sm" data-act="' + t.id + '">Activar</button>'}</td>
          <td class="right"><button class="btn ghost sm" data-tdel="${t.id}">✕</button></td></tr>`).join('')}
        </tbody></table></div></div>`;

    U.$('#btnNT').addEventListener('click', () => modal('Nueva temporada', `
      <div class="field"><label>Nombre</label><input id="tn" placeholder="2027-2028"></div>
      <div class="grid g2">
        <div class="field"><label>Inicio</label><input type="date" id="ti"></div>
        <div class="field"><label>Fin</label><input type="date" id="tf"></div>
      </div>`, [{ txt: 'Cancelar', cls: 'ghost' }, { txt: 'Crear', fn: async bg => {
        await guardar('temporadas', { nombre: U.$('#tn', bg).value.trim(),
          fecha_inicio: U.$('#ti', bg).value, fecha_fin: U.$('#tf', bg).value });
        cfgTemporadas();
      } }]));

    U.$$('[data-act]').forEach(b => b.addEventListener('click', async () => {
      for (const t of st.temporadas) await guardar('temporadas', { id: t.id, activa: t.id === b.dataset.act });
      cfgTemporadas();
    }));
    U.$$('[data-tdel]').forEach(b => b.addEventListener('click', async () => {
      if (await borrar('temporadas', b.dataset.tdel, '¿Eliminar la temporada? Sólo se puede si no tiene eventos.')) cfgTemporadas();
    }));
  }

  async function cfgClases() {
    await recargarCatalogos();
    U.$('#panelCfg').innerHTML = `<div class="card">
      <div class="row"><h2 class="mt0 mb0">Clases</h2><div class="spacer"></div>
        <button class="btn sm" id="btnNC">+ Nueva clase</button></div>
      <div class="tabla-wrap" style="margin-top:12px"><table class="t">
        <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Categoría</th>
          <th class="num">Tripulación</th><th class="num">Orden</th><th>Activa</th><th></th></tr></thead>
        <tbody>${st.clases.map(c => `<tr>
          <td class="mono">${U.esc(c.codigo)}</td><td>${U.esc(c.nombre)}</td>
          <td>${c.tipo === 'handicap' ? '<span class="chip naranja">Handicap</span>' : '<span class="chip azul">Monotipo</span>'}</td>
          <td>${U.esc(c.categoria || '')}</td><td class="num">${c.tripulacion ?? ''}</td>
          <td class="num">${c.orden}</td>
          <td><input type="checkbox" data-ca="${c.id}" ${c.activa ? 'checked' : ''}></td>
          <td class="right"><button class="btn ghost sm" data-cdel="${c.id}">✕</button></td></tr>`).join('')}
        </tbody></table></div></div>`;

    U.$('#btnNC').addEventListener('click', () => modal('Nueva clase', `
      <div class="grid g2">
        <div class="field"><label>Código</label><input id="cc" placeholder="CRU-C"></div>
        <div class="field"><label>Nombre</label><input id="cn" placeholder="Crucero C (PHRF)"></div>
      </div>
      <div class="grid g4">
        <div class="field"><label>Tipo</label><select id="ct">
          <option value="monotipo">Monotipo</option><option value="handicap">Handicap</option></select></div>
        <div class="field"><label>Categoría</label><input id="cg" placeholder="Crucero"></div>
        <div class="field"><label>Tripulación</label><input type="number" id="cr" value="1"></div>
        <div class="field"><label>Orden</label><input type="number" id="co" value="100"></div>
      </div>`, [{ txt: 'Cancelar', cls: 'ghost' }, { txt: 'Crear', fn: async bg => {
        await guardar('clases', { codigo: U.$('#cc', bg).value.trim().toUpperCase(),
          nombre: U.$('#cn', bg).value.trim(), tipo: U.$('#ct', bg).value,
          categoria: U.$('#cg', bg).value.trim() || null, tripulacion: +U.$('#cr', bg).value,
          orden: +U.$('#co', bg).value });
        cfgClases();
      } }]));

    U.$$('[data-ca]').forEach(c => c.addEventListener('change', () =>
      guardar('clases', { id: c.dataset.ca, activa: c.checked })));
    U.$$('[data-cdel]').forEach(b => b.addEventListener('click', async () => {
      if (await borrar('clases', b.dataset.cdel, '¿Eliminar la clase?')) cfgClases();
    }));
  }

  async function cfgUsuarios() {
    const { data, error } = await db.from('usuarios_autorizados').select('*').order('nombre');
    if (error) { U.$('#panelCfg').innerHTML = '<div class="alert error">' + U.esc(U.err(error)) + '</div>'; return; }
    const es = st.rol === 'admin';
    U.$('#panelCfg').innerHTML = `<div class="card">
      <div class="row"><h2 class="mt0 mb0">Usuarios habilitados</h2><div class="spacer"></div>
        ${es ? '<button class="btn sm" id="btnNU">+ Habilitar usuario</button>' : '<span class="chip">Sólo lectura — se requiere rol admin</span>'}</div>
      <div class="tabla-wrap" style="margin-top:12px"><table class="t">
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Activo</th><th></th></tr></thead>
        <tbody>${(data || []).map(u => `<tr>
          <td>${U.esc(u.nombre)}</td><td class="mono small">${U.esc(u.email)}</td>
          <td><span class="chip ${u.rol === 'admin' ? 'naranja' : 'azul'}">${u.rol}</span></td>
          <td>${es ? `<input type="checkbox" data-ua="${u.id}" ${u.activo ? 'checked' : ''}>` : (u.activo ? 'Sí' : 'No')}</td>
          <td class="right">${es ? `<button class="btn ghost sm" data-udel="${u.id}">✕</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
      <p class="small muted" style="margin-top:11px">Roles: <strong>admin</strong> administra usuarios ·
        <strong>comisión</strong> ABM de eventos y resultados · <strong>oficial</strong> carga de llegadas ·
        <strong>secretaria</strong> inscripciones y cobros.</p></div>`;

    if (!es) return;
    U.$('#btnNU').addEventListener('click', () => modal('Habilitar usuario', `
      <div class="field"><label>Nombre</label><input id="un"></div>
      <div class="field"><label>Email</label><input id="ue" type="email"></div>
      <div class="field"><label>Rol</label><select id="ur">
        <option value="comision">Comisión</option><option value="oficial">Oficial de regata</option>
        <option value="secretaria">Secretaría</option><option value="admin">Administrador</option>
      </select></div>`, [{ txt: 'Cancelar', cls: 'ghost' }, { txt: 'Habilitar', fn: async bg => {
        await guardar('usuarios_autorizados', { nombre: U.$('#un', bg).value.trim(),
          email: U.$('#ue', bg).value.trim().toLowerCase(), rol: U.$('#ur', bg).value });
        cfgUsuarios();
      } }]));
    U.$$('[data-ua]').forEach(c => c.addEventListener('change', () =>
      guardar('usuarios_autorizados', { id: c.dataset.ua, activo: c.checked })));
    U.$$('[data-udel]').forEach(b => b.addEventListener('click', async () => {
      if (await borrar('usuarios_autorizados', b.dataset.udel, '¿Quitar el acceso de este usuario?')) cfgUsuarios();
    }));
  }
})();
