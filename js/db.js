/* ============================================================================
 * db.js — Cliente Supabase y utilidades comunes
 * Sistema de Regatas — Club Náutico Bariloche
 * ==========================================================================*/
(function () {
  'use strict';
  const C = window.CNB_CONFIG || {};

  if (!C.SUPABASE_URL || C.SUPABASE_URL.indexOf('TU-PROYECTO') >= 0) {
    console.warn('[CNB] config.js sin configurar: cargá SUPABASE_URL y SUPABASE_ANON_KEY.');
  }

  window.db = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  // ---------------------------------------------------------------- helpers
  const U = {
    $:  (s, c) => (c || document).querySelector(s),
    $$: (s, c) => Array.from((c || document).querySelectorAll(s)),

    esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    /** 'YYYY-MM-DD' → Date local sin corrimiento de zona horaria */
    fecha(iso) {
      if (!iso) return null;
      const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
      return new Date(a, m - 1, d);
    },

    fechaCorta(iso) {
      const d = U.fecha(iso);
      if (!d) return '—';
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },

    fechaLarga(iso) {
      const d = U.fecha(iso);
      if (!d) return '—';
      return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    },

    rango(ini, fin) {
      if (!fin || fin === ini) return U.fechaLarga(ini);
      const a = U.fecha(ini), b = U.fecha(fin);
      if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear())
        return a.getDate() + ' al ' + b.getDate() + ' de ' +
               b.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
      return U.fechaCorta(ini) + ' al ' + U.fechaCorta(fin);
    },

    hora: h => h ? String(h).slice(0, 5) : '—',

    MESES: ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'],

    ESTADOS: {
      borrador:            { txt: 'Borrador',              chip: '' },
      publicado:           { txt: 'Publicado',             chip: 'azul' },
      inscripcion_abierta: { txt: 'Inscripción abierta',   chip: 'verde' },
      inscripcion_cerrada: { txt: 'Inscripción cerrada',   chip: 'naranja' },
      en_curso:            { txt: 'En curso',              chip: 'naranja' },
      finalizado:          { txt: 'Finalizado',            chip: '' },
      suspendido:          { txt: 'Suspendido',            chip: 'rojo' },
      cancelado:           { txt: 'Cancelado',             chip: 'rojo' }
    },

    ESTADOS_INSC: {
      pendiente:    { txt: 'Pendiente',    chip: 'naranja' },
      confirmada:   { txt: 'Confirmada',   chip: 'verde' },
      rechazada:    { txt: 'Rechazada',    chip: 'rojo' },
      lista_espera: { txt: 'Lista de espera', chip: 'azul' },
      retirada:     { txt: 'Retirada',     chip: '' }
    },

    TIPOS: {
      regata: 'Regata', campeonato: 'Campeonato', travesia: 'Travesía',
      clinica: 'Clínica', escuela: 'Escuela de Vela', social: 'Evento social', motor: 'Actividad de motor'
    },

    chipEstado(e) {
      const x = U.ESTADOS[e] || { txt: e, chip: '' };
      return '<span class="chip ' + x.chip + '">' + U.esc(x.txt) + '</span>';
    },

    aviso(sel, tipo, msg) {
      const el = typeof sel === 'string' ? U.$(sel) : sel;
      if (!el) return;
      el.innerHTML = msg ? '<div class="alert ' + tipo + '">' + msg + '</div>' : '';
      if (msg) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    /** Descarga un texto como archivo (CSV, ICS, HTML) */
    descargar(nombre, contenido, mime) {
      const blob = new Blob(['﻿' + contenido], { type: (mime || 'text/plain') + ';charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },

    /** Genera un archivo .ics con el calendario de eventos */
    ics(eventos, nombreCal) {
      const pad = n => String(n).padStart(2, '0');
      const dt = iso => { const d = U.fecha(iso); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); };
      const dtFin = iso => { const d = U.fecha(iso); d.setDate(d.getDate() + 1);
        return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); };
      const esc = s => String(s ?? '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
      const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CNB//Regatas//ES',
                 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
                 'X-WR-CALNAME:' + esc(nombreCal || 'Regatas CNB'),
                 'X-WR-TIMEZONE:America/Argentina/Buenos_Aires'];
      eventos.forEach(e => {
        L.push('BEGIN:VEVENT',
          'UID:' + e.id + '@regatas.cnb',
          'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
          'DTSTART;VALUE=DATE:' + dt(e.fecha_inicio),
          'DTEND;VALUE=DATE:' + dtFin(e.fecha_fin || e.fecha_inicio),
          'SUMMARY:' + esc(e.nombre),
          'LOCATION:' + esc(e.sede || 'Club Náutico Bariloche'),
          'DESCRIPTION:' + esc((U.TIPOS[e.tipo] || e.tipo) +
            (e.hora_senal_atencion ? ' — 1ª señal de atención ' + U.hora(e.hora_senal_atencion) : '') +
            (e.descripcion ? '\n' + e.descripcion : '')),
          'END:VEVENT');
      });
      L.push('END:VCALENDAR');
      return L.join('\r\n');
    },

    /** Convierte un array de objetos a CSV con separador ; (Excel es-AR) */
    csv(filas, columnas) {
      const esc = v => {
        const s = String(v ?? '');
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const cab = columnas.map(c => esc(c.titulo)).join(';');
      const cuerpo = filas.map(f => columnas.map(c =>
        esc(typeof c.valor === 'function' ? c.valor(f) : f[c.valor])).join(';')).join('\n');
      return cab + '\n' + cuerpo;
    },

    /** Abre una ventana de impresión con un HTML de documento */
    imprimir(html, titulo) {
      const w = window.open('', '_blank');
      if (!w) { alert('El navegador bloqueó la ventana emergente. Habilitala para imprimir.'); return; }
      w.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8">' +
        '<title>' + U.esc(titulo || 'Documento') + '</title>' +
        '<link rel="stylesheet" href="style.css"></head><body>' + html +
        '<script>window.onload=function(){setTimeout(function(){window.print();},350);}<\/script>' +
        '</body></html>');
      w.document.close();
    },

    /** Manejo uniforme de errores de Supabase */
    err(e) {
      if (!e) return '';
      const m = e.message || String(e);
      if (/row-level security/i.test(m))
        return 'No tenés permisos para esta operación (RLS). Verificá que tu email esté activo en usuarios_autorizados.';
      if (/invalid login credentials/i.test(m)) return 'Correo o PIN incorrecto.';
      if (/password should be at least/i.test(m))
        return 'El PIN es muy corto para la configuración actual de Supabase (mínimo 6 dígitos).';
      if (/duplicate key/i.test(m) && /num_vela/i.test(m))
        return 'Ya existe una inscripción con ese número de vela en esta clase para este evento.';
      if (/duplicate key/i.test(m)) return 'Ya existe un registro con esos datos (clave duplicada).';
      return m;
    },

    param: k => new URLSearchParams(location.search).get(k),

    /**
     * Agrega el "ojito" para ver/ocultar a cada campo de PIN de la página.
     * Se aplica solo a los input[type=password], así que alcanza con llamarla una vez;
     * si una pantalla dibuja campos nuevos después, puede volver a llamarla.
     */
    ojosPin(cont) {
      const OJO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      const OJO_TACHADO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M17.9 17.9A10.8 10.8 0 0 1 12 20c-7 0-11-8-11-8a19.8 19.8 0 0 1 5.1-5.9m3.2-1.7A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a19.6 19.6 0 0 1-2.3 3.4m-6.6-1.1a3 3 0 1 1-4.2-4.2"/>' +
        '<line x1="1" y1="1" x2="23" y2="23"/></svg>';

      U.$$('input[type=password]', cont).forEach(input => {
        if (input.dataset.ojo) return;
        input.dataset.ojo = '1';

        const caja = document.createElement('span');
        caja.className = 'con-ojo';
        input.parentNode.insertBefore(caja, input);
        caja.appendChild(input);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ojo';
        btn.innerHTML = OJO;
        btn.title = 'Mostrar';
        btn.setAttribute('aria-label', 'Mostrar u ocultar el PIN');
        btn.addEventListener('click', () => {
          const mostrar = input.type === 'password';
          input.type = mostrar ? 'text' : 'password';
          btn.innerHTML = mostrar ? OJO_TACHADO : OJO;
          btn.title = mostrar ? 'Ocultar' : 'Mostrar';
          input.focus();
        });
        caja.appendChild(btn);
      });
    }
  };

  window.U = U;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => U.ojosPin());
  } else {
    U.ojosPin();
  }
})();
