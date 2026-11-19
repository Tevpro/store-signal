import type { Coverage } from '../types/coverage.ts';
import { date, enumValue, object, optionalText, text, version, invalid } from './contract-validation.ts';

export function parseCoverage(input: unknown): Coverage {
  const v = object(input); version(v);
  text(v.connector, 'connector');
  const status = enumValue(v.status, ['checked', 'no_match', 'unavailable', 'failed'], 'coverage status');
  date(v.checkedAt, 'checkedAt'); optionalText(v.limitation, 'limitation'); optionalText(v.errorCode, 'errorCode');
  if (status === 'failed' && !v.errorCode || status !== 'failed' && v.errorCode !== undefined || status === 'unavailable' && !v.limitation) invalid('coverage status metadata');
  return v as unknown as Coverage;
}
