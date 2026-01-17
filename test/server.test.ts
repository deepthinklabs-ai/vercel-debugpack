import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DEBUG_SESSION_HEADER,
  getDebugSessionId,
  getDebugLogPrefix,
  createDebugLogger,
} from '../src/server/index';

describe('DEBUG_SESSION_HEADER', () => {
  it('should be the correct header name', () => {
    assert.strictEqual(DEBUG_SESSION_HEADER, 'x-debug-session-id');
  });
});

describe('getDebugSessionId', () => {
  it('should extract session ID from Request object', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-debug-session-id': 'test-session-123' },
    });
    const result = getDebugSessionId(request);
    assert.strictEqual(result, 'test-session-123');
  });

  it('should extract session ID from Headers object', () => {
    const headers = new Headers({ 'x-debug-session-id': 'test-session-456' });
    const result = getDebugSessionId(headers);
    assert.strictEqual(result, 'test-session-456');
  });

  it('should extract session ID from plain object with headers', () => {
    const request = {
      headers: { 'x-debug-session-id': 'test-session-789' },
    };
    const result = getDebugSessionId(request);
    assert.strictEqual(result, 'test-session-789');
  });

  it('should return null when header is missing', () => {
    const request = new Request('https://example.com');
    const result = getDebugSessionId(request);
    assert.strictEqual(result, null);
  });

  it('should handle lowercase header name', () => {
    const request = {
      headers: { 'x-debug-session-id': 'lowercase-session' },
    };
    const result = getDebugSessionId(request);
    assert.strictEqual(result, 'lowercase-session');
  });
});

describe('getDebugLogPrefix', () => {
  it('should return prefix with session ID', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-debug-session-id': 'abc123' },
    });
    const result = getDebugLogPrefix(request);
    assert.strictEqual(result, '[debugSessionId=abc123]');
  });

  it('should return empty string when no session ID', () => {
    const request = new Request('https://example.com');
    const result = getDebugLogPrefix(request);
    assert.strictEqual(result, '');
  });
});

describe('createDebugLogger', () => {
  it('should create logger with all methods', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-debug-session-id': 'logger-test' },
    });
    const logger = createDebugLogger(request);

    assert.ok(typeof logger.log === 'function');
    assert.ok(typeof logger.warn === 'function');
    assert.ok(typeof logger.error === 'function');
    assert.ok(typeof logger.info === 'function');
  });
});
