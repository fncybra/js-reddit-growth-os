import { createClient } from '@supabase/supabase-js';
import { SettingsService } from '../services/growthEngine';

let supabaseClientInstance = null;

export async function getSupabaseClient() {
    if (supabaseClientInstance) return supabaseClientInstance;

    let supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    let supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseAnonKey) {
        const settings = await SettingsService.getSettings();
        supabaseUrl = settings.supabaseUrl;
        supabaseAnonKey = settings.supabaseAnonKey;
    }

    if (!supabaseUrl || !supabaseAnonKey) return null;

    supabaseClientInstance = createClient(supabaseUrl, supabaseAnonKey);
    return supabaseClientInstance;
}

// Call this after changing Supabase URL/key in Settings so the next
// getSupabaseClient() creates a fresh client with the new credentials.
export function resetSupabaseClient() {
    supabaseClientInstance = null;
}

