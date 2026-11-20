import { startSyntheticApi } from './mock-api.js';
const mock = await startSyntheticApi();
console.log(`Synthetic local API: ${mock.endpoint}`);
console.log('Open an HTTPS tab at low.example.test, caution.example.test, high.example.test, insufficient.example.test, limited.example.test, checking.example.test, rate-limited.example.test, unsupported.example.test, or error.example.test; no page load is required for unit tests. Ctrl-C to stop.');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void mock.close().then(() => process.exit(0)); });
