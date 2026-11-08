import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { SDK_VERSION } from './index';

describe('sdk', () => {
  it('exposes the package version', () => {
    expect(SDK_VERSION).toBe(pkg.version);
  });
});
