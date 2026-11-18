export * from './v1.ts';

export interface StoreFixture {
  readonly id: string;
  readonly origin: string;
}

export function parseFixtures(input: unknown): readonly StoreFixture[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Expected nonempty fixture array');
  const seen = new Set<string>();
  return input.map((value: unknown): StoreFixture => {
    if (typeof value !== 'object' || value === null || !('id' in value) || !('origin' in value)
      || typeof value.id !== 'string' || !/^[a-z0-9-]+$/.test(value.id)
      || typeof value.origin !== 'string') throw new Error('Invalid fixture');
    const url = new URL(value.origin);
    if (url.protocol !== 'https:' || url.origin !== value.origin || url.username || url.password) throw new Error('Invalid fixture origin');
    if (seen.has(value.id)) throw new Error('Duplicate fixture id');
    seen.add(value.id);
    return { id: value.id, origin: value.origin };
  });
}
