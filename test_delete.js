const { getSupabaseClient } = require('./src/db/supabase.js');

async function run() {
    const supabase = await getSupabaseClient();
    if (!supabase) return console.log("No supabase client");

    // Insert dummy task
    const idList = [999991, 999992];
    await supabase.from('tasks').upsert([
        { id: 999991, status: 'test' },
        { id: 999992, status: 'test' }
    ]);
    console.log("Inserted tasks.");

    let { data } = await supabase.from('tasks').select('*').in('id', idList);
    console.log("Tasks found:", data?.length);

    // Delete single
    await supabase.from('tasks').delete().eq('id', 999991);
    data = await supabase.from('tasks').select('*').in('id', idList);
    console.log("Tasks found after single delete:", data?.length);

    // Delete multiple
    await supabase.from('tasks').delete().in('id', [999992]);
    data = await supabase.from('tasks').select('*').in('id', idList);
    console.log("Tasks found after multiple delete:", data?.length);
}
run();
