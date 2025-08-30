import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://your-project.supabase.co';
const supabaseKey = 'your-anon-or-service-role-key';

// Single instance
export const supabase = createClient(supabaseUrl, supabaseKey);
