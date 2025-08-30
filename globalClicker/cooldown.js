import { supabase } from './supabaseClient.js';

export async function isCooldownActive(id, durationSeconds) {
    const { data, error } = await supabase
        .from('cooldowns')
        .select('last_triggered')
        .eq('id', id)
        .single();

    if (error || !data || !data.last_triggered) {
        console.log('Cooldown not found or never triggered');
        return false;
    }

    const last = new Date(data.last_triggered);
    const now = new Date();
    const elapsed = (now - last) / 1000;

    console.log(`Cooldown [${id}] elapsed: ${elapsed}s`);

    return elapsed < durationSeconds;
}



export async function triggerCooldown(id) {
    await supabase
        .from('cooldowns')
        .upsert({ id, last_triggered: new Date().toISOString() });
    
    console.log('Cooldown triggered for:', id);
}
