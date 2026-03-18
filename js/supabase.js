// js/supabase.js — cliente Supabase centralizado
const SUPA_URL = 'https://qbgihaatifllskqveavg.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFiZ2loYWF0aWZsbHNrcXZlYXZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NzE1MzcsImV4cCI6MjA4OTM0NzUzN30.x91ZvjEqGxiSuG9B0T_jOLclx2TT8u3VCG7N1KNOYA4';
const SB = supabase.createClient(SUPA_URL, SUPA_KEY);
