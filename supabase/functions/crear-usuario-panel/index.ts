// ============================================================================
// crear-usuario-panel — Edge Function (Supabase)
// ----------------------------------------------------------------------------
// Da de alta a un integrante de la Comisión con un PIN provisorio, sin depender
// del correo: el admin le pasa el PIN en mano y el usuario después lo cambia por
// el que quiera desde el panel.
//
// Por qué hace falta esto: estar en `usuarios_autorizados` sólo habilita el
// permiso dentro de la app, pero no crea la cuenta de acceso. Crearla requiere
// la API de administración de Supabase, que usa la service_role key — una clave
// que NUNCA puede estar en el navegador. Por eso corre acá, del lado del
// servidor, y valida que quien llama sea admin antes de hacer nada.
//
// Si el usuario ya tenía cuenta, le deja el PIN provisorio nuevo: sirve también
// como "resetear PIN" cuando alguien se lo olvida.
// ==========================================================================*/
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLES = ['admin', 'comision', 'oficial', 'secretaria'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // ---- 1. Quién llama --------------------------------------------------
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    if (!token) return json({ error: 'Falta la sesión.' }, 401);

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user?.email) return json({ error: 'Sesión inválida.' }, 401);
    const emailQuienLlama = userData.user.email.toLowerCase();

    // ---- 2. ¿Es admin? ---------------------------------------------------
    const { data: quien } = await admin
      .from('usuarios_autorizados')
      .select('rol, activo')
      .ilike('email', emailQuienLlama)
      .maybeSingle();

    if (!quien || !quien.activo || quien.rol !== 'admin') {
      return json({ error: 'Sólo un administrador puede crear usuarios del panel.' }, 403);
    }

    // ---- 3. Validaciones -------------------------------------------------
    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const nombre = String(body.nombre || '').trim();
    const rol = String(body.rol || '');
    const pin = String(body.pin || '').trim();

    if (!email || !email.includes('@')) return json({ error: 'Ingresá un correo válido.' }, 400);
    if (!/^\d{6}$/.test(pin)) return json({ error: 'El PIN provisorio debe tener 6 dígitos.' }, 400);
    if (!ROLES.includes(rol)) return json({ error: 'Rol inválido.' }, 400);

    // ---- 4. Crear la cuenta (o resetear el PIN si ya existía) ------------
    const { data: lista, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) return json({ error: listErr.message }, 500);

    const existente = lista.users.find((u) => (u.email || '').toLowerCase() === email);
    let creado = false;

    if (existente) {
      const { error } = await admin.auth.admin.updateUserById(existente.id, {
        password: pin,
        email_confirm: true,
      });
      if (error) return json({ error: error.message }, 500);
    } else {
      const { error } = await admin.auth.admin.createUser({
        email,
        password: pin,
        email_confirm: true,
      });
      if (error) return json({ error: error.message }, 500);
      creado = true;
    }

    // ---- 5. Permisos dentro de la app -----------------------------------
    const { error: upErr } = await admin
      .from('usuarios_autorizados')
      .upsert({ email, nombre: nombre || email, rol, activo: true }, { onConflict: 'email' });
    if (upErr) return json({ error: upErr.message }, 500);

    return json({ ok: true, email, creado });
  } catch (e) {
    return json({ error: (e as Error).message || 'Error inesperado.' }, 500);
  }
});
