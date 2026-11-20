import { endpointPermission, parseEndpoint } from './boundaries.js';
import { checkStore, pollCheck, renderResult } from './check.js';

declare const chrome: {
  tabs: { query(query: { active: true; currentWindow: true }): Promise<{ url?: string }[]> };
  permissions: { request(permissions: { origins: string[] }): Promise<boolean> };
  storage: { local: { get(keys: string[]): Promise<Record<string, unknown>>; set(items: Record<string, string>): Promise<void> } };
};

const mode = document.querySelector<HTMLSelectElement>('#mode')!;
const endpoint = document.querySelector<HTMLInputElement>('#endpoint')!;
const button = document.querySelector<HTMLButtonElement>('#check')!;
const result = document.querySelector<HTMLDivElement>('#result')!;

// Only local extension settings are read on popup open. No tab lookup or network until the button click.
void chrome.storage.local.get(['mode', 'hostedEndpoint', 'selfEndpoint']).then(settings => {
  mode.value = settings.mode === 'self' ? 'self' : 'hosted';
  endpoint.value = String(settings[`${mode.value}Endpoint`] ?? '');
}).catch(() => { result.textContent = 'Could not read settings.'; });
mode.addEventListener('change', () => {
  void chrome.storage.local.get([`${mode.value}Endpoint`]).then(settings => {
    endpoint.value = String(settings[`${mode.value}Endpoint`] ?? '');
  }).catch(() => { endpoint.value = ''; });
});

button.addEventListener('click', () => {
  void (async () => {
    button.disabled = true;
    result.textContent = 'Checking…';
    try {
      const api = parseEndpoint(endpoint.value.trim());
      // User gesture requests only the selected API origin, never a store-page host permission.
      const granted = await chrome.permissions.request({ origins: [endpointPermission(api)] });
      if (!granted) throw new Error('API access not granted');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) throw new Error('Open a public store page first');
      await chrome.storage.local.set({ mode: mode.value, [`${mode.value}Endpoint`]: api.href });
      const initial = await checkStore(tab.url, api.href);
      result.innerHTML = renderResult(initial);
      if (initial.status === 'checking') result.innerHTML = renderResult(await pollCheck(initial, api.href));
    } catch (error) {
      result.innerHTML = renderResult({ status: 'error', message: error instanceof Error ? error.message : 'API unavailable' });
    } finally { button.disabled = false; }
  })();
});
