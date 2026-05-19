import { createClient } from '@butterbase/sdk';

const APP_ID = import.meta.env.VITE_BUTTERBASE_APP_ID ?? 'app_02vcbf6ev0vp';
const API_URL = import.meta.env.VITE_BUTTERBASE_API_URL ?? 'https://api.butterbase.ai';

export const bb = createClient({
  appId: APP_ID,
  apiUrl: API_URL,
});
