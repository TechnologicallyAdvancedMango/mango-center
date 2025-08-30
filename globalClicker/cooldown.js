import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function isCooldownActive(id, durationSeconds) {
  const { data, error } = await supabase
    .from('cooldowns')
    .select('last_triggered')
    .eq('id', id)
    .single();

  if (error || !data.last_triggered) return false;

  const last = new Date(data.last_triggered);
  return Date.now() - last.getTime() < durationSeconds * 1000;
}

export async function triggerCooldown(id) {
  await supabase
    .from('cooldowns')
    .upsert({ id, last_triggered: new Date().toISOString() });
}
