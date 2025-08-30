//clicker.js

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

//  Supabase config
const supabaseUrl = 'https://your-project.supabase.co'; // replace with your project URL
const supabaseKey = 'public-anon-key'; // replace with your anon/public key
const supabase = createClient(supabaseUrl, supabaseKey);

//Cache the click row ID
let clickRowId = null;

//Fetch the click row (once)
export async function initClicker() {
  const { data, error } = await supabase
    .from('clicks')
    .select('id, count')
    .limit(1);

  if (error) {
    console.error('Error fetching click row:', error);
    return;
  }

  clickRowId = data[0].id;
  return data[0].count;
}

//Increment the count by 1
export async function incrementCount() {
  if (!clickRowId) await initClicker();

  //Fetch current count
  const { data, error } = await supabase
    .from('clicks')
    .select('count')
    .eq('id', clickRowId)
    .single();

  if (error) {
    console.error('Error reading count:', error);
    return;
  }

  const newCount = data.count + 1;

  //Update count
  await supabase
    .from('clicks')
    .update({ count: newCount })
    .eq('id', clickRowId);
}

//Set count directly (for sliders, chaos modes)
export async function setClickCount(newCount) {
  if (!clickRowId) await initClicker();

  await supabase
    .from('clicks')
    .update({ count: newCount })
    .eq('id', clickRowId);
}

//Realtime sync
export function subscribeToClicks(callback) {
  supabase
    .channel('clicks')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'clicks'
    }, payload => {
      const updatedCount = payload.new.count;
      callback(updatedCount);
    })
    .subscribe();
}
