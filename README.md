# Sistema de Regatas — Club Náutico Bariloche

Aplicación web para la Comisión de Vela y Motor del CNB: calendario de regatas, generación de
**Avisos de Regata** e **Instrucciones de Regata** conformes al Apéndice J del RRV 2025-2028,
inscripciones en línea por link/QR, carga de llegadas y **cálculo automático de resultados**
(Sistema de Puntuación Baja del Apéndice A + handicap PHRF Tiempo sobre Tiempo).

Stack: HTML/CSS/JS sin build + **Supabase** (Postgres + Auth + RLS) + **Vercel**.
Mismo esquema de trabajo que el Registro de Flota de la Escuela de Vela.

---

## 1. Qué incluye

| Archivo | Función |
|---|---|
| `index.html` + `js/publico.js` | Portal público: calendario, ficha de evento, aviso, instrucciones, inscriptos y resultados. Sin login. |
| `inscripcion.html` + `js/inscripcion.js` | Formulario público de inscripción (link o QR). Sin login. |
| `admin.html` + `js/admin.js` | Panel de la Comisión. Login por *magic link*. |
| `js/scoring.js` | Motor de cálculo: tiempo corregido y puntajes del Apéndice A del RRV. |
| `js/docs.js` | Generadores de Aviso de Regata (J1) e Instrucciones de Regata (J2). |
| `js/db.js` | Cliente Supabase y utilidades (fechas, CSV, ICS, impresión). |
| `supabase/schema.sql` | Esquema completo con Row Level Security. |
| `config.js` | **Único archivo a editar antes del deploy.** |

Test del motor de puntajes: `node js/scoring.test.js` (32 verificaciones).

---

## 2. Criterio técnico de los cálculos

**Corrección de tiempos** (configurable por clase dentro de cada evento):

| Sistema | Fórmula | Uso |
|---|---|---|
| `monotipo` | sin corrección | Optimist, ILCA, Snipe, Pampero |
| `tot_phrf` | `TC = TR × TCF`, con `TCF = B / (A + Rating)` — por defecto **A=550, B=650** | **Cruceros CNB** |
| `tot_factor` | `TC = TR × Factor` | Estilo IRC (TCC declarado) |
| `tod` | `TC = TR − (Rating[s/MN] × Distancia[MN])` | Tiempo sobre Distancia clásico |

Con A=550 y B=650, un barco de rating 100 tiene TCF = 1,000. Bajar `A` endurece la corrección
entre barcos de ratings dispares; subirlo la suaviza. Ambos valores se editan por clase y por evento.

**Puntaje** — Apéndice A del RRV 2025-2028:

- 1º = 1 punto, 2º = 2 puntos, etc. (Puntuación Baja, A4).
- Empate exacto en una prueba: se suman los puntos de los puestos en juego y se reparten (A7).
- No largó / no llegó / descalificado: **inscriptos + 1** (A5).
- Bandera Z (regla 30.2) y penalización de puntaje (44.3c): penalización del 20 % del número de
  inscriptos, redondeada según el RRV, nunca peor que DNF.
- `DNE` y `DGM` **no son descartables**; el resto sí.
- Descartes configurables: «desde N / cada M / máx. K». Ej. 4/4/2 = 1 descarte con 4 pruebas
  válidas, 2 con 8. Siempre computa al menos una prueba.
- Desempates: A8.1 (mejores puntajes computados, sin descartados) y, si persiste, A8.2 (última
  prueba, anteúltima, etc., usando también los descartados).

---

## 3. Puesta en marcha

### 3.1 Crear el proyecto en Supabase

1. Entrar a <https://supabase.com> → **New project**.
   - Nombre: `regatas-cnb` · Región: `South America (São Paulo)` · guardar la contraseña de la base.
2. Esperar a que termine de aprovisionar (1-2 min).
3. Menú **SQL Editor** → **New query** → pegar TODO el contenido de `supabase/schema.sql` → **Run**.
   Debe terminar con `Success. No rows returned`. El script es idempotente: se puede volver a correr.
4. Menú **Project Settings → API** → copiar:
   - **Project URL** → va en `config.js` como `SUPABASE_URL`
   - **anon public** → va en `config.js` como `SUPABASE_ANON_KEY`
   > La `anon key` es pública por diseño. La seguridad la da el RLS. **Nunca** pegar la `service_role`.
5. Menú **Authentication → Providers → Email**: dejar habilitado *Email* y **desactivar
   "Confirm email"** no es necesario; el magic link funciona igual.

### 3.2 Configurar `config.js`

```js
window.CNB_CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',
  ...
};
```

### 3.3 Habilitar a la Comisión

El script ya deja habilitado `ernesto.lynch@buritec.com.ar` como `admin`. Para el resto:
**Table Editor → usuarios_autorizados → Insert row** (email, nombre, rol `comision`), o desde el
propio panel una vez que ingrese el admin (**Configuración → Usuarios habilitados**).

Roles: `admin` (todo, incluye usuarios) · `comision` (eventos y resultados) · `oficial` (llegadas) ·
`secretaria` (inscripciones y cobros).

### 3.4 Deploy a GitHub + Vercel

Con Claude Code, desde la carpeta del proyecto, usar el prompt de
`prompt_claude_code_deploy.md`. Resumen de lo que hace:

```bash
git init && git add -A && git commit -m "Sistema de regatas CNB"
gh repo create regatas-cnb --public --source=. --push
vercel --prod
```

### 3.5 Paso final obligatorio (si no, el login no funciona)

Volver a Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://regatas-cnb.vercel.app` (la URL que devuelva Vercel)
- **Redirect URLs**: agregar `https://regatas-cnb.vercel.app/**`

Sin esto, el magic link redirige a `localhost` y el panel no abre.

---

## 4. Flujo de trabajo de una regata

1. **Panel → Eventos → + Nuevo evento.** Código, nombre, fechas, briefing, 1ª señal de atención,
   área de regatas, VHF, aranceles, cierre de inscripción. Estado inicial: `borrador`.
2. **Pestaña «Clases y puntaje».** Agregar cada clase y definir sistema, coeficientes PHRF,
   pruebas previstas y descartes.
3. **Pestaña «Aviso e Instrucciones» → Generar nueva versión.** Sale el documento completo con los
   datos del evento cargados. Editar sección por sección lo que haga falta y **Publicar**.
4. Pasar el evento a estado **`inscripcion_abierta`** (selector arriba a la derecha).
5. **Pestaña «Difusión».** Copiar el link o imprimir el cartel con QR. Texto para WhatsApp listo.
6. Las inscripciones entran en estado `pendiente`. En **«Inscripciones»** se verifica seguro,
   licencia y pago, se ajusta el rating y se **confirma**. Exportar CSV y **Lista de largada**
   imprimible (con TCF calculado y columnas de control de salida y regreso).
7. **Pestaña «Pruebas y resultados».** Crear cada prueba (nº, fecha, hora de largada, recorrido,
   distancia en MN si se usa ToD) → **Cargar llegadas** (hh:mm:ss y código) → Guardar y calcular.
   La clasificación general se recalcula sola y aparece abajo, con CSV e impresión oficial.
8. **Pestaña «Organización».** Cargar el checklist estándar (23 tareas D-30 a cierre) y asignar
   responsables.
9. Pasar el evento a `finalizado`. Los resultados quedan públicos en el portal.

---

## 5. Notas operativas

- **Inscripción pública sin login.** La política RLS `insc_insert_publico` sólo admite el alta
  cuando el evento está en `inscripcion_abierta` y dentro del plazo, y sólo en estado `pendiente`.
  El anónimo no puede leer ni editar inscripciones: la lista pública sale de la vista
  `v_inscriptos_publico`, que no expone DNI, email, teléfono ni datos de seguro.
- **Contexto Nahuel Huapi.** Los documentos generados ya incluyen: viento térmico O/SO de la tarde,
  rachas de cordillera, agua fría (recomendación de neoprene), chaleco obligatorio permanente
  (modifica la regla 40), control de salida y regreso, límites de viento por flota, canal VHF y
  distancia a los canales de embarcaciones comerciales de Puerto San Carlos.
- **Reutilizar el registro de flota.** El campo `codigo_flota` de la inscripción admite el código
  CNB del barco (`OPT-C-001`), para cruzar con el sistema de trazabilidad de la Escuela de Vela.
- **Logo.** `assets/logo-cnb.jpg` es un provisorio generado. Reemplazarlo por el logo real del Club
  (el mismo que usa `registro-flota-web/assets/logo-cnb.jpg`).

---

## 6. Ampliaciones previstas

- Carga masiva de ratings PHRF desde CSV.
- Envío automático del mail de confirmación de inscripción (Supabase Edge Function + Resend).
- Formulario de protesta en línea con control del plazo.
- Ranking anual acumulado por temporada, cruzando varios eventos de una misma serie.
