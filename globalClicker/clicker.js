// clicker.js

// Initialize Supabase client
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Fetch current count from Supabase
async function getCount() {
  const { data, error } = await supabase
    .from('clicks')
    .select('count')
    .eq('id', CLICKER_ID)
    .single();

  if (error) {
    console.error('Error fetching count:', error);
    return 0;
  }

  return data?.count || 0;
}

// Increment count and update Supabase
async function incrementCount() {
  const current = await getCount();
  const newCount = current + 1;

  const { error } = await supabase
    .from('clicks')
    .upsert({ id: CLICKER_ID, count: newCount });

  if (error) {
    console.error('Error updating count:', error);
    return;
  }

  updateUI(newCount);
}

// Update the counter display
function updateUI(count) {
  const counter = document.getElementById('counter');
  if (counter) counter.textContent = count;

  // Optional chaos mode visual effect
  if (document.getElementById('chaosToggle')?.checked) {
    triggerVisualEffect();
  }
}

// Simple visual chaos effect (no sound)
function triggerVisualEffect() {
  document.body.style.backgroundColor = `hsl(${Math.random() * 360}, 100%, 90%)`;
  setTimeout(() => {
    document.body.style.backgroundColor = '';
  }, 100);
}

// Initial load
getCount().then(updateUI);
