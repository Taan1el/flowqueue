// The one place that decides whether the dashboard talks to the Express API
// or to the in-browser demo. Components import from here, never from
// ./api.js or ./demoApi.js directly.
import { api as realApi } from './api.js';
import { demoApi, resetDemoData, startDemoWorker } from './demoApi.js';

export type { QueueWithStats, JobWithAttempts } from './api.js';

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

export const api = isDemoMode ? demoApi : realApi;

if (isDemoMode) startDemoWorker();

// Only meaningful in demo mode; the banner is the only caller.
export { resetDemoData };
