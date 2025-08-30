import { supabase } from './supabaseClient.js';

export async function isCooldownActive(id, durationSeconds) {
    const { data, error } = await supabase
        .from('cooldowns')
        .select('last_triggered')
        .eq('id', id)
        .single();

    if (error || !data || !data.last_triggered) return false;

    const last = new Date(data.last_triggered);
    if (isNaN(last)) return false; // Invalid date fallback

    const now = new Date();
    return now - last < durationSeconds * 1000;
}

export async function triggerCooldown(id) {
    await supabase
        .from('cooldowns')
        .upsert({ id, last_triggered: new Date().toISOString() });
}
