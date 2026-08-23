# Prompt para Claude Code — deploy del Sistema de Regatas CNB

Abrí una terminal, entrá a la carpeta del proyecto y arrancá Claude Code:

```bash
cd "/Users/ernestolynch/Documents/Claude/Projects/Comision de Vela CNB/regatas-cnb"
claude
```

Después pegá **todo** el bloque de abajo como primer mensaje.

---

## PROMPT (copiar desde acá)

Necesito que despliegues esta app estática a GitHub y Vercel. Es un sitio sin build: HTML, CSS y JS
plano más Supabase. No instales dependencias ni frameworks, no crees `package.json`.

Contexto: ya tengo cuenta en GitHub y en Vercel. La carpeta actual **todavía no es un repo git**.

Hacé exactamente esto, en orden, y frená a avisarme si algo falla:

1. **Verificación previa.** Confirmá que existen `index.html`, `inscripcion.html`, `admin.html`,
   `config.js`, `style.css`, `vercel.json`, `js/` y `supabase/schema.sql`.
   Abrí `config.js` y verificá que `SUPABASE_URL` y `SUPABASE_ANON_KEY` **no** tengan los valores
   placeholder (`TU-PROYECTO`, `TU_ANON_KEY_ACA`). Si los tienen, **pará acá** y decímelo: hay que
   cargar primero las credenciales de Supabase.

2. **Test del motor de puntajes.** Corré `node js/scoring.test.js`. Tienen que dar 32 OK y 0
   fallidas. Si falla alguna, pará y mostrame cuál.

3. **Git.**
   ```
   git init
   git add -A
   git commit -m "Sistema de gestión de regatas CNB — calendario, avisos, inscripciones y resultados"
   git branch -M main
   ```

4. **GitHub.** Verificá que `gh` esté autenticado (`gh auth status`). Si no lo está, corré
   `gh auth login` y avisame para que apruebe en el navegador. Después:
   ```
   gh repo create regatas-cnb --public --source=. --remote=origin --push
   ```

5. **Vercel.** Verificá que el CLI esté instalado (`vercel --version`); si no, instalalo con
   `npm i -g vercel`. Luego `vercel whoami`; si no hay sesión, corré `vercel login` y avisame para
   que apruebe en el navegador. Después desplegá:
   ```
   vercel --prod
   ```
   Cuando pregunte, respondé: proyecto nuevo, nombre `regatas-cnb`, directorio raíz `./`,
   framework `Other`, sin build command, sin output directory.

6. **Verificación del deploy.** Con la URL que devuelva Vercel, comprobá con `curl -I` que
   `/index.html`, `/inscripcion.html` y `/admin.html` devuelvan 200.

7. **Cerrame el trabajo** mostrándome:
   - la URL del repositorio en GitHub,
   - la URL de producción en Vercel,
   - y este recordatorio literal:

   > **PASO MANUAL PENDIENTE:** entrar a Supabase → Authentication → URL Configuration y cargar la
   > URL de Vercel en **Site URL** y en **Redirect URLs** (con `/**` al final). Sin esto el magic
   > link del panel de comisión redirige a localhost y no se puede iniciar sesión.

## FIN DEL PROMPT

---

### Después del deploy

1. Supabase → **Authentication → URL Configuration**:
   - Site URL: `https://regatas-cnb.vercel.app`
   - Redirect URLs: `https://regatas-cnb.vercel.app/**`
2. Abrir `https://regatas-cnb.vercel.app/admin.html`, ingresar con tu email y verificar que entre.
3. Crear el primer evento y probar el circuito completo: aviso → inscripción → llegadas → resultados.

### Para actualizar la app más adelante

```bash
git add -A && git commit -m "descripción del cambio" && git push
```

Vercel redespliega solo con cada push a `main`.
