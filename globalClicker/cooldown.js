import { supabase } from './supabaseClient.js';

// Ensure both timestamps are in UTC milliseconds
function secondsSinceUTC(timestamp) {
  const nowUTC = Date.now(); // UTC in ms
  const targetUTC = new Date(timestamp).getTime(); // UTC in ms
  return (nowUTC - targetUTC) / 1000;
}

export async function isCooldownActive(id, durationSeconds) {
  const { data, error } = await supabase
    .from('cooldowns')
    .select('last_triggered')
    .eq('id', id)
    .single();

  if (error) {
    console.error(`Error fetching cooldown [${id}]:`, error);
    return false;
  }

  if (!data) {
    console.log(`Cooldown [${id}] missing—creating default row`);
    const { error: insertError } = await supabase
      .from('cooldowns')
      .insert({ id, last_triggered: null });

    if (insertError) console.error('Insert failed:', insertError);
    return false;
  }

  if (!data.last_triggered) {
    console.log(`Cooldown [${id}] never triggered`);
    return false;
  }

  const elapsed = secondsSinceUTC(data.last_triggered);
  const remaining = Math.max(0, durationSeconds - elapsed);

  console.log(`Cooldown [${id}] elapsed: ${elapsed.toFixed(2)}s`);
  console.log(`Cooldown [${id}] remaining: ${remaining.toFixed(2)}s`);

  return {
    active: elapsed < durationSeconds,
    remaining
  };
}

export async function triggerCooldown(id) {
  const now = new Date().toISOString(); // ✅ UTC-safe

  const { error } = await supabase
    .from('cooldowns')
    .upsert({ id, last_triggered: now });

  if (error) {
    console.error(`Failed to trigger cooldown [${id}]:`, error);
  } else {
    console.log(`Cooldown triggered for [${id}] at ${now}`);
  }
}

export function subscribeToCooldowns(onUpdate) {
  const channel = supabase
    .channel('cooldowns')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'cooldowns'
    }, payload => {
      console.log('Realtime cooldown update:', payload.new);
      if (typeof onUpdate === 'function') {
        onUpdate(payload.new);
      }
    })
    .subscribe();

  return channel;
}
