/* ============================================================================
 * bolsa.js — Bolsa de tripulantes (público)
 * ----------------------------------------------------------------------------
 * Alta pública sin login: la política RLS bolsa_insert_publico admite el INSERT
 * anónimo. El listado sale de la vista v_bolsa_publica, que deliberadamente no
 * expone correo ni celular — esos datos los ve sólo la Comisión desde el panel.
 * ==========================================================================*/
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', iniciar);

  async function iniciar() {
    // El alta es anónima: si quedó una sesión de otra pantalla en este navegador,
    // la cerramos para no mezclar permisos (mismo criterio que el formulario de inscripción).
    const { data: sesion } = await db.auth.getSession();
    if (sesion && sesion.session) await db.auth.signOut();

    U.$('#btnAnotarme').addEventListener('click', mostrarFormulario);
    U.$('#nacimiento').addEventListener('change', alCambiarEdad);
    U.$('#frm').addEventListener('submit', enviar);

    await cargarLista();
  }

  function mostrarFormulario() {
    U.$('#frm').style.display = '';
    U.$('#frm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    U.$('#nombre').focus();
  }

  async function cargarLista() {
    const cont = U.$('#listaBolsa');
    cont.innerHTML = '<p class="muted">Cargando…</p>';
    const { data, error } = await db.from('v_bolsa_publica')
      .select('*').order('created_at', { ascending: false });

    if (error) { cont.innerHTML = '<div class="alert error">' + U.esc(U.err(error)) + '</div>'; return; }
    if (!data || !data.length) {
      cont.innerHTML = '<p class="muted">Todavía no hay nadie anotado. Podés ser el primero.</p>';
      return;
    }

    cont.innerHTML = `<div class="tabla-wrap"><table class="t">
      <thead><tr><th>Nombre</th><th class="num">Edad</th><th>Posición</th><th>Experiencia</th></tr></thead>
      <tbody>${data.map(t => `<tr>
        <td>${U.esc(t.nombre)} ${U.esc(t.apellido)}</td>
        <td class="num">${t.edad ?? '—'}</td>
        <td>${U.esc(t.posicion || '—')}</td>
        <td style="white-space:normal">${U.esc(t.experiencia || '—')}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function alCambiarEdad() {
    const v = U.$('#nacimiento').value;
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

  async function enviar(e) {
    e.preventDefault();
    const btn = U.$('#btnEnviar');
    btn.disabled = true; btn.textContent = 'Enviando…';

    const reg = {
      nombre: U.$('#nombre').value.trim(),
      apellido: U.$('#apellido').value.trim(),
      email: U.$('#email').value.trim().toLowerCase(),
      celular: U.$('#celular').value.trim(),
      nacimiento: U.$('#nacimiento').value,
      posicion: U.$('#posicion').value || null,
      experiencia: U.$('#experiencia').value.trim() || null,
      autoriza_menor: U.$('#autoriza_menor').checked,
      disponible: true
    };

    const { error } = await db.from('bolsa_tripulantes').insert(reg);
    btn.disabled = false; btn.textContent = 'Anotarme';

    if (error) { U.aviso('#avisos', 'error', U.esc(U.err(error))); return; }

    U.$('#frm').style.display = 'none';
    U.$('#avisos').innerHTML = '';
    U.$('#confirmacion').style.display = '';
    U.$('#confirmacion').innerHTML = `
      <div class="card center">
        <div style="font-size:44px;line-height:1">⛵</div>
        <h2>Quedaste anotado</h2>
        <p>Gracias, <strong>${U.esc(reg.nombre)}</strong>. Ya figurás en la bolsa de tripulantes.</p>
        <div class="alert info" style="text-align:left;margin-top:16px">
          <strong>Qué sigue:</strong> los timoneles que necesiten tripulación consultan esta lista y la
          Comisión de Vela y Motor te contacta a <strong>${U.esc(reg.email)}</strong> o al celular que
          dejaste. Cuando consigas barco, avisanos y te damos de baja de la lista.
        </div>
      </div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await cargarLista();
  }
})();
