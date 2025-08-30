import { supabase } from './supabaseClient.js';

let clickRowId = null;

async function ensureClickRow() {
  if (clickRowId) return clickRowId;

  const { data, error } = await supabase
    .from('clicks')
    .select('id')
    .limit(1);

  if (error || !data || !data.length) {
    throw new Error('Failed to fetch click row');
  }

  clickRowId = data[0].id;
  return clickRowId;
}

export async function incrementCount() {
  const id = await ensureClickRow();

  const { data, error } = await supabase
    .from('clicks')
    .select('count')
    .eq('id', id)
    .single();

  if (error) throw error;

  const newCount = data.count + 1;

  await supabase
    .from('clicks')
    .update({ count: newCount })
    .eq('id', id);

  return newCount;
}

export async function getClickCount() {
  const id = await ensureClickRow();

  const { data, error } = await supabase
    .from('clicks')
    .select('count')
    .eq('id', id)
    .single();

  if (error) throw error;

  return data.count;
}

export async function setClickCount(newCount) {
  const id = await ensureClickRow();

  await supabase
    .from('clicks')
    .update({ count: newCount })
    .eq('id', id);

  return newCount;
}

export function subscribeToClicks(callback) {
  supabase
    .channel('clicks')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'clicks' },
      payload => {
        console.log('Realtime click update:', payload.new);
        const newCount = payload.new.count;
        callback(newCount);
      }
    )
    .subscribe();
}
