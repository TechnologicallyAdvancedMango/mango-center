const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getCount() {
  const { data } = await supabase
    .from('clicks')
    .select('count')
    .eq('id', CLICKER_ID)
    .single();
  return data?.count || 0;
}

async function incrementCount() {
  const current = await getCount();
  const newCount = current + 1;

  await supabase
    .from('clicks')
    .upsert({ id: CLICKER_ID, count: newCount });

  updateUI(newCount);
}

function updateUI(count) {
  document.getElementById('counter').textContent = count;

  if (document.getElementById('chaosToggle').checked) {
    playSound();
    triggerVisualEffect();
  }
}

function playSound() {
  const audio = new Audio('sounds/click.mp3');
  audio.playbackRate = Math.random() * 2 + 0.5;
  audio.play();
}

function triggerVisualEffect() {
  document.body.style.backgroundColor = `hsl(${Math.random() * 360}, 100%, 90%)`;
  setTimeout(() => {
    document.body.style.backgroundColor = '';
  }, 100);
}

// Initial load
getCount().then(updateUI);
