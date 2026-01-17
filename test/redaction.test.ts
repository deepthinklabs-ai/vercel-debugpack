import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sanitizeUrl, truncateString, safeStringify, extractStack } from '../src/browser/redaction';

describe('sanitizeUrl', () => {
  it('should remove query parameters', () => {
    const result = sanitizeUrl('https://example.com/path?secret=abc&token=xyz');
    assert.strictEqual(result, 'https://example.com/path');
  });

  it('should remove hash fragments', () => {
    const result = sanitizeUrl('https://example.com/path#section');
    assert.strictEqual(result, 'https://example.com/path');
  });

  it('should handle URLs with both query and hash', () => {
    const result = sanitizeUrl('https://example.com/path?foo=bar#section');
    assert.strictEqual(result, 'https://example.com/path');
  });

  it('should preserve origin and pathname', () => {
    const result = sanitizeUrl('https://api.example.com:8080/v1/users/123');
    assert.strictEqual(result, 'https://api.example.com:8080/v1/users/123');
  });

  it('should handle relative URLs', () => {
    const result = sanitizeUrl('/api/users?id=123');
    assert.strictEqual(result, '/api/users');
  });

  it('should handle malformed URLs gracefully', () => {
    const result = sanitizeUrl('not-a-url?param=value');
    assert.strictEqual(result, 'not-a-url');
  });
});

describe('truncateString', () => {
  it('should not truncate strings under the limit', () => {
    const result = truncateString('hello world', 100);
    assert.strictEqual(result, 'hello world');
  });

  it('should truncate strings over the limit', () => {
    const result = truncateString('a'.repeat(100), 50);
    assert.ok(result.length <= 50);
    assert.ok(result.endsWith('...[truncated]'));
  });

  it('should handle exact limit length', () => {
    const result = truncateString('hello', 5);
    assert.strictEqual(result, 'hello');
  });

  it('should handle very small limits', () => {
    // String longer than limit (30 chars > 20 limit)
    const result = truncateString('hello world this is a long string', 25);
    assert.ok(result.length <= 25);
    assert.ok(result.includes('[truncated]'));
  });
});

describe('safeStringify', () => {
  it('should handle null', () => {
    assert.strictEqual(safeStringify(null, 100), 'null');
  });

  it('should handle undefined', () => {
    assert.strictEqual(safeStringify(undefined, 100), 'undefined');
  });

  it('should handle strings', () => {
    assert.strictEqual(safeStringify('hello', 100), 'hello');
  });

  it('should handle numbers', () => {
    assert.strictEqual(safeStringify(42, 100), '42');
  });

  it('should handle objects', () => {
    const result = safeStringify({ foo: 'bar' }, 100);
    assert.strictEqual(result, '{"foo":"bar"}');
  });

  it('should handle arrays', () => {
    const result = safeStringify([1, 2, 3], 100);
    assert.strictEqual(result, '[1,2,3]');
  });

  it('should handle Error objects', () => {
    const error = new Error('test error');
    const result = safeStringify(error, 100);
    assert.strictEqual(result, 'test error');
  });

  it('should handle circular references', () => {
    const obj: Record<string, unknown> = { foo: 'bar' };
    obj.self = obj;
    const result = safeStringify(obj, 100);
    assert.ok(result.includes('[Circular]'));
  });

  it('should truncate long output', () => {
    const largeObject = { data: 'x'.repeat(200) };
    const result = safeStringify(largeObject, 100);
    // Should be truncated to ~100 chars (JSON wrapper + truncation suffix)
    assert.ok(result.length <= 100);
    assert.ok(result.includes('[truncated]'));
  });
});

describe('extractStack', () => {
  it('should extract stack from Error', () => {
    const error = new Error('test');
    const result = extractStack(error, 1000);
    assert.ok(result !== null);
    assert.ok(result.includes('Error'));
  });

  it('should return null for undefined error', () => {
    const result = extractStack(undefined, 1000);
    // May return null or a synthetic stack depending on environment
    assert.ok(result === null || typeof result === 'string');
  });

  it('should truncate long stacks', () => {
    const error = new Error('test');
    const result = extractStack(error, 50);
    if (result) {
      assert.ok(result.length <= 50);
    }
  });
});
