/* ============================================================================
 * mi-inscripcion.js — Autoservicio del timonel: consulta y edición de SU
 * PROPIA inscripción, autenticado por magic link (no requiere estar en
 * usuarios_autorizados). RLS (insc_select_propio / insc_update_propio en
 * supabase/schema.sql) garantiza que sólo ve y edita filas cuyo timonel_email
 * coincide con su sesión, y sólo mientras el estado sea 'pendiente'.
 * ==========================================================================*/
(function () {
  'use strict';
  const MAX_ARCHIVO = 10 * 1024 * 1024; // 10 MB, igual al límite del bucket 'inscripciones-docs'
  const RATING_ORIGENES = { CIC: 'Listado del CIC', CNB: 'Asignado por el CNB',
    FAY: 'Certificado FAY', ORC: 'Certificado ORC', provisorio: 'Provisorio / a definir' };
  let misInsc = [];

  document.addEventListener('DOMContentLoaded', async () => {
    U.$('#btnLogin').addEventListener('click', login);
    U.$('#email').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
    db.auth.onAuthStateChange((_e, s) => { if (s) mostrarSesion(); });
    const { data } = await db.auth.getSession();
    if (data && data.session) mostrarSesion();
  });

  async function login() {
    const email = U.$('#email').value.trim().toLowerCase();
    if (!email) return;
    U.aviso('#loginAviso', 'info', 'Enviando enlace…');
    const { error } = await db.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname }
    });
    U.aviso('#loginAviso', error ? 'error' : 'ok',
      error ? U.esc(U.err(error))
            : 'Enlace enviado a <strong>' + U.esc(email) + '</strong>. Revisá tu correo (y la carpeta de spam).');
  }

  async function mostrarSesion() {
    U.$('#login').style.display = 'none';
    U.$('#lista').style.display = '';
    U.$('#btnSalir').addEventListener('click', async () => { await db.auth.signOut(); location.reload(); });
    await cargarLista();
  }

  async function cargarLista() {
    U.$('#detalle').style.display = 'none';
    U.$('#lista').style.display = '';
    const cont = U.$('#listaCont');
    cont.innerHTML = '<div class="card muted">Cargando…</div>';
    const { data, error } = await db.from('inscripciones')
      .select('*, eventos(nombre,fecha_inicio,fecha_fin,sede), clases(nombre,tipo)')
      .order('created_at', { ascending: false });
    if (error) { cont.innerHTML = '<div class="alert error">' + U.esc(U.err(error)) + '</div>'; return; }
    misInsc = data || [];
    if (!misInsc.length) {
      cont.innerHTML = '<div class="card center muted">No encontramos inscripciones asociadas a este correo.<br>' +
        'Si te inscribiste con otro email, cerrá sesión y volvé a entrar con ese.</div>';
      return;
    }
    cont.innerHTML = misInsc.map(i => {
      const ee = U.ESTADOS_INSC[i.estado] || {};
      const ev = i.eventos || {};
      return `<div class="card row" style="margin-bottom:10px;cursor:pointer" data-open="${i.id}">
        <div style="flex:1;min-width:200px">
          <strong>${U.esc(i.nombre_barco)}</strong> · ${U.esc((i.clases || {}).nombre || '')}<br>
          <span class="small muted">${U.esc(ev.nombre || '')}${ev.fecha_inicio ? ' · ' + U.fechaCorta(ev.fecha_inicio) : ''} · Folio ${U.esc(i.folio || '—')}</span>
        </div>
        <span class="chip ${ee.chip || ''}">${ee.txt || i.estado}</span>
        <span class="chip ${i.pago_estado === 'pagado' ? 'verde' : i.pago_estado === 'exento' ? 'azul' : 'naranja'}">${i.pago_estado}</span>
      </div>`;
    }).join('');
    U.$$('[data-open]', cont).forEach(el => el.addEventListener('click', () => abrirDetalle(el.dataset.open)));
  }

  // ---------------------------------------------------------------- DETALLE
  let nTrip = 0;
  function filaTripulante(v, editable) {
    v = v || {};
    const i = ++nTrip;
    const div = document.createElement('div');
    div.className = 'trip grid g4';
    div.style.cssText = 'align-items:end;padding:9px;border:1px solid var(--gris-300);border-radius:8px;margin-bottom:9px';
    div.innerHTML = `
      <div class="field" style="margin:0"><label>Apellido y nombre</label>
        <input type="text" class="t-nombre" maxlength="80" value="${U.esc(v.nombre || '')}" ${editable ? '' : 'disabled'}></div>
      <div class="field" style="margin:0"><label>DNI</label>
        <input type="text" class="t-dni" maxlength="20" value="${U.esc(v.dni || '')}" ${editable ? '' : 'disabled'}></div>
      <div class="field" style="margin:0"><label>Nacimiento</label>
        <input type="date" class="t-nac" value="${U.esc(v.nacimiento || '')}" ${editable ? '' : 'disabled'}></div>
      <div class="field" style="margin:0;display:flex;gap:7px;align-items:end">
        <div style="flex:1"><label>Licencia FAY</label>
          <input type="text" class="t-lic" maxlength="30" value="${U.esc(v.licencia || '')}" ${editable ? '' : 'disabled'}></div>
        ${editable ? '<button type="button" class="btn ghost sm" title="Quitar">✕</button>' : ''}
      </div>`;
    if (editable) div.querySelector('button').addEventListener('click', () => div.remove());
    U.$('#tripulantes').appendChild(div);
  }

  function leerTripulantes() {
    return U.$$('#tripulantes .trip').map(d => ({
      nombre: d.querySelector('.t-nombre').value.trim(),
      dni: d.querySelector('.t-dni').value.trim(),
      nacimiento: d.querySelector('.t-nac').value || null,
      licencia: d.querySelector('.t-lic').value.trim()
    })).filter(t => t.nombre);
  }

  async function verDoc(path) {
    const { data, error } = await db.storage.from('inscripciones-docs').createSignedUrl(path, 120);
    if (error) { alert('No se pudo abrir el archivo: ' + U.err(error)); return; }
    window.open(data.signedUrl, '_blank');
  }

  async function subirDoc(inscripcionId, campo, nombreBase, file) {
    if (file.size > MAX_ARCHIVO) { alert('El archivo pesa más de 10 MB.'); return null; }
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = inscripcionId + '/' + nombreBase + '.' + ext;
    const { error: eUp } = await db.storage.from('inscripciones-docs')
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (eUp) { alert('No se pudo subir el archivo: ' + U.err(eUp)); return null; }
    const { error: eDb } = await db.from('inscripciones').update({ [campo]: path }).eq('id', inscripcionId);
    if (eDb) { alert('El archivo se subió pero no se pudo asociar: ' + U.err(eDb)); return null; }
    return path;
  }

  function docBlock(i, campo, nombre, editable) {
    return `<div class="doc-adjunto">
      <span class="txt">${i[campo] ? '<span class="chip verde">Sí</span>' : '<span class="chip rojo">Falta</span>'}</span>
      ${i[campo] ? `<button type="button" class="btn ghost sm" data-ver="${campo}">Ver</button>` : ''}
      ${editable ? `<input type="file" accept="application/pdf,image/*" data-subir="${campo}" data-nombre="${nombre}" style="width:auto;flex:1;min-width:180px">` : ''}
    </div>`;
  }

  function abrirDetalle(id) {
    const i = misInsc.find(x => x.id === id);
    if (!i) return;
    const editable = i.estado === 'pendiente';
    const cl = i.clases || {};
    const ev = i.eventos || {};
    const ee = U.ESTADOS_INSC[i.estado] || {};
    nTrip = 0;

    U.$('#lista').style.display = 'none';
    const d = U.$('#detalle');
    d.style.display = '';
    d.innerHTML = `
      <button type="button" class="btn ghost sm" id="btnVolver" style="margin-bottom:12px">&larr; Tus inscripciones</button>
      <div class="card">
        <div class="row">
          <h2 class="mt0 mb0">${U.esc(i.nombre_barco)}</h2>
          <span class="chip ${ee.chip || ''}">${ee.txt || i.estado}</span>
          <span class="chip ${i.pago_estado === 'pagado' ? 'verde' : i.pago_estado === 'exento' ? 'azul' : 'naranja'}">${i.pago_estado}</span>
        </div>
        <p class="small muted" style="margin:6px 0 0">
          ${U.esc(ev.nombre || '')} ${ev.fecha_inicio ? '· ' + U.rango(ev.fecha_inicio, ev.fecha_fin) : ''}
          · Folio <strong>${U.esc(i.folio || '—')}</strong> · Clase ${U.esc(cl.nombre || '')}
        </p>
        ${!editable ? `<div class="alert info" style="margin-top:12px">
            Esta inscripción ya fue revisada por la Comisión y no se puede editar desde acá.
            ${i.estado === 'rechazada' && i.motivo_rechazo ? '<br><strong>Motivo de rechazo:</strong> ' + U.esc(i.motivo_rechazo) : ''}
            Si necesitás corregir algo, escribile a la Comisión de Vela y Motor.
          </div>` : `<div class="alert ok" style="margin-top:12px">
            Podés corregir tus datos mientras la inscripción siga pendiente de revisión.
          </div>`}
      </div>

      <form id="frmMi">
        <fieldset>
          <legend>Embarcación</legend>
          <div class="grid g2">
            <div class="field"><label>Nombre del barco</label>
              <input id="m_nombre_barco" value="${U.esc(i.nombre_barco || '')}" ${editable ? '' : 'disabled'}></div>
            <div class="field"><label>Número de vela</label>
              <input id="m_num_vela" value="${U.esc(i.num_vela || '')}" ${editable ? '' : 'disabled'}></div>
          </div>
          <div class="grid g2">
            <div class="field"><label>Modelo / astillero</label>
              <input id="m_modelo" value="${U.esc(i.modelo || '')}" ${editable ? '' : 'disabled'}></div>
            <div class="field"><label>Club</label>
              <input id="m_club" value="${U.esc(i.club || '')}" ${editable ? '' : 'disabled'}></div>
          </div>
          ${cl.tipo === 'handicap' ? `<div class="grid g3">
            <div class="field"><label>Rating PHRF (s/MN)</label>
              <input type="number" step="0.1" id="m_rating" value="${i.rating ?? ''}" ${editable ? '' : 'disabled'}>
              <div class="hint">Se toma el rating publicado en el listado del CIC.</div></div>
            <div class="field"><label>Origen del rating</label>
              <select id="m_rating_origen" ${editable ? '' : 'disabled'}>
                <option value="">— seleccionar —</option>
                ${Object.entries(RATING_ORIGENES).map(([o, txt]) => `<option value="${o}" ${i.rating_origen === o ? 'selected' : ''}>${txt}</option>`).join('')}
              </select></div>
            <div class="field"><label>Matrícula REY</label>
              <input id="m_matricula_rey" value="${U.esc(i.matricula_rey || '')}" ${editable ? '' : 'disabled'}></div>
          </div>` : ''}
          <div class="field"><label>Código de flota CNB</label>
            <input id="m_codigo_flota" value="${U.esc(i.codigo_flota || '')}" ${editable ? '' : 'disabled'}></div>
        </fieldset>

        <fieldset>
          <legend>Timonel</legend>
          <div class="grid g2">
            <div class="field"><label>Apellido y nombre</label>
              <input id="m_timonel_nombre" value="${U.esc(i.timonel_nombre || '')}" ${editable ? '' : 'disabled'}></div>
            <div class="field"><label>DNI / Pasaporte</label>
              <input id="m_timonel_dni" value="${U.esc(i.timonel_dni || '')}" ${editable ? '' : 'disabled'}></div>
          </div>
          <div class="grid g2">
            <div class="field"><label>Fecha de nacimiento</label>
              <input type="date" id="m_timonel_nacimiento" value="${U.esc(i.timonel_nacimiento || '')}" ${editable ? '' : 'disabled'}></div>
            <div class="field"><label>Licencia deportiva FAY</label>
              <input id="m_timonel_licencia_fay" value="${U.esc(i.timonel_licencia_fay || '')}" ${editable ? '' : 'disabled'}></div>
          </div>
          <div class="grid g2">
            <div class="field"><label>Correo (no editable)</label>
              <input value="${U.esc(i.timonel_email || '')}" disabled></div>
            <div class="field"><label>Teléfono de contacto</label>
              <input id="m_timonel_tel" value="${U.esc(i.timonel_tel || '')}" ${editable ? '' : 'disabled'}></div>
          </div>
          <div class="check">
            <input type="checkbox" id="m_timonel_socio" ${i.timonel_socio ? 'checked' : ''} ${editable ? '' : 'disabled'}>
            <label for="m_timonel_socio">Soy socio del Club Náutico Bariloche</label>
          </div>
          <div class="grid g2">
            <div class="field"><label>Foto del carnet de timonel (opcional)</label>
              ${docBlock(i, 'carnet_archivo_path', 'carnet', editable)}</div>
            <div class="field"><label>Foto de la licencia FAY (opcional)</label>
              ${docBlock(i, 'licencia_fay_archivo_path', 'licencia_fay', editable)}</div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Tripulación</legend>
          <div id="tripulantes"></div>
          ${editable ? '<button type="button" class="btn ghost sm" id="btnAddTrip">+ Agregar tripulante</button>' : ''}
          <div class="field" style="margin-top:13px">
            <label>Listado de tripulantes firmado (PDF, opcional)</label>
            ${docBlock(i, 'tripulantes_archivo_path', 'tripulantes', editable)}
          </div>
        </fieldset>

        <fieldset>
          <legend>Seguridad y seguro</legend>
          <div class="grid g2">
            <div class="field"><label>Contacto de emergencia — nombre</label>
              <input id="m_emergencia_nombre" value="${U.esc(i.emergencia_nombre || '')}" ${editable ? '' : 'disabled'}></div>
            <div class="field"><label>Contacto de emergencia — teléfono</label>
              <input id="m_emergencia_tel" value="${U.esc(i.emergencia_tel || '')}" ${editable ? '' : 'disabled'}></div>
          </div>
          <div class="grid g3">
            <div class="field"><label>Compañía aseguradora</label>
              <input id="m_seguro_compania" value="${U.esc(i.seguro_compania || '')}" ${editable ? '' : 'disabled'}></div>
            <div class="field"><label>Nº de póliza</label>
              <input id="m_seguro_poliza" value="${U.esc(i.seguro_poliza || '')}" ${editable ? '' : 'disabled'}></div>
            <div class="field"><label>Vencimiento</label>
              <input type="date" id="m_seguro_vencimiento" value="${U.esc(i.seguro_vencimiento || '')}" ${editable ? '' : 'disabled'}></div>
          </div>
          <div class="field">
            <label>Constancia de seguro (PDF o foto) <span class="req">*</span></label>
            ${docBlock(i, 'seguro_archivo_path', 'seguro', editable)}
          </div>
        </fieldset>

        <fieldset>
          <legend>Comprobante de pago</legend>
          <div class="field">
            <label>Comprobante de pago del arancel <span class="req">*</span></label>
            ${docBlock(i, 'comprobante_pago_path', 'comprobante', editable)}
          </div>
        </fieldset>

        <fieldset>
          <legend>Observaciones</legend>
          <textarea id="m_observaciones" maxlength="600" ${editable ? '' : 'disabled'}>${U.esc(i.observaciones || '')}</textarea>
        </fieldset>

        ${editable ? `<div class="card">
          <div class="row">
            <div class="small muted" style="flex:1;min-width:220px">Los cambios quedan guardados apenas los confirmás.</div>
            <button type="submit" class="btn" id="btnGuardarMi">Guardar cambios</button>
          </div>
        </div>` : ''}
      </form>`;

    (Array.isArray(i.tripulantes) ? i.tripulantes : []).forEach(t => filaTripulante(t, editable));

    U.$('#btnVolver').addEventListener('click', cargarLista);
    if (editable) U.$('#btnAddTrip').addEventListener('click', () => filaTripulante(null, true));

    U.$$('[data-ver]', d).forEach(b => b.addEventListener('click', () => verDoc(i[b.dataset.ver])));
    U.$$('[data-subir]', d).forEach(inp => inp.addEventListener('change', async () => {
      const file = inp.files[0];
      if (!file) return;
      const campo = inp.dataset.subir;
      const path = await subirDoc(i.id, campo, inp.dataset.nombre, file);
      if (path) { i[campo] = path; abrirDetalle(id); }
    }));

    if (editable) {
      U.$('#frmMi').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = U.$('#btnGuardarMi');
        btn.disabled = true; btn.textContent = 'Guardando…';
        const g = sel => U.$(sel).value;
        const reg = {
          nombre_barco: g('#m_nombre_barco').trim(),
          num_vela: g('#m_num_vela').trim().toUpperCase(),
          modelo: g('#m_modelo').trim() || null,
          club: g('#m_club').trim() || null,
          codigo_flota: g('#m_codigo_flota').trim().toUpperCase() || null,
          timonel_nombre: g('#m_timonel_nombre').trim(),
          timonel_dni: g('#m_timonel_dni').trim() || null,
          timonel_nacimiento: g('#m_timonel_nacimiento') || null,
          timonel_licencia_fay: g('#m_timonel_licencia_fay').trim() || null,
          timonel_tel: g('#m_timonel_tel').trim(),
          timonel_socio: U.$('#m_timonel_socio').checked,
          tripulantes: leerTripulantes(),
          emergencia_nombre: g('#m_emergencia_nombre').trim(),
          emergencia_tel: g('#m_emergencia_tel').trim(),
          seguro_compania: g('#m_seguro_compania').trim() || null,
          seguro_poliza: g('#m_seguro_poliza').trim() || null,
          seguro_vencimiento: g('#m_seguro_vencimiento') || null,
          observaciones: g('#m_observaciones').trim() || null
        };
        if (U.$('#m_rating')) reg.rating = g('#m_rating') === '' ? null : Number(g('#m_rating'));
        if (U.$('#m_rating_origen')) reg.rating_origen = g('#m_rating_origen') || null;
        if (U.$('#m_matricula_rey')) reg.matricula_rey = g('#m_matricula_rey').trim().toUpperCase() || null;

        const { error } = await db.from('inscripciones').update(reg).eq('id', i.id);
        btn.disabled = false; btn.textContent = 'Guardar cambios';
        if (error) { alert('No se pudo guardar: ' + U.err(error)); return; }
        Object.assign(i, reg);
        U.aviso('#avisos', 'ok', 'Cambios guardados.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }
})();
