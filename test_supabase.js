import { createClient } from '@supabase/supabase-js';

const url = 'https://bfykveokmsqcztcmpago.supabase.co';
const key = 'sb_publishable_qsAOyMe6xNAdBf5f6YqC6w_U92Z0UHg';

async function test() {
    console.log("Testing Supabase connection...");
    try {
        const supabase = createClient(url, key);
        const { data, error } = await supabase.from('settings').select('*').limit(1);
        if (error) {
            console.error("Connection Error:", error.message);
            if (error.message.includes("Invalid API key") || error.message.includes("JWT")) {
                console.log("\n--- ALERT ---");
                console.log("The key you provided ('sb_publishable_...') looks like a Stripe key, not a Supabase Anon Key.");
                console.log("Supabase Anon Keys usually start with 'eyJhbGc...'.");
                console.log("Please check your Supabase Dashboard -> Project Settings -> API.");
                console.log("--- --- ---\n");
            }
        } else {
            console.log("Connection Successful! Data:", data);
        }
    } catch (e) {
        console.error("Crash:", e.message);
    }
}

test();
