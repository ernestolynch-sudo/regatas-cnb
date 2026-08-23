/* ============================================================================
 * docs.js — Generadores de AVISO DE REGATA e INSTRUCCIONES DE REGATA
 * Club Náutico Bariloche — Comisión de Vela y Motor
 * ----------------------------------------------------------------------------
 * Estructura y numeración conforme al APÉNDICE J del Reglamento de Regatas a
 * Vela (RRV) 2025-2028 de World Sailing, con las Prescripciones de la
 * Federación Argentina de Yachting (FAY) y las particularidades operativas del
 * lago Nahuel Huapi (viento térmico del O/SO de la tarde, rachas de cordillera,
 * agua fría todo el año, áreas de navegación comercial en Puerto San Carlos).
 *
 * El generador produce SECCIONES editables. Lo que el usuario modifica se
 * guarda en documentos_regata.contenido (jsonb) y sobrescribe el texto base.
 * ==========================================================================*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DocsRegata = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RRV_CICLO = '2025-2028';

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function fechaLarga(iso) {
    if (!iso) return '—';
    const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                   'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return d + ' de ' + meses[m - 1] + ' de ' + a;
  }

  function rangoFechas(ini, fin) {
    if (!fin || fin === ini) return fechaLarga(ini);
    return 'del ' + fechaLarga(ini) + ' al ' + fechaLarga(fin);
  }

  const hora = h => h ? String(h).slice(0, 5) + ' h' : '—';

  function nombreSistema(s) {
    return ({
      monotipo:   'sin corrección de tiempos (monotipo)',
      tot_phrf:   'Tiempo sobre Tiempo (PHRF), con TCF = B / (A + Rating)',
      tot_factor: 'Tiempo sobre Tiempo con factor de corrección directo',
      tod:        'Tiempo sobre Distancia (segundos por milla náutica)'
    })[s] || s;
  }

  function listaClases(clases) {
    if (!clases || !clases.length) return 'las clases que determine la Autoridad Organizadora';
    return clases.map(c => c.nombre).join(', ');
  }

  // =========================================================================
  // AVISO DE REGATA — Apéndice J1 RRV
  // =========================================================================
  function avisoDeRegata(ev, clases, opc) {
    opc = opc || {};
    const cls = clases || [];
    const hayHandicap = cls.some(c => c.sistema && c.sistema !== 'monotipo');
    const sistemas = [...new Set(cls.map(c => nombreSistema(c.sistema || 'monotipo')))];

    const S = [];
    const add = (titulo, cuerpo) => S.push({ id: 'ar' + (S.length + 1), titulo, cuerpo });

    add('Reglas', `
      <p>1.1. La regata se regirá por las <em>reglas</em> tal como están definidas en el
      Reglamento de Regatas a Vela (RRV) ${RRV_CICLO} de World Sailing.</p>
      <p>1.2. Serán de aplicación las Prescripciones de la Federación Argentina de Yachting (FAY),
      las Reglas de Clase de cada flota participante, el presente Aviso de Regata y las
      Instrucciones de Regata con sus modificaciones.</p>
      <p>1.3. En caso de conflicto entre este Aviso de Regata y las Instrucciones de Regata,
      prevalecerán las Instrucciones de Regata. Esto modifica la regla 63.7 del RRV.</p>
      <p>1.4. El idioma oficial de la regata es el español.</p>`);

    add('Publicidad', `
      <p>2.1. Los barcos podrán exhibir publicidad conforme a la Reglamentación 20 de World Sailing
      (Código de Publicidad) y a lo dispuesto por la FAY.</p>
      <p>2.2. La Autoridad Organizadora podrá requerir que los barcos exhiban publicidad del evento
      y/o de sus auspiciantes, provista sin cargo, conforme a la Reglamentación 20.4.</p>`);

    add('Elegibilidad e inscripción', `
      <p>3.1. La regata está abierta a los barcos de las clases ${esc(listaClases(cls))}.</p>
      <p>3.2. Podrán participar socios del ${esc(ev.sede || 'Club Náutico Bariloche')} y competidores
      invitados de otras instituciones náuticas.</p>
      <p>3.3. La inscripción se realiza <strong>exclusivamente por el formulario web</strong> del sistema
      de regatas del CNB, disponible en el sitio del evento y mediante código QR en cartelera.</p>
      <p>3.4. Plazo de inscripción: ${opc.plazoInscripcion || 'hasta ' + (ev.inscripcion_cierre
        ? fechaLarga(ev.inscripcion_cierre) : 'la fecha que informe la Autoridad Organizadora')}.
      Las inscripciones fuera de término quedarán sujetas a aceptación de la Autoridad Organizadora.</p>
      <p>3.5. Cada barco deberá presentar, antes de la primera señal de atención:
      constancia de seguro de responsabilidad civil vigente (ver punto 16), documento de identidad
      del timonel y, en caso de competidores menores de edad, autorización firmada por su
      responsable legal.</p>
      ${hayHandicap ? `<p>3.6. Los barcos que corran con handicap deberán declarar su rating en el
      formulario de inscripción. Los ratings serán asignados o revisados por la Comisión de Vela y
      Motor. Un rating provisorio asignado por la Comisión no será motivo de solicitud de reparación.</p>` : ''}`);

    add('Aranceles', `
      <p>4.1. Arancel de inscripción:</p>
      <ul>
        <li>Socios del CNB: ${ev.arancel_socio ? '$ ' + Number(ev.arancel_socio).toLocaleString('es-AR') : 'sin cargo'}</li>
        <li>Competidores invitados: ${ev.arancel_invitado ? '$ ' + Number(ev.arancel_invitado).toLocaleString('es-AR') : 'sin cargo'}</li>
      </ul>
      <p>4.2. Forma de pago: ${esc(ev.datos_pago || 'según se indique al confirmar la inscripción')}.</p>
      <p>4.3. La inscripción se considera <em>confirmada</em> una vez acreditado el pago y verificada
      la documentación.</p>`);

    add('Programa', `
      <p>5.1. Fechas del evento: ${rangoFechas(ev.fecha_inicio, ev.fecha_fin)}.</p>
      <p>5.2. Reunión de timoneles (<em>briefing</em>): ${hora(ev.hora_briefing)} en
      ${esc(ev.sede || 'la sede del CNB')}. La asistencia del timonel o de un representante del barco
      es obligatoria.</p>
      <p>5.3. Primera señal de atención: ${hora(ev.hora_senal_atencion)}. Las señales de atención de
      los días siguientes se anunciarán en el Tablero Oficial de Avisos (TOA).</p>
      <p>5.4. Pruebas previstas: ${cls.map(c => c.nombre + ' — ' + (c.pruebas_previstas || 3)).join(' · ') || 'a determinar'}.</p>
      <p>5.5. La serie se constituirá con un mínimo de
      ${Math.min(...cls.map(c => c.pruebas_minimas || 1).concat([1]))} prueba(s) válida(s).</p>
      <p>5.6. El último día del evento no se dará ninguna señal de atención después de
      ${opc.horaLimiteUltimoDia || '16:30 h'}, salvo como consecuencia de una llamada general.</p>`);

    add('Instrucciones de Regata', `
      <p>6.1. Las Instrucciones de Regata estarán disponibles en el sitio web del evento y en el
      Tablero Oficial de Avisos a partir de ${opc.disponibilidadIR || '48 horas antes de la primera señal de atención'}.</p>`);

    add('Sede y área de regatas', `
      <p>7.1. Sede: ${esc(ev.sede || 'Club Náutico Bariloche')}, San Carlos de Bariloche, Río Negro.</p>
      <p>7.2. Área de regatas: ${esc(ev.area_regata || 'aguas del lago Nahuel Huapi frente a la sede del Club')}.</p>
      <p>7.3. <strong>Condiciones locales.</strong> El Nahuel Huapi presenta viento predominante del
      sector O/SO que suele establecerse e intensificarse por la tarde, con rachas descendentes de
      cordillera de intensidad y dirección variables, y temperatura de agua baja durante toda la
      temporada. Los competidores deben considerar estas condiciones al decidir su participación
      (ver punto 15) y al definir su vestimenta y equipo de flotabilidad.</p>`);

    add('Recorridos', `
      <p>8.1. Los recorridos previstos son ${esc(opc.recorridos ||
        'barlovento-sotavento con puerta de sotavento y llegada a barlovento, y/o recorridos costeros ' +
        'de tipo travesía con marcas naturales del lago')}, según se detallará en las Instrucciones de Regata.</p>`);

    add('Sistema de penalización', `
      <p>9.1. Será de aplicación la regla 44.1 del RRV (Penalización de Dos Giros / Un Giro).</p>
      ${opc.penalizacionPuntaje ? `<p>9.2. Para las clases con handicap, la Penalización de Dos Giros se
      reemplaza por la Penalización de Puntaje de la regla 44.3, con un valor del 20 % del número de
      barcos inscriptos. Esto modifica la regla 44.1.</p>` : ''}`);

    add('Puntaje', `
      <p>10.1. Se aplicará el Sistema de Puntuación Baja del Apéndice A del RRV.</p>
      <p>10.2. Sistema de corrección de tiempos por clase: ${sistemas.join('; ')}.</p>
      ${hayHandicap ? `<p>10.3. Para las clases con handicap PHRF se aplicará Tiempo sobre Tiempo:
      <br><code>Tiempo Corregido = Tiempo Real × TCF</code>, donde
      <code>TCF = ${cls.find(c => c.sistema === 'tot_phrf')?.phrf_b || 650} / (${cls.find(c => c.sistema === 'tot_phrf')?.phrf_a || 550} + Rating)</code>
      y el Rating se expresa en segundos por milla náutica.</p>` : ''}
      <p>10.${hayHandicap ? '4' : '3'}. Descartes: ${cls.map(c =>
        c.nombre + ' — ' + (c.descarte_desde ? 'se descartará el peor puntaje al completarse ' +
        c.descarte_desde + ' pruebas válidas' : 'sin descarte')).join(' · ')}.</p>
      <p>10.${hayHandicap ? '5' : '4'}. Los empates se resolverán conforme a la regla A8 del RRV.</p>`);

    add('Embarcaciones de apoyo', `
      <p>11.1. Toda embarcación de apoyo, entrenamiento o acompañamiento deberá registrarse ante la
      Autoridad Organizadora antes de la primera señal de atención, declarando patrón responsable,
      matrícula y medio de comunicación.</p>
      <p>11.2. Las embarcaciones de apoyo deberán mantenerse fuera del área de regatas desde la señal
      de atención hasta que todos los barcos hayan llegado o se hayan retirado, salvo requerimiento
      del Comité de Regata por razones de seguridad.</p>
      <p>11.3. Las embarcaciones de apoyo quedan a disposición del Comité de Regata para tareas de
      seguridad y asistencia.</p>`);

    add('Amarras, guardería y varado', `
      <p>12.1. Los barcos visitantes dispondrán de sector de armado y guardería asignado por la
      Comisión de Vela y Motor conforme al Plan de Sectores vigente del Club.</p>
      <p>12.2. Los barcos no podrán ser sacados del agua durante el evento sin autorización previa y
      por escrito del Comité de Regata, salvo por razones de seguridad.</p>`);

    add('Radiocomunicación', `
      <p>13.1. Canal de trabajo: VHF ${esc(ev.canal_vhf || '71')}.</p>
      <p>13.2. Salvo en una emergencia, un barco en regata no hará ni recibirá transmisiones de radio
      que no estén disponibles para todos los barcos. Esta restricción se aplica también a los
      teléfonos móviles.</p>`);

    add('Premios', `
      <p>14.1. ${esc(ev.premios || 'Se premiará a los tres primeros clasificados de cada clase con un ' +
        'mínimo de cinco (5) barcos inscriptos. Con menos de cinco barcos se premiará al primer clasificado.')}</p>
      <p>14.2. La entrega de premios se realizará ${opc.entregaPremios ||
        'al finalizar la última prueba, en la sede del Club'}.</p>`);

    add('Declaración de riesgo', `
      <p>15.1. La regla 3 del RRV establece: <em>«La responsabilidad de la decisión de un barco de
      participar en una prueba o de continuar en regata es solamente suya.»</em></p>
      <p>15.2. Al participar de este evento, cada competidor acepta y reconoce que la vela es una
      actividad que puede entrañar riesgo y peligro; que es su exclusiva responsabilidad la aptitud
      física propia y de su tripulación, y el estado, la flotabilidad y el equipamiento de seguridad
      de su barco; y que la Autoridad Organizadora, el Comité de Regata, el Comité de Protestas, los
      auspiciantes y sus dependientes no aceptan responsabilidad alguna por daño material, lesión
      personal o muerte vinculada, antes, durante o después del evento.</p>
      <p>15.3. Es obligatorio el uso permanente de chaleco salvavidas o ayuda a la flotabilidad
      homologada mientras el barco se encuentre en el agua, desde el zarpado hasta el regreso.
      Esto modifica la regla 40 del RRV.</p>`);

    add('Seguro', `
      <p>16.1. Cada barco participante deberá contar con un seguro de responsabilidad civil frente a
      terceros vigente durante todo el evento, con una cobertura mínima de
      ${esc(opc.montoSeguro || 'la exigida por la Prefectura Naval Argentina y por la FAY para el tipo de embarcación')}.</p>
      <p>16.2. La constancia de cobertura deberá adjuntarse o exhibirse al confirmar la inscripción.
      El barco que no acredite cobertura no será autorizado a largar.</p>`);

    add('Protección de datos y derechos de imagen', `
      <p>17.1. Los datos personales suministrados en la inscripción serán utilizados exclusivamente
      para la organización del evento, la confección de listas de largada, resultados y comunicaciones
      de seguridad.</p>
      <p>17.2. Al inscribirse, los competidores autorizan a la Autoridad Organizadora al uso sin
      cargo de imágenes, videos y sonido tomados durante el evento, con fines de difusión y promoción
      de la actividad náutica.</p>`);

    add('Información y contacto', `
      <p>18.1. Autoridad Organizadora: ${esc(ev.autoridad_organizadora || 'Club Náutico Bariloche — Comisión de Vela y Motor')}.</p>
      <p>18.2. Contacto: ${esc(ev.contacto_nombre || '—')}
      ${ev.contacto_email ? ' · ' + esc(ev.contacto_email) : ''}
      ${ev.contacto_tel ? ' · ' + esc(ev.contacto_tel) : ''}</p>
      <p>18.3. Toda la información oficial del evento (Aviso de Regata, Instrucciones de Regata,
      lista de inscriptos, resultados y comunicados) se publica en el sistema de regatas del CNB.</p>`);

    return { tipo: 'aviso', titulo: 'AVISO DE REGATA', secciones: S };
  }

  // =========================================================================
  // INSTRUCCIONES DE REGATA — Apéndice J2 RRV
  // =========================================================================
  function instruccionesDeRegata(ev, clases, opc) {
    opc = opc || {};
    const cls = clases || [];
    const S = [];
    const add = (titulo, cuerpo) => S.push({ id: 'ir' + (S.length + 1), titulo, cuerpo });

    add('Reglas', `
      <p>1.1. La regata se regirá por las <em>reglas</em> tal como están definidas en el RRV ${RRV_CICLO},
      las Prescripciones de la FAY y las Reglas de Clase.</p>
      <p>1.2. Se modifican las reglas 40 (chaleco obligatorio permanente, ver punto 17),
      63.7 (prevalecen estas Instrucciones) y las que se indiquen expresamente en cada punto.</p>`);

    add('Avisos a los competidores', `
      <p>2.1. Los avisos a los competidores se publicarán en el Tablero Oficial de Avisos (TOA)
      ubicado en ${esc(opc.ubicacionTOA || 'la sede del Club, junto a la Secretaría de Vela')} y en su
      versión digital dentro del sistema de regatas del CNB. Ambos tienen igual validez.</p>`);

    add('Cambios a las Instrucciones de Regata', `
      <p>3.1. Todo cambio a estas Instrucciones se publicará antes de las
      ${opc.horaCambiosIR || '09:00 h'} del día en que tendrá efecto, excepto los cambios al programa
      de pruebas, que se publicarán antes de las ${opc.horaCambiosPrograma || '20:00 h'} del día
      anterior al que tendrán efecto.</p>
      <p>3.2. En el agua, el Comité de Regata podrá cambiar las Instrucciones desplegando la bandera
      «L» con una señal sonora, antes de la señal de atención.</p>`);

    add('Señales hechas en tierra', `
      <p>4.1. Las señales hechas en tierra se desplegarán en el mástil de señales ubicado en
      ${esc(opc.ubicacionMastil || 'la explanada de botado')}.</p>
      <p>4.2. Bandera <strong>GI</strong> desplegada en tierra: «la prueba se posterga; la señal de
      atención no se dará antes de 60 minutos después de arriada la GI». Esto modifica la Señal de
      Regata GI.</p>
      <p>4.3. Bandera <strong>D</strong> con una señal sonora: «los barcos pueden dirigirse al área de
      regatas». La señal de atención no se dará antes de 30 minutos después de desplegada la D.
      Ningún barco podrá abandonar la costa antes de esa señal.</p>`);

    add('Programa de pruebas', `
      <p>5.1. Programa:</p>
      <table>
        <tr><th>Fecha</th><th>Señal de atención</th><th>Pruebas previstas</th></tr>
        <tr><td>${fechaLarga(ev.fecha_inicio)}</td><td>${hora(ev.hora_senal_atencion)}</td>
            <td>${cls.map(c => c.pruebas_previstas || 3).join(' / ') || '—'}</td></tr>
      </table>
      <p>5.2. Podrán correrse hasta ${opc.maxPruebasDia || 3} pruebas por día. Para avisar a los barcos
      que una prueba comenzará en breve, se desplegará la bandera naranja de la línea de largada al
      menos cinco minutos antes de la señal de atención.</p>
      <p>5.3. El último día del evento no se dará ninguna señal de atención después de
      ${opc.horaLimiteUltimoDia || '16:30 h'}, salvo como consecuencia de una llamada general.</p>`);

    add('Banderas de clase', `
      <table>
        <tr><th>Clase</th><th>Bandera de clase</th></tr>
        ${cls.map(c => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.bandera_clase || 'a designar en el TOA')}</td></tr>`).join('') ||
          '<tr><td colspan="2">A designar en el Tablero Oficial de Avisos.</td></tr>'}
      </table>`);

    add('Área de regatas', `
      <p>7.1. El área de regatas será ${esc(ev.area_regata || 'el sector del lago Nahuel Huapi frente a la sede del Club')}.</p>
      <p>7.2. Los barcos deberán mantenerse apartados de los canales de acceso y maniobra de
      embarcaciones comerciales de pasajeros de Puerto San Carlos, y dar paso a toda embarcación de
      mayor porte. El incumplimiento podrá ser penalizado por el Comité de Protestas.</p>`);

    add('Recorridos', `
      <p>8.1. Los diagramas de recorrido figuran en el <strong>Anexo A</strong> de estas Instrucciones e
      indican la secuencia de marcas, el lado por el que debe dejarse cada una y los ángulos
      aproximados entre tramos.</p>
      <p>8.2. Antes o con la señal de atención, el Comité de Regata indicará el rumbo aproximado al
      primer tramo y podrá indicar la longitud del recorrido.</p>
      <p>8.3. ${esc(opc.recorridoDetalle || 'Recorrido barlovento-sotavento: Largada – 1 – 2s/2p – 1 – Llegada, ' +
        'según la cantidad de vueltas que se indique.')}</p>`);

    add('Marcas', `
      <p>9.1. Las marcas de recorrido serán ${esc(opc.tipoMarcas || 'boyas inflables de color naranja')};
      la marca de cambio de recorrido será ${esc(opc.marcaCambio || 'una boya amarilla')}.</p>
      <p>9.2. Las marcas de largada serán ${esc(opc.marcasLargada || 'el mástil con bandera naranja de la ' +
        'embarcación del Comité de Regata y una boya del extremo de babor')}.</p>`);

    add('La largada', `
      <p>10.1. Las pruebas largarán conforme a la regla 26 del RRV: atención (5 min), preparación
      (4 min), último minuto (1 min), largada.</p>
      <p>10.2. La línea de largada estará entre el mástil con bandera naranja de la embarcación del
      Comité de Regata y la marca de largada de babor.</p>
      <p>10.3. ${opc.bandera30 === 'I' ? 'Será de aplicación la regla 30.1 (bandera I).' :
                 opc.bandera30 === 'U' ? 'Será de aplicación la regla 30.3 (bandera U).' :
                 opc.bandera30 === 'Z' ? 'Será de aplicación la regla 30.2 (bandera Z).' :
                 opc.bandera30 === 'negra' ? 'Será de aplicación la regla 30.4 (bandera negra).' :
                 'El Comité de Regata podrá aplicar las reglas 30.1, 30.2, 30.3 o 30.4 desplegando la bandera correspondiente con la señal de preparación.'}</p>
      <p>10.4. El barco que largue más de ${opc.limiteLargada || 4} minutos después de su señal de
      largada será clasificado <strong>DNS</strong> sin audiencia. Esto modifica las reglas A5.1, A5.2 y 63.1.</p>`);

    add('Cambio del tramo siguiente', `
      <p>11.1. Para cambiar el tramo siguiente, el Comité de Regata cambiará de posición la marca
      original (o la línea de llegada) o fondeará una nueva marca y retirará la original tan pronto
      como sea posible. En un cambio posterior, se cambiará de posición la nueva marca o se
      restituirá la original.</p>`);

    add('La llegada', `
      <p>12.1. La línea de llegada estará entre el mástil con bandera azul de la embarcación del
      Comité de Regata y la marca de llegada.</p>
      <p>12.2. En recorridos de travesía la llegada podrá tomarse por enfilación desde tierra;
      en ese caso se detallará en el Anexo A.</p>`);

    add('Sistema de penalización', `
      <p>13.1. Se aplicará la regla 44.1 del RRV. La Penalización de Dos Giros se aplica en todos los
      tramos, salvo indicación contraria.</p>
      ${opc.penalizacionPuntaje ? `<p>13.2. Para las clases con handicap se reemplaza la Penalización de Dos
      Giros por la Penalización de Puntaje de la regla 44.3, equivalente al 20 % del número de barcos
      inscriptos, redondeado al entero más próximo, y nunca peor que DNF.</p>` : ''}
      <p>13.${opc.penalizacionPuntaje ? '3' : '2'}. El Comité de Protestas podrá aplicar penalizaciones
      discrecionales (DPI) por infracciones a las Instrucciones de Regata que no afecten a otro barco
      en el agua, sin necesidad de descalificar.</p>`);

    add('Tiempos límite', `
      <table>
        <tr><th>Concepto</th><th>Tiempo</th></tr>
        <tr><td>Tiempo límite de la prueba</td><td>${opc.tlPrueba || '90'} minutos</td></tr>
        <tr><td>Tiempo objetivo</td><td>${opc.tlObjetivo || '45'} minutos</td></tr>
        <tr><td>Tiempo límite del primer barco a la marca 1</td><td>${opc.tlMarca1 || '25'} minutos</td></tr>
        <tr><td>Ventana de llegada tras el primer barco</td><td>${opc.tlVentana || '20'} minutos</td></tr>
      </table>
      <p>14.1. Los barcos que no lleguen dentro de la ventana de llegada serán clasificados
      <strong>DNF</strong> sin audiencia. Esto modifica las reglas 35, A5.1, A5.2 y A11.</p>
      <p>14.2. No haber cumplido el tiempo objetivo no será motivo de solicitud de reparación.
      Esto modifica la regla 62.1(a).</p>
      <p>14.3. Si ningún barco pasa la marca 1 dentro del tiempo límite correspondiente, la prueba
      será anulada.</p>`);

    add('Solicitudes de audiencia y protestas', `
      <p>15.1. Los formularios de protesta están disponibles en Secretaría de Vela y en el sistema de
      regatas. Las protestas y solicitudes de reparación deberán presentarse dentro del
      <strong>plazo de protestas</strong>: ${opc.plazoProtestas || 90} minutos después de la llegada del
      último barco de la última prueba del día o de que el Comité de Regata señale que no habrá más
      pruebas, lo que sea más tarde.</p>
      <p>15.2. Los avisos de protestas se publicarán en el TOA dentro de los 30 minutos posteriores al
      vencimiento del plazo, para informar a los competidores sobre audiencias en las que son parte o
      testigos.</p>
      <p>15.3. Un barco que protesta deberá informarlo al Comité de Regata inmediatamente después de
      llegar, identificando al barco protestado. Esto complementa la regla 61.1(a).</p>`);

    add('Puntaje', `
      <p>16.1. Se aplicará el Sistema de Puntuación Baja del Apéndice A del RRV.</p>
      <p>16.2. Corrección de tiempos por clase:</p>
      <table>
        <tr><th>Clase</th><th>Sistema</th><th>Descartes</th></tr>
        ${cls.map(c => `<tr><td>${esc(c.nombre)}</td><td>${esc(nombreSistema(c.sistema || 'monotipo'))}</td>
          <td>${c.descarte_desde ? '1 al completar ' + c.descarte_desde + ' pruebas válidas' : 'sin descarte'}</td></tr>`).join('') ||
          '<tr><td colspan="3">A determinar.</td></tr>'}
      </table>
      <p>16.3. Se requiere que se complete ${Math.min(...cls.map(c => c.pruebas_minimas || 1).concat([1]))}
      prueba(s) válida(s) para constituir la serie.</p>
      <p>16.4. Los empates se resolverán conforme a la regla A8 del RRV.</p>`);

    add('Reglas de seguridad', `
      <p>17.1. <strong>Chaleco salvavidas.</strong> Es obligatorio el uso permanente de chaleco
      salvavidas o ayuda a la flotabilidad homologada desde el zarpado hasta el regreso a tierra.
      Esto modifica la regla 40 del RRV. La bandera «Y» no será desplegada.</p>
      <p>17.2. <strong>Control de salida y regreso.</strong> Todo barco que abandone la costa deberá
      registrarse en la planilla de salida, y deberá registrar su regreso al arribar. El barco que se
      retire de una prueba deberá notificarlo al Comité de Regata antes de dejar el área de regatas,
      por VHF canal ${esc(ev.canal_vhf || '71')} o personalmente. El incumplimiento será penalizado a
      criterio del Comité de Protestas.</p>
      <p>17.3. <strong>Límites de viento.</strong> ${esc(opc.limiteViento ||
        'El Comité de Regata podrá suspender o postergar las pruebas cuando el viento sostenido supere ' +
        'los 12 nudos para las flotas juveniles de iniciación, 18 nudos para Optimist y 22 nudos para el ' +
        'resto de las clases, o cuando las condiciones de rachas y estado del lago lo hagan aconsejable.')}</p>
      <p>17.4. <strong>Agua fría.</strong> Dada la temperatura del agua del Nahuel Huapi, se recomienda
      enfáticamente el uso de traje de neoprene o equivalente en todas las flotas.</p>
      <p>17.5. La cobertura de seguridad estará a cargo de las embarcaciones de apoyo del Club y de las
      registradas conforme al punto 21.</p>`);

    add('Reemplazo de tripulantes o equipo', `
      <p>18.1. No se permite el reemplazo de competidores sin aprobación previa y por escrito del
      Comité de Regata.</p>
      <p>18.2. No se permite el reemplazo de equipo dañado o perdido sin autorización del Comité de
      Regata. Las solicitudes deben hacerse en la primera oportunidad razonable.</p>`);

    add('Controles de equipamiento y medición', `
      <p>19.1. Un barco o su equipo podrán ser inspeccionados en cualquier momento para verificar el
      cumplimiento de las Reglas de Clase y de estas Instrucciones.</p>
      <p>19.2. En el agua, un barco podrá ser instruido por un medidor del evento a dirigirse
      inmediatamente a un área designada para inspección.</p>`);

    add('Embarcaciones oficiales', `
      <p>20.1. Las embarcaciones oficiales se identificarán con
      ${esc(opc.idOficiales || 'bandera del Club Náutico Bariloche')}.</p>`);

    add('Embarcaciones de apoyo', `
      <p>21.1. Los jefes de equipo, entrenadores y demás personal de apoyo deberán permanecer fuera
      del área donde los barcos están regateando, desde la señal de preparación de la primera clase en
      largar hasta que todos los barcos hayan llegado o se hayan retirado, o el Comité de Regata
      señale postergación, llamada general o anulación.</p>
      <p>21.2. Toda embarcación de apoyo deberá estar registrada, llevar VHF en canal
      ${esc(ev.canal_vhf || '71')} y contar con equipamiento de seguridad reglamentario.</p>`);

    add('Eliminación de residuos', `
      <p>22.1. Los barcos y las embarcaciones de apoyo no arrojarán residuos al agua. Los residuos
      podrán entregarse a las embarcaciones oficiales o de apoyo. Esto complementa la regla 47 del RRV.
      El Nahuel Huapi integra un Parque Nacional: el incumplimiento será penalizado.</p>`);

    add('Restricciones de varado e izado', `
      <p>23.1. Los barcos con quilla no serán sacados del agua durante el evento sin autorización
      previa y por escrito del Comité de Regata.</p>`);

    add('Radiocomunicación', `
      <p>24.1. Canal de trabajo: VHF ${esc(ev.canal_vhf || '71')}. Se recomienda que todos los barcos
      lleven VHF portátil.</p>
      <p>24.2. Salvo en una emergencia, un barco en regata no hará ni recibirá transmisiones de radio
      no disponibles para todos los barcos. Esta restricción alcanza a los teléfonos móviles.</p>`);

    add('Premios y declaración de riesgo', `
      <p>25.1. Premios: ${esc(ev.premios || 'según lo establecido en el Aviso de Regata.')}</p>
      <p>25.2. Rige íntegramente la declaración de riesgo del Aviso de Regata y la regla 3 del RRV:
      <em>la responsabilidad de la decisión de un barco de participar en una prueba o de continuar en
      regata es solamente suya.</em></p>
      <p>25.3. Seguro: cada barco participante debe mantener vigente un seguro de responsabilidad
      civil frente a terceros durante todo el evento.</p>`);

    return { tipo: 'instrucciones', titulo: 'INSTRUCCIONES DE REGATA', secciones: S };
  }

  // =========================================================================
  // RENDER a HTML imprimible (A4)
  // =========================================================================
  function renderHTML(doc, ev, opciones) {
    opciones = opciones || {};
    const secciones = doc.secciones.map((s, i) =>
      `<section class="sec"><h2><span class="n">${i + 1}.</span> ${esc(s.titulo)}</h2>${s.cuerpo}</section>`
    ).join('');

    return `<article class="doc-regata">
  <header class="doc-head">
    ${opciones.logo ? `<img src="${opciones.logo}" alt="CNB" class="doc-logo">` : ''}
    <div>
      <div class="doc-club">CLUB NÁUTICO BARILOCHE</div>
      <div class="doc-sub">Comisión de Vela y Motor</div>
    </div>
  </header>
  <h1>${esc(doc.titulo)}</h1>
  <div class="doc-evento">
    <strong>${esc(ev.nombre || '')}</strong><br>
    ${rangoFechas(ev.fecha_inicio, ev.fecha_fin)} · ${esc(ev.sede || 'Club Náutico Bariloche')}<br>
    Lago Nahuel Huapi — San Carlos de Bariloche, Río Negro, Argentina
  </div>
  ${secciones}
  <footer class="doc-foot">
    <p>Documento generado por el Sistema de Regatas del Club Náutico Bariloche.
    Estructura conforme al Apéndice J del RRV ${RRV_CICLO} de World Sailing y a las
    Prescripciones de la Federación Argentina de Yachting.</p>
    <p>${esc(ev.codigo || '')} · versión ${opciones.version || 1} ·
    ${new Date().toLocaleDateString('es-AR')}</p>
  </footer>
</article>`;
  }

  return {
    RRV_CICLO,
    avisoDeRegata,
    instruccionesDeRegata,
    renderHTML,
    fechaLarga, rangoFechas, nombreSistema
  };
});
