import { supabase } from './supabaseClient.js';

export async function isCooldownActive(id, durationSeconds) {
    const { data, error } = await supabase
        .from('cooldowns')
        .select('last_triggered')
        .eq('id', id)
        .single();

    if (error || !data) return false;

    const lastTriggered = data.last_triggered;
    if (!lastTriggered) return false;

    const last = new Date(lastTriggered);
    if (isNaN(last)) return false;

    const now = new Date();
    const elapsed = (now - last) / 1000;

    return elapsed < durationSeconds;
}


export async function triggerCooldown(id) {
    await supabase
        .from('cooldowns')
        .upsert({ id, last_triggered: new Date().toISOString() });
}
