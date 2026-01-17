/**
 * Integration tests - verify all exports and end-to-end functionality
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('Module exports', () => {
  it('should export browser utilities correctly (no React required)', async () => {
    // Import only the parts that don't need React
    const { sanitizeUrl, truncateString, safeStringify } = await import('../src/browser/redaction');
    const { initDebugCapture, getDebugCapture, isDebugModeActive, getDebugSessionId } = await import('../src/browser/capture');

    // Vanilla API
    assert.ok(typeof initDebugCapture === 'function');
    assert.ok(typeof getDebugCapture === 'function');
    assert.ok(typeof isDebugModeActive === 'function');
    assert.ok(typeof getDebugSessionId === 'function');

    // Utilities
    assert.ok(typeof sanitizeUrl === 'function');
    assert.ok(typeof truncateString === 'function');
    assert.ok(typeof safeStringify === 'function');
  });

  it('should export server module correctly', async () => {
    const server = await import('../src/server/index');

    assert.strictEqual(server.DEBUG_SESSION_HEADER, 'x-debug-session-id');
    assert.ok(typeof server.getDebugSessionId === 'function');
    assert.ok(typeof server.getDebugLogPrefix === 'function');
    assert.ok(typeof server.createDebugLogger === 'function');
    assert.ok(typeof server.withDebugSession === 'function');
    assert.ok(typeof server.withDebugSessionPages === 'function');
    assert.ok(typeof server.debugSessionMiddleware === 'function');
  });

  it('should have built dist files', () => {
    // Verify the built output exists
    const distPath = path.join(__dirname, '..', 'dist');

    assert.ok(fs.existsSync(path.join(distPath, 'index.js')));
    assert.ok(fs.existsSync(path.join(distPath, 'index.mjs')));
    assert.ok(fs.existsSync(path.join(distPath, 'index.d.ts')));
    assert.ok(fs.existsSync(path.join(distPath, 'browser', 'index.js')));
    assert.ok(fs.existsSync(path.join(distPath, 'server', 'index.js')));
    assert.ok(fs.existsSync(path.join(distPath, 'cli', 'index.js')));
  });
});

describe('CLI integration', () => {
  const testOutputDir = path.join(__dirname, 'cli-test-output');
  const sampleLogFile = path.join(__dirname, 'sample-browser-logs.jsonl');

  it('should generate debug bundle from sample logs', () => {
    // Clean up previous test output
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true });
    }

    // Run CLI
    const result = execSync(
      `node "${path.join(__dirname, '..', 'bin', 'debugpack.js')}" --browserLog "${sampleLogFile}" --project test-project --out "${testOutputDir}"`,
      { encoding: 'utf-8', cwd: path.join(__dirname, '..') }
    );

    // Verify output
    assert.ok(result.includes('Debug bundle created successfully'));

    // Check all files exist
    assert.ok(fs.existsSync(path.join(testOutputDir, 'context.json')));
    assert.ok(fs.existsSync(path.join(testOutputDir, 'browser-logs.jsonl')));
    assert.ok(fs.existsSync(path.join(testOutputDir, 'vercel-logs.txt')));
    assert.ok(fs.existsSync(path.join(testOutputDir, 'summary.md')));
    assert.ok(fs.existsSync(path.join(testOutputDir, 'redaction_report.json')));
  });

  it('should parse context.json correctly', () => {
    const contextPath = path.join(testOutputDir, 'context.json');
    const context = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));

    assert.ok(context.createdAt);
    assert.strictEqual(context.env, 'staging');
    assert.strictEqual(context.minutesBack, 15);
    assert.strictEqual(context.debugSessionId, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    assert.ok(context.nodeVersion);
    assert.strictEqual(context.browserLogCount, 12);
  });

  it('should redact sensitive data in browser logs', () => {
    const logsPath = path.join(testOutputDir, 'browser-logs.jsonl');
    const logsContent = fs.readFileSync(logsPath, 'utf-8');

    // Should NOT contain the original JWT
    assert.ok(!logsContent.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));

    // Should contain [REDACTED]
    assert.ok(logsContent.includes('[REDACTED]'));
  });

  it('should generate accurate summary', () => {
    const summaryPath = path.join(testOutputDir, 'summary.md');
    const summary = fs.readFileSync(summaryPath, 'utf-8');

    // Check key sections exist
    assert.ok(summary.includes('# Debug Bundle Summary'));
    assert.ok(summary.includes('## Session Info'));
    assert.ok(summary.includes('## Browser Logs'));
    assert.ok(summary.includes('### Top Errors'));
    assert.ok(summary.includes('### Failing Endpoints'));

    // Check it identified the repeated /api/users failures
    assert.ok(summary.includes('/api/users'));
    assert.ok(summary.includes('3x')); // 3 failures
  });

  it('should track redactions in report', () => {
    const reportPath = path.join(testOutputDir, 'redaction_report.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

    assert.ok(report.totalRedactions >= 1);
    assert.ok(report.byRule.bearerToken >= 1);
  });
});

describe('Server utilities integration', () => {
  it('should create working debug logger', async () => {
    const { createDebugLogger } = await import('../src/server/index');

    const request = new Request('https://example.com', {
      headers: { 'x-debug-session-id': 'test-123' },
    });

    const logger = createDebugLogger(request);

    // Should not throw
    logger.log('test message');
    logger.warn('test warning');
    logger.error('test error');
    logger.info('test info');
  });

  it('should wrap handlers with debug session', async () => {
    const { withDebugSession } = await import('../src/server/index');

    let capturedSessionId: string | null = null;

    const handler = withDebugSession(async (request, sessionId) => {
      capturedSessionId = sessionId;
      return new Response('OK');
    });

    const request = new Request('https://example.com', {
      headers: { 'x-debug-session-id': 'wrapped-test-456' },
    });

    const response = await handler(request);

    assert.strictEqual(capturedSessionId, 'wrapped-test-456');
    assert.ok(response instanceof Response);
  });
});
