import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = join(import.meta.dirname, '..');
test('installable manifest requests click-only activeTab and narrow optional API hosts', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'dist/manifest.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'storage']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.host_permissions, undefined);
});
