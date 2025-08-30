import { supabase } from './supabaseClient.js';

// Utility: seconds since timestamp
function secondsSince(timestamp) {
  return (Date.now() - new Date(timestamp)) / 1000;
}

// Check if cooldown is active
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

  const elapsed = secondsSince(data.last_triggered);
  console.log(`Cooldown [${id}] elapsed: ${elapsed.toFixed(2)}s`);

  return {
    active: elapsed < durationSeconds,
    remaining: Math.max(0, durationSeconds - elapsed)
  };
}

// Trigger cooldown
export async function triggerCooldown(id) {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('cooldowns')
    .upsert({ id, last_triggered: now });

  if (error) {
    console.error(`Failed to trigger cooldown [${id}]:`, error);
  } else {
    console.log(`Cooldown triggered for [${id}] at ${now}`);
  }
}

// Optional: Realtime listener
export function subscribeToCooldowns(onUpdate) {
  const channel = supabase
    .channel('cooldowns')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'cooldowns'
    }, payload => {
      console.log('Realtime update:', payload.new);
      if (typeof onUpdate === 'function') {
        onUpdate(payload.new);
      }
    })
    .subscribe();

  return channel;
}
