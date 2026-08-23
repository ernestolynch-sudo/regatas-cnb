/* ============================================================================
 * config.js — Configuración del Sistema de Regatas CNB
 * ----------------------------------------------------------------------------
 * REEMPLAZAR los dos valores de abajo con los de tu proyecto Supabase:
 *   Supabase → Project Settings → API
 *     · Project URL      → SUPABASE_URL
 *     · anon / public key → SUPABASE_ANON_KEY
 *
 * La anon key es PÚBLICA por diseño: la seguridad la da el Row Level Security
 * definido en supabase/schema.sql. NO pegar acá la service_role key.
 * ==========================================================================*/
window.CNB_CONFIG = {
  SUPABASE_URL: 'https://dehhlcrkclhelkjpbhos.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlaGhsY3JrY2xoZWxranBiaG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MDM0OTYsImV4cCI6MjEwMzA3OTQ5Nn0.hiY8BZ7OTR6PiLhTHk4Oee1eFdUu5_G2rqekwkwAhs0',

  CLUB: 'Club Náutico Bariloche',
  COMISION: 'Comisión de Vela y Motor',
  LOGO: 'assets/logo-cnb.jpg',
  CANAL_VHF_DEFECTO: '71',

  // Coeficientes PHRF Tiempo sobre Tiempo por defecto: TCF = B / (A + Rating)
  PHRF_A: 550,
  PHRF_B: 650
};
