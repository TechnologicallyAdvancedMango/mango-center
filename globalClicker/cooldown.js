import { supabase } from './supabaseClient.js';

export async function isCooldownActive(id, durationSeconds) {
    const { data, error } = await supabase
        .from('cooldowns')
        .select('last_triggered')
        .eq('id', id)
        .single();

    if (error || !data || !data.last_triggered) return false;

    const last = new Date(data.last_triggered);
    if (isNaN(last)) return false;

    const now = new Date();
    const elapsed = (now - last) / 1000;

    if (elapsed < 0 || elapsed >= durationSeconds) {
        // Optional: reset timestamp to null or now
        await supabase
            .from('cooldowns')
            .update({ last_triggered: null })
            .eq('id', id);
        return false;
    }

    return true;
}


export async function triggerCooldown(id) {
    await supabase
        .from('cooldowns')
        .upsert({ id, last_triggered: new Date().toISOString() });
}
