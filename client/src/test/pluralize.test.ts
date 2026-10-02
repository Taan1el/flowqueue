import { describe, it, expect } from 'vitest';
import { pluralize, formatCount } from '../utils/pluralize.js';

describe('pluralize', () => {
  it('uses the singular form for exactly 1', () => {
    expect(pluralize(1, 'key')).toBe('key');
    expect(pluralize(-1, 'key')).toBe('key');
  });

  it('uses the regular plural form (adds "s") for any other count', () => {
    expect(pluralize(0, 'key')).toBe('keys');
    expect(pluralize(2, 'key')).toBe('keys');
    expect(pluralize(30, 'request')).toBe('requests');
  });

  it('uses an explicit irregular plural when given one', () => {
    expect(pluralize(1, 'miss', 'misses')).toBe('miss');
    expect(pluralize(2, 'miss', 'misses')).toBe('misses');
    expect(pluralize(0, 'miss', 'misses')).toBe('misses');
  });
});

describe('formatCount', () => {
  it('joins the count and the correctly pluralized noun', () => {
    expect(formatCount(1, 'key')).toBe('1 key');
    expect(formatCount(2, 'key')).toBe('2 keys');
    expect(formatCount(0, 'hit')).toBe('0 hits');
    expect(formatCount(1, 'miss', 'misses')).toBe('1 miss');
    expect(formatCount(5, 'miss', 'misses')).toBe('5 misses');
  });
});
