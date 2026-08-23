/* ============================================================================
 * inscripcion.js — Formulario público de inscripción a regatas (link / QR)
 * No requiere login: la política RLS insc_insert_publico admite el alta anónima
 * sólo si el evento está en 'inscripcion_abierta' y dentro del plazo.
 * ==========================================================================*/
(function () {
  'use strict';
  const E = { evento: null, clases: [], eventoClases: [] };

  document.addEventListener('DOMContentLoaded', iniciar);

  async function iniciar() {
    const id = U.param('evento');
    if (!id) { U.aviso('#avisos', 'error', 'Falta el identificador del evento en el enlace.'); return; }

    const { data: ev, error } = await db.from('eventos').select('*').eq('id', id).single();
    if (error || !ev) { U.aviso('#avisos', 'error', 'No se encontró el evento.'); return; }
    E.evento = ev;

    U.$('#evSub').innerHTML = '<strong>' + U.esc(ev.nombre) + '</strong><br>' +
      U.rango(ev.fecha_inicio, ev.fecha_fin) + ' · ' + U.esc(ev.sede || 'Club Náutico Bariloche');

    // ¿Está abierta la inscripción?
    const ahora = new Date();
    const cerrada = ev.estado !== 'inscripcion_abierta' ||
      (ev.inscripcion_cierre && ahora > new Date(ev.inscripcion_cierre)) ||
      (ev.inscripcion_apertura && ahora < new Date(ev.inscripcion_apertura));

    if (cerrada) {
      U.aviso('#avisos', 'warn', '<strong>La inscripción a este evento no está abierta.</strong><br>' +
        'Estado actual: ' + ((U.ESTADOS[ev.estado] || {}).txt || ev.estado) +
        (ev.inscripcion_cierre ? '. Cierre de inscripción: ' + new Date(ev.inscripcion_cierre).toLocaleString('es-AR') : '') +
        '<br><a href="index.html?evento=' + ev.id + '">Ver la ficha del evento</a>');
      return;
    }

    const [rc, rec] = await Promise.all([
      db.from('clases').select('*').eq('activa', true).order('orden'),
      db.from('evento_clases').select('*').eq('evento_id', ev.id).order('orden_largada')
    ]);
    E.clases = rc.data || [];
    E.eventoClases = (rec.data || []).map(x =>
      Object.assign({}, E.clases.find(c => c.id === x.clase_id) || {}, x));

    if (!E.eventoClases.length) {
      U.aviso('#avisos', 'warn', 'El evento todavía no tiene clases habilitadas para inscripción.');
      return;
    }

    U.$('#clase_id').innerHTML = '<option value="">— seleccionar —</option>' +
      E.eventoClases.map(c => `<option value="${c.clase_id}">${U.esc(c.nombre)}</option>`).join('');

    U.$('#club').value = ev.sede && /bariloche/i.test(ev.sede) ? 'Club Náutico Bariloche' : '';

    U.$('#clase_id').addEventListener('change', alCambiarClase);
    U.$('#timonel_nacimiento').addEventListener('change', alCambiarEdad);
    U.$('#btnAddTrip').addEventListener('click', () => filaTripulante());
    U.$('#frm').addEventListener('submit', enviar);

    const arancel = [];
    if (ev.arancel_socio)    arancel.push('socios $ ' + Number(ev.arancel_socio).toLocaleString('es-AR'));
    if (ev.arancel_invitado) arancel.push('invitados $ ' + Number(ev.arancel_invitado).toLocaleString('es-AR'));
    U.aviso('#avisos', 'info',
      '<strong>Inscripción abierta.</strong> ' +
      (ev.inscripcion_cierre ? 'Cierra el ' + new Date(ev.inscripcion_cierre).toLocaleString('es-AR') + '. ' : '') +
      (arancel.length ? 'Arancel: ' + arancel.join(' · ') + '. ' : 'Sin arancel. ') +
      (ev.datos_pago ? '<br>Pago: ' + U.esc(ev.datos_pago) : ''));

    U.$('#frm').style.display = '';
  }

  function claseSel() {
    const id = U.$('#clase_id').value;
    return E.eventoClases.find(c => c.clase_id === id);
  }

  function alCambiarClase() {
    const c = claseSel();
    const hand = c && c.sistema && c.sistema !== 'monotipo';
    U.$('#boxRating').style.display = hand ? '' : 'none';
    U.$('#hintClase').textContent = c
      ? 'Puntaje: ' + ({ monotipo: 'monotipo, sin corrección de tiempos',
                         tot_phrf: 'PHRF Tiempo sobre Tiempo',
                         tot_factor: 'Tiempo sobre Tiempo con factor',
                         tod: 'Tiempo sobre Distancia' }[c.sistema] || c.sistema) +
        ' · Pruebas previstas: ' + (c.pruebas_previstas || '—') +
        (c.tripulacion ? ' · Tripulación habitual: ' + c.tripulacion : '')
      : '';
    // pre-cargar filas de tripulantes según la clase
    if (c && c.tripulacion > 1 && !U.$$('#tripulantes .trip').length) {
      for (let i = 1; i < c.tripulacion; i++) filaTripulante();
    }
  }

  function alCambiarEdad() {
    const v = U.$('#timonel_nacimiento').value;
    if (!v) { U.$('#boxMenor').style.display = 'none'; U.$('#hintEdad').textContent = ''; return; }
    const n = U.fecha(v), h = new Date();
    let edad = h.getFullYear() - n.getFullYear();
    const m = h.getMonth() - n.getMonth();
    if (m < 0 || (m === 0 && h.getDate() < n.getDate())) edad--;
    U.$('#hintEdad').textContent = 'Edad: ' + edad + ' años';
    const menor = edad < 18;
    U.$('#boxMenor').style.display = menor ? '' : 'none';
    U.$('#autoriza_menor').required = menor;
  }

  let nTrip = 0;
  function filaTripulante(v) {
    v = v || {};
    const i = ++nTrip;
    const div = document.createElement('div');
    div.className = 'trip grid g4';
    div.style.cssText = 'align-items:end;padding:9px;border:1px solid var(--gris-300);border-radius:8px;margin-bottom:9px';
    div.innerHTML = `
      <div class="field" style="margin:0"><label>Apellido y nombre</label>
        <input type="text" class="t-nombre" maxlength="80" value="${U.esc(v.nombre || '')}"></div>
      <div class="field" style="margin:0"><label>DNI</label>
        <input type="text" class="t-dni" maxlength="20" value="${U.esc(v.dni || '')}"></div>
      <div class="field" style="margin:0"><label>Nacimiento</label>
        <input type="date" class="t-nac" value="${U.esc(v.nacimiento || '')}"></div>
      <div class="field" style="margin:0;display:flex;gap:7px;align-items:end">
        <div style="flex:1"><label>Licencia FAY</label>
          <input type="text" class="t-lic" maxlength="30" value="${U.esc(v.licencia || '')}"></div>
        <button type="button" class="btn ghost sm" title="Quitar">✕</button>
      </div>`;
    div.querySelector('button').addEventListener('click', () => div.remove());
    U.$('#tripulantes').appendChild(div);
  }

  function leerTripulantes() {
    return U.$$('#tripulantes .trip').map(d => ({
      nombre:     d.querySelector('.t-nombre').value.trim(),
      dni:        d.querySelector('.t-dni').value.trim(),
      nacimiento: d.querySelector('.t-nac').value || null,
      licencia:   d.querySelector('.t-lic').value.trim()
    })).filter(t => t.nombre);
  }

  async function enviar(e) {
    e.preventDefault();
    const btn = U.$('#btnEnviar');
    const c = claseSel();
    if (!c) { U.aviso('#avisos', 'error', 'Seleccioná la clase en la que vas a participar.'); return; }

    btn.disabled = true; btn.textContent = 'Enviando…';

    const socio = U.$('#timonel_socio').checked;
    const monto = socio ? E.evento.arancel_socio : E.evento.arancel_invitado;

    const reg = {
      evento_id: E.evento.id,
      clase_id: c.clase_id,
      nombre_barco: U.$('#nombre_barco').value.trim(),
      num_vela: U.$('#num_vela').value.trim().toUpperCase(),
      modelo: U.$('#modelo').value.trim() || null,
      club: U.$('#club').value.trim() || null,
      codigo_flota: U.$('#codigo_flota').value.trim().toUpperCase() || null,
      rating: U.$('#rating').value ? Number(U.$('#rating').value) : null,
      rating_origen: U.$('#rating_origen').value || null,

      timonel_nombre: U.$('#timonel_nombre').value.trim(),
      timonel_dni: U.$('#timonel_dni').value.trim() || null,
      timonel_nacimiento: U.$('#timonel_nacimiento').value || null,
      timonel_email: U.$('#timonel_email').value.trim().toLowerCase(),
      timonel_tel: U.$('#timonel_tel').value.trim(),
      timonel_licencia_fay: U.$('#timonel_licencia_fay').value.trim() || null,
      timonel_socio: socio,

      tripulantes: leerTripulantes(),

      emergencia_nombre: U.$('#emergencia_nombre').value.trim(),
      emergencia_tel: U.$('#emergencia_tel').value.trim(),
      seguro_compania: U.$('#seguro_compania').value.trim() || null,
      seguro_poliza: U.$('#seguro_poliza').value.trim() || null,
      seguro_vencimiento: U.$('#seguro_vencimiento').value || null,

      acepta_rrv: U.$('#acepta_rrv').checked,
      acepta_riesgo: U.$('#acepta_riesgo').checked,
      autoriza_menor: U.$('#autoriza_menor').checked,
      observaciones: U.$('#observaciones').value.trim() || null,

      estado: 'pendiente',
      pago_estado: 'impago',
      monto: monto || null
    };

    const { data, error } = await db.from('inscripciones').insert(reg).select('folio, num_vela').single();

    btn.disabled = false; btn.textContent = 'Enviar inscripción';

    if (error) { U.aviso('#avisos', 'error', U.esc(U.err(error))); return; }

    U.$('#frm').style.display = 'none';
    U.$('#avisos').innerHTML = '';
    U.$('#confirmacion').style.display = '';
    U.$('#confirmacion').innerHTML = `
      <div class="card center">
        <div style="font-size:44px;line-height:1">⛵</div>
        <h2>Inscripción registrada</h2>
        <p>Tu inscripción a <strong>${U.esc(E.evento.nombre)}</strong> quedó registrada con el folio</p>
        <p class="mono" style="font-size:22px;font-weight:700;color:var(--azul-700)">${U.esc(data.folio || '—')}</p>
        <p class="muted small">Barco ${U.esc(reg.nombre_barco)} · Nº de vela ${U.esc(data.num_vela)}</p>
        <div class="alert info" style="text-align:left;margin-top:16px">
          <strong>Qué sigue:</strong>
          <ol style="margin:7px 0 0;padding-left:20px">
            <li>La Comisión de Vela verifica documentación, seguro y arancel.</li>
            <li>Recibirás la confirmación por correo a <strong>${U.esc(reg.timonel_email)}</strong>.</li>
            <li>Presentate en la reunión de timoneles${E.evento.hora_briefing ? ' a las ' + U.hora(E.evento.hora_briefing) + ' h' : ''}
                con DNI, constancia de seguro${reg.autoriza_menor ? ' y la autorización del responsable legal' : ''}.</li>
          </ol>
        </div>
        <div class="row center" style="justify-content:center;margin-top:14px">
          <a class="btn sec" href="index.html?evento=${E.evento.id}">Ver el evento</a>
          <a class="btn" href="inscripcion.html?evento=${E.evento.id}">Inscribir otro barco</a>
        </div>
      </div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
})();
