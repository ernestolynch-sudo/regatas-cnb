-- ============================================================================
-- SISTEMA DE GESTIÓN DE REGATAS — CLUB NÁUTICO BARILOCHE
-- Comisión de Vela y Motor (CVM)
-- Esquema Supabase / PostgreSQL — idempotente (se puede correr varias veces)
-- ============================================================================
-- Convenciones:
--   * Todas las tablas llevan prefijo lógico del dominio "regatas".
--   * Tiempos de regata se guardan en SEGUNDOS (integer) para evitar problemas
--     de zona horaria y de precisión en los cálculos de tiempo corregido.
--   * Los horarios de evento se guardan como date + time local (America/Argentina/Salta,
--     UTC-3 sin DST) porque una regata se programa en hora local, no en UTC.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSIONES Y UTILIDADES
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 1. USUARIOS AUTORIZADOS (Comisión de Vela y Motor)
-- ---------------------------------------------------------------------------
create table if not exists public.usuarios_autorizados (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  nombre      text not null,
  rol         text not null default 'comision'
              check (rol in ('admin','comision','oficial','secretaria')),
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.usuarios_autorizados is
  'Whitelist de emails habilitados a operar el panel. rol: admin (todo, incl. usuarios) / comision (ABM eventos y resultados) / oficial (carga de llegadas) / secretaria (inscripciones y cobros).';

-- Helpers de autorización -----------------------------------------------------
create or replace function public.es_usuario_habilitado()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios_autorizados u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email',''))
      and u.activo
  );
$$;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios_autorizados u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email',''))
      and u.activo and u.rol = 'admin'
  );
$$;

-- comision: ABM de eventos, clases, temporadas, documentos y checklist
create or replace function public.es_comision()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios_autorizados u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email',''))
      and u.activo and u.rol in ('admin','comision')
  );
$$;

-- oficial: carga de pruebas y resultados (además de comision/admin)
create or replace function public.es_oficial()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios_autorizados u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email',''))
      and u.activo and u.rol in ('admin','comision','oficial')
  );
$$;

-- secretaria: gestión de inscripciones y cobros (además de comision/admin)
create or replace function public.es_secretaria()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios_autorizados u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email',''))
      and u.activo and u.rol in ('admin','comision','secretaria')
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. TEMPORADAS
-- ---------------------------------------------------------------------------
create table if not exists public.temporadas (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null unique,          -- '2026-2027'
  fecha_inicio date not null,
  fecha_fin    date not null,
  activa       boolean not null default false,
  notas        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. CLASES / FLOTAS
-- ---------------------------------------------------------------------------
create table if not exists public.clases (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,           -- OPT, ILCA7, SNI, PAM, CRU-A
  nombre      text not null,                  -- Optimist, ILCA 7, Snipe, Pampero, Crucero A
  tipo        text not null default 'monotipo'
              check (tipo in ('monotipo','handicap')),
  categoria   text,                           -- 'Juvenil', 'Adulto', 'Crucero'
  tripulacion smallint default 1,
  orden       smallint not null default 100,  -- orden de largada / listado
  activa      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. EVENTOS (regatas, campeonatos, travesías, clínicas)
-- ---------------------------------------------------------------------------
create table if not exists public.eventos (
  id            uuid primary key default gen_random_uuid(),
  temporada_id  uuid not null references public.temporadas(id) on delete restrict,
  codigo        text not null unique,            -- REG-2627-01
  nombre        text not null,
  tipo          text not null default 'regata'
                check (tipo in ('regata','campeonato','travesia','clinica','escuela','social','motor')),
  campeonato    text,                            -- serie a la que puntúa, si aplica
  puntuable     boolean not null default true,

  fecha_inicio  date not null,
  fecha_fin     date not null,
  hora_briefing time,
  hora_senal_atencion time,                      -- primera señal de atención

  sede          text not null default 'Club Náutico Bariloche',
  area_regata   text,                            -- 'Bahía del Club / Puerto San Carlos'
  canal_vhf     text default '71',

  autoridad_organizadora text not null default 'Club Náutico Bariloche — Comisión de Vela y Motor',
  oficial_principal      text,                   -- Oficial Principal de Regata (OPR)
  comite_regata          text,
  comite_protestas       text,

  estado        text not null default 'borrador'
                check (estado in ('borrador','publicado','inscripcion_abierta','inscripcion_cerrada','en_curso','finalizado','suspendido','cancelado')),

  inscripcion_apertura timestamptz,
  inscripcion_cierre   timestamptz,
  cupo                 smallint,
  arancel_socio        numeric(12,2) default 0,
  arancel_invitado     numeric(12,2) default 0,
  datos_pago           text,                     -- CBU / alias / instrucciones

  descripcion   text,
  premios       text,
  contacto_nombre text,
  contacto_email  text,
  contacto_tel    text,

  creado_por    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint eventos_fechas_ok check (fecha_fin >= fecha_inicio)
);

create index if not exists idx_eventos_temporada on public.eventos(temporada_id);
create index if not exists idx_eventos_fecha     on public.eventos(fecha_inicio);
create index if not exists idx_eventos_estado    on public.eventos(estado);

-- ---------------------------------------------------------------------------
-- 5. CLASES PARTICIPANTES POR EVENTO (define el sistema de puntaje por flota)
-- ---------------------------------------------------------------------------
create table if not exists public.evento_clases (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references public.eventos(id) on delete cascade,
  clase_id      uuid not null references public.clases(id) on delete restrict,

  -- Sistema de corrección de tiempos
  sistema       text not null default 'monotipo'
                check (sistema in ('monotipo','tot_phrf','tot_factor','tod')),
  -- Coeficientes PHRF Tiempo sobre Tiempo:  TCF = phrf_b / (phrf_a + Rating)
  phrf_a        numeric(10,3) default 550,
  phrf_b        numeric(10,3) default 650,

  -- Puntaje (Apéndice A RRV — Sistema de Puntuación Baja)
  pruebas_previstas smallint default 3,
  pruebas_minimas   smallint default 1,      -- mínimo de pruebas válidas para constituir serie
  descarte_desde    smallint default 4,      -- se descarta 1 al completar N pruebas válidas (0 = sin descarte)
  descarte_cada     smallint default 4,      -- 1 descarte adicional cada N pruebas
  descartes_max     smallint default 2,

  bandera_clase text,                         -- bandera de clase para la señal de atención
  orden_largada smallint default 1,
  created_at    timestamptz not null default now(),
  unique (evento_id, clase_id)
);

create index if not exists idx_evento_clases_evento on public.evento_clases(evento_id);

-- ---------------------------------------------------------------------------
-- 6. AVISO DE REGATA / INSTRUCCIONES DE REGATA (Apéndice J RRV)
-- ---------------------------------------------------------------------------
create table if not exists public.documentos_regata (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references public.eventos(id) on delete cascade,
  tipo          text not null check (tipo in ('aviso','instrucciones','anexo','resultado','comunicado')),
  version       smallint not null default 1,
  titulo        text not null,
  contenido     jsonb not null default '{}'::jsonb,  -- secciones estructuradas del documento
  html          text,                                 -- render congelado al publicar
  publicado     boolean not null default false,
  fecha_publicacion timestamptz,
  url_archivo   text,                                 -- PDF en Storage, si se sube
  creado_por    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (evento_id, tipo, version)
);

create index if not exists idx_docs_evento on public.documentos_regata(evento_id);

-- ---------------------------------------------------------------------------
-- 7. INSCRIPCIONES (alta pública por link/QR, revisión por la comisión)
-- ---------------------------------------------------------------------------
create table if not exists public.inscripciones (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references public.eventos(id) on delete cascade,
  clase_id      uuid not null references public.clases(id) on delete restrict,
  folio         text,                              -- correlativo legible, lo asigna un trigger

  -- Embarcación
  nombre_barco  text not null,
  num_vela      text not null,
  modelo        text,
  club          text default 'Club Náutico Bariloche',
  codigo_flota  text,                              -- código del registro de flota CNB (ej: OPT-C-001)
  rating        numeric(10,3),                     -- PHRF s/milla (handicap) — null en monotipo
  rating_origen text,                              -- 'CNB', 'FAY', 'ORC', 'provisorio'
  matricula_rey text,                              -- matrícula naval (REY), si la tiene — sólo PHRF/handicap

  -- Timonel / responsable
  timonel_nombre     text not null,
  timonel_dni        text,
  timonel_nacimiento date,
  timonel_email      text not null,
  timonel_tel        text not null,
  timonel_licencia_fay text,
  timonel_socio      boolean not null default true,

  -- Tripulación: [{nombre, dni, nacimiento, licencia}]
  tripulantes   jsonb not null default '[]'::jsonb,

  -- Seguridad / legal
  emergencia_nombre  text,
  emergencia_tel     text,
  seguro_compania    text,
  seguro_poliza      text,
  seguro_vencimiento date,
  -- El seguro es opcional para competir; obligatorio sólo para quien pida amarra de
  -- cortesía o ingreso al fondeadero del Club (ver Aviso de Regata, punto 16).
  solicita_amarra_cortesia boolean not null default false,

  -- Documentos adjuntos (Supabase Storage, bucket 'inscripciones-docs')
  seguro_archivo_path       text,   -- constancia de seguro (PDF/foto) — obligatoria si solicita_amarra_cortesia
  tripulantes_archivo_path  text,   -- listado de tripulantes firmado (PDF) — opcional
  comprobante_pago_path     text,   -- comprobante de pago del arancel (PDF/foto) — obligatorio
  carnet_archivo_path       text,   -- foto del carnet de timonel — opcional
  licencia_fay_archivo_path text,   -- foto de la licencia deportiva FAY — opcional

  acepta_rrv         boolean not null default false,
  acepta_riesgo      boolean not null default false,   -- Regla 3 RRV — Decisión de regatear
  autoriza_menor     boolean not null default false,   -- autorización del responsable legal si el timonel es menor

  observaciones text,

  -- Gestión
  estado        text not null default 'pendiente'
                check (estado in ('pendiente','confirmada','rechazada','lista_espera','retirada')),
  pago_estado   text not null default 'impago'
                check (pago_estado in ('impago','pagado','exento')),
  monto         numeric(12,2),
  titular_transferencia text,  -- nombre del titular de la transferencia, si no es el timonel
                               -- (para poder alocar el pago cuando paga otro tripulante)
  motivo_rechazo text,
  revisado_por  text,
  revisado_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (evento_id, clase_id, num_vela)
);

-- 'create table if not exists' no modifica una tabla que ya existía antes de que se
-- agregaran estas columnas — se agregan explícitamente para que la migración sea
-- idempotente también sobre bases ya provisionadas con una versión anterior del esquema.
alter table public.inscripciones add column if not exists seguro_archivo_path       text;
alter table public.inscripciones add column if not exists tripulantes_archivo_path  text;
alter table public.inscripciones add column if not exists comprobante_pago_path     text;
alter table public.inscripciones add column if not exists carnet_archivo_path       text;
alter table public.inscripciones add column if not exists licencia_fay_archivo_path text;
alter table public.inscripciones add column if not exists matricula_rey             text;
alter table public.inscripciones add column if not exists solicita_amarra_cortesia  boolean not null default false;
alter table public.inscripciones add column if not exists titular_transferencia     text;

create index if not exists idx_insc_evento on public.inscripciones(evento_id);
create index if not exists idx_insc_estado on public.inscripciones(estado);

-- Folio correlativo por evento: CNB-<codigo evento>-0001
create or replace function public.asignar_folio_inscripcion()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer; cod text;
begin
  if new.folio is null then
    select count(*) + 1 into n from public.inscripciones where evento_id = new.evento_id;
    select codigo into cod from public.eventos where id = new.evento_id;
    new.folio := cod || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_folio_inscripcion on public.inscripciones;
create trigger trg_folio_inscripcion before insert on public.inscripciones
  for each row execute function public.asignar_folio_inscripcion();

-- El propio timonel puede editar su inscripción (ver RLS insc_update_propio) pero
-- NUNCA los campos de gestión de la Comisión: si quien edita no es secretaria/comision/
-- admin, estos campos quedan fijos en su valor anterior pase lo que pase en el UPDATE.
create or replace function public.proteger_campos_gestion_inscripcion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.es_secretaria() then
    new.evento_id      := old.evento_id;
    new.clase_id       := old.clase_id;
    new.folio          := old.folio;
    new.timonel_email  := old.timonel_email;
    new.estado         := old.estado;
    new.pago_estado    := old.pago_estado;
    new.monto          := old.monto;
    new.motivo_rechazo := old.motivo_rechazo;
    new.revisado_por   := old.revisado_por;
    new.revisado_at    := old.revisado_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_proteger_campos_gestion on public.inscripciones;
create trigger trg_proteger_campos_gestion before update on public.inscripciones
  for each row execute function public.proteger_campos_gestion_inscripcion();

-- Alta pública vía RPC: hace el INSERT como security definer (bypasea RLS, corre con
-- los privilegios del dueño de la función) y devuelve sólo folio/num_vela. Necesario
-- porque Postgres exige permiso de SELECT para el RETURNING de un INSERT normal, y no
-- queremos abrirle lectura de toda la tabla (con emails, DNI, etc.) al público. Repite
-- a mano las mismas condiciones que insc_insert_publico, porque al bypasear RLS ya no
-- se validan solas.
create or replace function public.crear_inscripcion_publica(p jsonb)
returns table(folio text, num_vela text)
language plpgsql security definer set search_path = public as $$
declare
  v_evento_id uuid := (p->>'evento_id')::uuid;
  v_abierto boolean;
  v_row public.inscripciones;
begin
  select exists (
    select 1 from public.eventos e
    where e.id = v_evento_id
      and e.estado = 'inscripcion_abierta'
      and (e.inscripcion_apertura is null or now() >= e.inscripcion_apertura)
      and (e.inscripcion_cierre  is null or now() <= e.inscripcion_cierre)
  ) into v_abierto;

  if not v_abierto then
    raise exception 'La inscripción a este evento no está abierta.';
  end if;
  if coalesce((p->>'acepta_rrv')::boolean, false) is not true
     or coalesce((p->>'acepta_riesgo')::boolean, false) is not true then
    raise exception 'Debés aceptar el Reglamento y la declaración de riesgo.';
  end if;
  if coalesce((p->>'solicita_amarra_cortesia')::boolean, false)
     and coalesce(p->>'seguro_archivo_path','') = '' then
    raise exception 'La constancia de seguro es obligatoria para solicitar amarra de cortesía o el ingreso al fondeadero.';
  end if;

  insert into public.inscripciones (
    evento_id, clase_id, nombre_barco, num_vela, modelo, club, codigo_flota,
    rating, rating_origen, matricula_rey,
    timonel_nombre, timonel_dni, timonel_nacimiento, timonel_email, timonel_tel,
    timonel_licencia_fay, timonel_socio, tripulantes,
    emergencia_nombre, emergencia_tel, solicita_amarra_cortesia,
    seguro_compania, seguro_poliza, seguro_vencimiento,
    seguro_archivo_path, tripulantes_archivo_path, comprobante_pago_path,
    carnet_archivo_path, licencia_fay_archivo_path,
    acepta_rrv, acepta_riesgo, autoriza_menor, observaciones,
    estado, pago_estado, monto, titular_transferencia
  ) values (
    v_evento_id, (p->>'clase_id')::uuid, p->>'nombre_barco', p->>'num_vela',
    p->>'modelo', p->>'club', p->>'codigo_flota',
    nullif(p->>'rating','')::numeric, p->>'rating_origen', p->>'matricula_rey',
    p->>'timonel_nombre', p->>'timonel_dni', nullif(p->>'timonel_nacimiento','')::date,
    p->>'timonel_email', p->>'timonel_tel',
    p->>'timonel_licencia_fay', coalesce((p->>'timonel_socio')::boolean, true),
    coalesce(p->'tripulantes', '[]'::jsonb),
    p->>'emergencia_nombre', p->>'emergencia_tel', coalesce((p->>'solicita_amarra_cortesia')::boolean, false),
    p->>'seguro_compania', p->>'seguro_poliza', nullif(p->>'seguro_vencimiento','')::date,
    p->>'seguro_archivo_path', p->>'tripulantes_archivo_path', p->>'comprobante_pago_path',
    p->>'carnet_archivo_path', p->>'licencia_fay_archivo_path',
    true, true, coalesce((p->>'autoriza_menor')::boolean, false), p->>'observaciones',
    'pendiente', 'impago', nullif(p->>'monto','')::numeric, p->>'titular_transferencia'
  )
  returning * into v_row;

  return query select v_row.folio, v_row.num_vela;
end;
$$;

grant execute on function public.crear_inscripcion_publica(jsonb) to anon;

-- ---------------------------------------------------------------------------
-- 8. PRUEBAS (cada "race" dentro del evento, por clase)
-- ---------------------------------------------------------------------------
create table if not exists public.pruebas (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references public.eventos(id) on delete cascade,
  clase_id      uuid references public.clases(id) on delete restrict,  -- null = todas las clases juntas
  numero        smallint not null,
  fecha         date,
  hora_largada  time,                       -- señal de largada (regla 26 RRV)
  recorrido     text,                       -- 'Barlovento-Sotavento 2 vueltas'
  distancia_mn  numeric(8,3),               -- millas náuticas (necesario para ToD)
  viento_dir    text,
  viento_nudos  numeric(5,1),
  tiempo_limite_min smallint,
  estado        text not null default 'programada'
                check (estado in ('programada','valida','anulada','no_corrida','postergada')),
  notas         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (evento_id, clase_id, numero)
);

create index if not exists idx_pruebas_evento on public.pruebas(evento_id);

-- ---------------------------------------------------------------------------
-- 9. RESULTADOS / LLEGADAS
-- ---------------------------------------------------------------------------
create table if not exists public.resultados (
  id              uuid primary key default gen_random_uuid(),
  prueba_id       uuid not null references public.pruebas(id) on delete cascade,
  inscripcion_id  uuid not null references public.inscripciones(id) on delete cascade,

  hora_largada    time,          -- si la clase largó con horario propio
  hora_llegada    time,
  tiempo_real_s   integer,       -- tiempo navegado en segundos (calculado o cargado a mano)
  tiempo_corregido_s numeric(12,3), -- lo calcula la app según el sistema de la clase

  codigo          text not null default 'OK'
                  check (codigo in ('OK','DNC','DNS','OCS','UFD','BFD','ZFP','DNF','RET','DSQ','DNE','DGM','RDG','DPI','SCP','NSC')),
  puesto          smallint,      -- puesto en la prueba (lo calcula la app)
  puntos          numeric(8,2),  -- puntaje de la prueba (lo calcula la app)
  puntos_manual   numeric(8,2),  -- reparación (RDG) o puntaje impuesto por el jurado
  notas           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (prueba_id, inscripcion_id)
);

create index if not exists idx_res_prueba on public.resultados(prueba_id);

-- ---------------------------------------------------------------------------
-- 10. CHECKLIST ORGANIZATIVO DEL EVENTO
-- ---------------------------------------------------------------------------
create table if not exists public.tareas_evento (
  id           uuid primary key default gen_random_uuid(),
  evento_id    uuid not null references public.eventos(id) on delete cascade,
  bloque       text not null default 'General',   -- Previa / Logística / Agua / Tierra / Difusión / Cierre
  descripcion  text not null,
  responsable  text,
  vence        date,
  hecho        boolean not null default false,
  orden        smallint default 100,
  created_at   timestamptz not null default now()
);

create index if not exists idx_tareas_evento on public.tareas_evento(evento_id);

-- ---------------------------------------------------------------------------
-- 11. TRIGGERS updated_at
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['temporadas','eventos','documentos_regata','inscripciones','pruebas','resultados']
  loop
    execute format('drop trigger if exists trg_updated_%1$s on public.%1$s', t);
    execute format('create trigger trg_updated_%1$s before update on public.%1$s
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 12. VISTA PÚBLICA DE INSCRIPTOS (sin datos personales sensibles)
-- ---------------------------------------------------------------------------
create or replace view public.v_inscriptos_publico as
select i.id,
       i.evento_id,
       i.clase_id,
       i.folio,
       i.nombre_barco,
       i.num_vela,
       i.modelo,
       i.club,
       i.rating,
       i.timonel_nombre,
       i.estado
from public.inscripciones i
join public.eventos e on e.id = i.evento_id
where e.estado <> 'borrador'
  and i.estado in ('confirmada','lista_espera');

-- ---------------------------------------------------------------------------
-- 13. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.usuarios_autorizados enable row level security;
alter table public.temporadas           enable row level security;
alter table public.clases               enable row level security;
alter table public.eventos              enable row level security;
alter table public.evento_clases        enable row level security;
alter table public.documentos_regata    enable row level security;
alter table public.inscripciones        enable row level security;
alter table public.pruebas              enable row level security;
alter table public.resultados           enable row level security;
alter table public.tareas_evento        enable row level security;

-- --- usuarios_autorizados ---------------------------------------------------
drop policy if exists ua_select on public.usuarios_autorizados;
create policy ua_select on public.usuarios_autorizados
  for select to authenticated using (public.es_usuario_habilitado());

drop policy if exists ua_write on public.usuarios_autorizados;
create policy ua_write on public.usuarios_autorizados
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- --- catálogos: lectura pública --------------------------------------------
drop policy if exists temporadas_read on public.temporadas;
create policy temporadas_read on public.temporadas for select to anon, authenticated using (true);
drop policy if exists temporadas_write on public.temporadas;
create policy temporadas_write on public.temporadas for all to authenticated
  using (public.es_comision()) with check (public.es_comision());

drop policy if exists clases_read on public.clases;
create policy clases_read on public.clases for select to anon, authenticated using (true);
drop policy if exists clases_write on public.clases;
create policy clases_write on public.clases for all to authenticated
  using (public.es_comision()) with check (public.es_comision());

-- --- eventos: público ve todo lo que no es borrador ------------------------
drop policy if exists eventos_read on public.eventos;
create policy eventos_read on public.eventos for select to anon, authenticated
  using (estado <> 'borrador' or public.es_usuario_habilitado());
drop policy if exists eventos_write on public.eventos;
create policy eventos_write on public.eventos for all to authenticated
  using (public.es_comision()) with check (public.es_comision());

drop policy if exists ec_read on public.evento_clases;
create policy ec_read on public.evento_clases for select to anon, authenticated using (true);
drop policy if exists ec_write on public.evento_clases;
create policy ec_write on public.evento_clases for all to authenticated
  using (public.es_comision()) with check (public.es_comision());

-- --- documentos: público ve solo los publicados ----------------------------
drop policy if exists docs_read on public.documentos_regata;
create policy docs_read on public.documentos_regata for select to anon, authenticated
  using (publicado or public.es_usuario_habilitado());
drop policy if exists docs_write on public.documentos_regata;
create policy docs_write on public.documentos_regata for all to authenticated
  using (public.es_comision()) with check (public.es_comision());

-- --- inscripciones: ALTA PÚBLICA controlada --------------------------------
-- El anónimo puede INSERTAR solo si el evento tiene la inscripción abierta y
-- dentro del plazo, y solo en estado 'pendiente'/'impago'. No puede leer ni editar.
drop policy if exists insc_insert_publico on public.inscripciones;
create policy insc_insert_publico on public.inscripciones for insert to anon, authenticated
  with check (
    estado = 'pendiente'
    and pago_estado = 'impago'
    and acepta_rrv = true
    and acepta_riesgo = true
    and exists (
      select 1 from public.eventos e
      where e.id = evento_id
        and e.estado = 'inscripcion_abierta'
        and (e.inscripcion_apertura is null or now() >= e.inscripcion_apertura)
        and (e.inscripcion_cierre  is null or now() <= e.inscripcion_cierre)
    )
  );

drop policy if exists insc_read_comision on public.inscripciones;
create policy insc_read_comision on public.inscripciones for select to authenticated
  using (public.es_usuario_habilitado());

drop policy if exists insc_write_comision on public.inscripciones;
create policy insc_write_comision on public.inscripciones for all to authenticated
  using (public.es_secretaria()) with check (public.es_secretaria());

-- --- inscripciones: AUTOSERVICIO del timonel (solo su propio email) --------
-- Cualquier persona autenticada (magic link, no requiere estar en usuarios_autorizados)
-- puede ver únicamente las inscripciones donde figura como timonel, y editarlas sólo
-- mientras estén 'pendiente'. El trigger trg_proteger_campos_gestion impide que toque
-- estado, pago, folio, evento/clase o el email dueño aunque los incluya en el UPDATE.
drop policy if exists insc_select_propio on public.inscripciones;
create policy insc_select_propio on public.inscripciones for select to authenticated
  using (lower(timonel_email) = lower(coalesce(auth.jwt() ->> 'email','')));

drop policy if exists insc_update_propio on public.inscripciones;
create policy insc_update_propio on public.inscripciones for update to authenticated
  using (estado = 'pendiente' and lower(timonel_email) = lower(coalesce(auth.jwt() ->> 'email','')))
  with check (lower(timonel_email) = lower(coalesce(auth.jwt() ->> 'email','')));

-- --- pruebas y resultados: lectura pública ---------------------------------
drop policy if exists pruebas_read on public.pruebas;
create policy pruebas_read on public.pruebas for select to anon, authenticated using (true);
drop policy if exists pruebas_write on public.pruebas;
create policy pruebas_write on public.pruebas for all to authenticated
  using (public.es_oficial()) with check (public.es_oficial());

drop policy if exists resultados_read on public.resultados;
create policy resultados_read on public.resultados for select to anon, authenticated using (true);
drop policy if exists resultados_write on public.resultados;
create policy resultados_write on public.resultados for all to authenticated
  using (public.es_oficial()) with check (public.es_oficial());

-- --- checklist: solo comisión ----------------------------------------------
drop policy if exists tareas_all on public.tareas_evento;
create policy tareas_all on public.tareas_evento for all to authenticated
  using (public.es_comision()) with check (public.es_comision());

-- Vista pública de inscriptos (security_invoker para que respete RLS del anon
-- no aplica: la vista se expone explícitamente como de solo lectura pública)
alter view public.v_inscriptos_publico set (security_invoker = off);
grant select on public.v_inscriptos_publico to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14. DATOS INICIALES
-- ---------------------------------------------------------------------------
insert into public.temporadas (nombre, fecha_inicio, fecha_fin, activa)
values ('2026-2027', '2026-09-01', '2027-05-31', true)
on conflict (nombre) do nothing;

insert into public.clases (codigo, nombre, tipo, categoria, tripulacion, orden) values
  ('OPT',    'Optimist',            'monotipo', 'Juvenil',  1, 10),
  ('OPT-P',  'Optimist Principiantes','monotipo','Juvenil', 1, 15),
  ('ILCA4',  'ILCA 4 (Laser 4.7)',  'monotipo', 'Juvenil',  1, 20),
  ('ILCA6',  'ILCA 6 (Laser Radial)','monotipo','Adulto',   1, 25),
  ('ILCA7',  'ILCA 7 (Laser Std.)', 'monotipo', 'Adulto',   1, 30),
  ('SNI',    'Snipe',               'monotipo', 'Adulto',   2, 40),
  ('PAM',    'Pampero',             'monotipo', 'Adulto',   2, 50),
  ('CRU-A',  'Crucero A (PHRF)',    'handicap', 'Crucero',  4, 60),
  ('CRU-B',  'Crucero B (PHRF)',    'handicap', 'Crucero',  4, 70),
  ('LIBRE',  'Clase Libre / Handicap','handicap','Adulto',  2, 80)
on conflict (codigo) do nothing;

-- IMPORTANTE: cargar acá el email de cada integrante de la comisión.
insert into public.usuarios_autorizados (email, nombre, rol) values
  ('ernesto.lynch@buritec.com.ar', 'Ernesto Lynch', 'admin'),
  ('escuelaclubnauticobariloche@gmail.com', 'Escuela Club Náutico Bariloche', 'comision')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- 15. STORAGE: documentos adjuntos a la inscripción
-- (constancia de seguro, listado de tripulantes, comprobante de pago)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inscripciones-docs', 'inscripciones-docs', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/heic','image/webp'])
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Convención de rutas: '<inscripcion_id>/<tipo>.<ext>' para todo lo subido después del
-- alta (autoservicio del timonel o reemplazo por la Comisión). El alta pública inicial
-- (antes de que exista la fila) sube a una carpeta aleatoria — ver insc_docs_insert_anon.
create or replace function public.es_dueno_inscripcion(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.inscripciones i
    where i.id::text = split_part(p_path, '/', 1)
      and lower(i.timonel_email) = lower(coalesce(auth.jwt() ->> 'email',''))
  );
$$;

create or replace function public.es_dueno_inscripcion_editable(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.inscripciones i
    where i.id::text = split_part(p_path, '/', 1)
      and lower(i.timonel_email) = lower(coalesce(auth.jwt() ->> 'email',''))
      and i.estado = 'pendiente'
  );
$$;

-- Si alguien completa el formulario público de alta estando autenticado (por ejemplo,
-- porque antes entró a "Mi inscripción" en el mismo navegador y quedó la sesión activa),
-- la carpeta aleatoria del adjunto todavía no corresponde a ninguna inscripción real: hay
-- que permitir esa subida igual que a un anónimo. Sólo se exige ser dueño+pendiente cuando
-- la ruta SÍ coincide con una inscripción ya existente (autoservicio post-alta).
create or replace function public.es_ruta_nueva_o_propia_editable(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.inscripciones i where i.id::text = split_part(p_path, '/', 1))
      or public.es_dueno_inscripcion_editable(p_path);
$$;

-- El público (anon) puede SUBIR archivos al enviar el formulario de inscripción,
-- pero no puede leerlos ni listarlos.
drop policy if exists insc_docs_insert_publico on storage.objects;
drop policy if exists insc_docs_insert_anon on storage.objects;
create policy insc_docs_insert_anon on storage.objects for insert to anon
  with check (bucket_id = 'inscripciones-docs');

-- La Comisión (secretaria/comision/admin) puede ver, subir, reemplazar o borrar
-- cualquier documento adjunto.
drop policy if exists insc_docs_insert_comision on storage.objects;
create policy insc_docs_insert_comision on storage.objects for insert to authenticated
  with check (bucket_id = 'inscripciones-docs' and public.es_secretaria());

drop policy if exists insc_docs_read_comision on storage.objects;
create policy insc_docs_read_comision on storage.objects for select to authenticated
  using (bucket_id = 'inscripciones-docs' and public.es_secretaria());

drop policy if exists insc_docs_update_comision on storage.objects;
create policy insc_docs_update_comision on storage.objects for update to authenticated
  using (bucket_id = 'inscripciones-docs' and public.es_secretaria())
  with check (bucket_id = 'inscripciones-docs' and public.es_secretaria());

drop policy if exists insc_docs_delete_comision on storage.objects;
create policy insc_docs_delete_comision on storage.objects for delete to authenticated
  using (bucket_id = 'inscripciones-docs' and public.es_secretaria());

-- El propio timonel puede ver sus documentos siempre, y subir/reemplazar los suyos
-- sólo mientras su inscripción esté 'pendiente'.
drop policy if exists insc_docs_select_propio on storage.objects;
create policy insc_docs_select_propio on storage.objects for select to authenticated
  using (bucket_id = 'inscripciones-docs' and public.es_dueno_inscripcion(name));

drop policy if exists insc_docs_insert_propio on storage.objects;
create policy insc_docs_insert_propio on storage.objects for insert to authenticated
  with check (bucket_id = 'inscripciones-docs' and public.es_ruta_nueva_o_propia_editable(name));

drop policy if exists insc_docs_update_propio on storage.objects;
create policy insc_docs_update_propio on storage.objects for update to authenticated
  using (bucket_id = 'inscripciones-docs' and public.es_dueno_inscripcion_editable(name))
  with check (bucket_id = 'inscripciones-docs' and public.es_dueno_inscripcion_editable(name));

-- ============================================================================
-- FIN DEL ESQUEMA
-- ============================================================================
