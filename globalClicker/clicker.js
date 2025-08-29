window.addEventListener('DOMContentLoaded', () => {
  // Ensure config variables are available
  if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined') {
    console.error('Supabase config not loaded.');
    return;
  }

  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function getCount() {
    const { data, error } = await client
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

  async function incrementCount() {
    const current = await getCount();
    const newCount = current + 1;

    const { error } = await client
      .from('clicks')
      .upsert({ id: CLICKER_ID, count: newCount });

    if (error) {
      console.error('Error updating count:', error);
      return;
    }

    updateUI(newCount);
  }

  function updateUI(count) {
    const counter = document.getElementById('counter');
    if (counter) counter.textContent = count;

    if (document.getElementById('chaosToggle')?.checked) {
      triggerVisualEffect();
    }
    console.log('Type of count:', typeof count);
    console.log('Value of count:', count);
  }

  function triggerVisualEffect() {
    document.body.style.backgroundColor = `hsl(${Math.random() * 360}, 100%, 90%)`;
    setTimeout(() => {
      document.body.style.backgroundColor = '';
    }, 100);
  }

  function getAndUpdate() {
    getCount().then(updateUI);
  }

  // Initial load
  getCount().then(updateUI);

  // Expose incrementCount globally for button onclick
  window.incrementCount = incrementCount;

  // Update every second
  setInterval(getAndUpdate, 1000);
});
