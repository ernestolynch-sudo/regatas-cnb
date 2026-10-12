// ============================================================================
// recuperar-pin-timonel — Edge Function (Supabase)
// ----------------------------------------------------------------------------
// Un timonel que olvidó su PIN lo recupera solo, sin correo de por medio y sin
// tener que escribirle a nadie: ingresa su correo, su DNI y el PIN nuevo que
// quiere. Si el par correo + DNI coincide con alguna inscripción suya, le
// dejamos ese PIN activo en el acto.
//
// Por qué corre del lado del servidor: cambiar la clave de una cuenta exige la
// API de administración de Supabase, que usa la service_role key — una clave
// que NUNCA puede estar en el navegador. Y la verificación del DNI tiene que
// hacerse acá por el mismo motivo: si la hiciera el front, cualquiera la saltea.
//
// ADVERTENCIA DE DISEÑO (decisión de la Comisión, 10/2026): alcanza con saber
// el correo y el DNI del timonel para quedarse con el acceso a SU inscripción.
// Es deliberado — se eligió agilidad sobre rigor, porque el dato protegido es la
// propia inscripción del socio. Lo que sí se hace acá para que no sea gratis:
//   · se limita la cantidad de intentos por correo y por IP (fuerza bruta sobre
//     un DNI de 8 dígitos sería trivial sin esto);
//   · el mensaje de error es siempre el mismo, así no sirve para averiguar si
//     un correo está inscripto o no;
//   · queda registro de cada intento en public.intentos_pin.
// ==========================================================================*/
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Ventana y topes del límite de intentos.
const VENTANA_MIN = 60;
const TOPE_EMAIL = 5;    // fallidos por correo
const TOPE_IP = 20;      // intentos por IP (varias personas pueden salir por la misma)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** DNI comparable: sin puntos, espacios ni guiones, en mayúsculas (pasaportes). */
function normalizarDni(v: unknown): string {
  return String(v ?? '').replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

/**
 * Busca la cuenta por correo recorriendo las páginas de listUsers.
 * La API de administración no tiene "traeme el usuario con este email", y
 * pedir una sola página deja afuera a cualquiera que caiga más allá del tope.
 */
async function buscarUsuario(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const u = data.users.find((x) => (x.email || '').toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 200) return null;   // última página
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Mismo texto para "DNI que no coincide", "correo sin inscripciones" y
  // "inscripción vieja sin DNI cargado": que no se pueda deducir nada.
  const GENERICO = 'No pudimos verificar esos datos. Revisá que el correo sea el mismo con el que ' +
    'te inscribiste y que el DNI sea el del timonel. Si te inscribiste antes de que pidiéramos el ' +
    'DNI, escribile a la Comisión y te generan el PIN en el momento.';

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // ---- 1. Datos de entrada --------------------------------------------
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const dni = normalizarDni(body.dni);
    const pin = String(body.pin || '').trim();

    if (!email || !email.includes('@')) return json({ error: 'Ingresá un correo válido.' }, 400);
    if (dni.length < 6) return json({ error: 'Ingresá el número de DNI o pasaporte del timonel.' }, 400);
    if (!/^\d{6}$/.test(pin)) return json({ error: 'El PIN nuevo tiene que ser de 6 dígitos.' }, 400);

    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
    const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();

    // ---- 2. Límite de intentos ------------------------------------------
    // Sin esto, probar los 8 dígitos de un DNI contra un correo conocido es
    // cuestión de minutos.
    const { count: fallidosEmail } = await admin
      .from('intentos_pin').select('id', { count: 'exact', head: true })
      .eq('email', email).eq('exito', false).gte('created_at', desde);

    if ((fallidosEmail ?? 0) >= TOPE_EMAIL) {
      return json({ error: 'Demasiados intentos con este correo. Probá de nuevo en una hora, ' +
        'o escribile a la Comisión y te generan el PIN en el momento.' }, 429);
    }

    if (ip) {
      const { count: desdeIp } = await admin
        .from('intentos_pin').select('id', { count: 'exact', head: true })
        .eq('ip', ip).gte('created_at', desde);
      if ((desdeIp ?? 0) >= TOPE_IP) {
        return json({ error: 'Demasiados intentos desde esta conexión. Probá más tarde.' }, 429);
      }
    }

    const registrar = (exito: boolean) =>
      admin.from('intentos_pin').insert({ email, ip, exito });

    // ---- 3. ¿El correo y el DNI son de la misma inscripción? -------------
    // La service_role pasa por encima del RLS, así que se consulta directo.
    // El filtro va con ilike porque los correos pueden estar guardados con
    // mayusculas, pero despues se compara exacto en JS: en un patron LIKE el '_'
    // es un comodin de un caracter, y los correos con guion bajo son comunes
    // (juan_perez@... tambien matchearia juanXperez@...).
    const { data: insc, error: errInsc } = await admin
      .from('inscripciones').select('timonel_email, timonel_dni').ilike('timonel_email', email);
    if (errInsc) return json({ error: errInsc.message }, 500);

    const coincide = (insc || []).some((i) => {
      if ((i.timonel_email || '').toLowerCase() !== email) return false;
      const d = normalizarDni(i.timonel_dni);
      return d.length >= 6 && d === dni;
    });

    if (!coincide) {
      await registrar(false);
      return json({ error: GENERICO }, 403);
    }

    // ---- 4. Dejarle el PIN nuevo ----------------------------------------
    // Si nunca tuvo cuenta (se inscribió antes de que existiera el PIN), se crea.
    const existente = await buscarUsuario(admin, email);
    if (existente) {
      const { error } = await admin.auth.admin.updateUserById(existente.id, {
        password: pin, email_confirm: true,
      });
      if (error) return json({ error: error.message }, 500);
    } else {
      const { error } = await admin.auth.admin.createUser({
        email, password: pin, email_confirm: true,
      });
      if (error) return json({ error: error.message }, 500);
    }

    await registrar(true);
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message || 'Error inesperado.' }, 500);
  }
});
