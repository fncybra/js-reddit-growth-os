import { createClient } from '@supabase/supabase-js';
import { SettingsService } from '../services/growthEngine';

let supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
let supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export async function getSupabaseClient() {
    if (!supabaseUrl || !supabaseAnonKey) {
        const settings = await SettingsService.getSettings();
        supabaseUrl = settings.supabaseUrl;
        supabaseAnonKey = settings.supabaseAnonKey;
    }

    if (!supabaseUrl || !supabaseAnonKey) return null;

    return createClient(supabaseUrl, supabaseAnonKey);
}

