import { describe, it } from 'node:test';
import assert from 'node:assert';

// CLI redaction patterns (duplicated here for testing since they're not exported)
const REDACTION_PATTERNS = [
  { name: 'authorizationHeader', pattern: /authorization:\s*[^\s\n]+/gi },
  { name: 'cookieHeader', pattern: /cookie:\s*[^\s\n]+/gi },
  { name: 'bearerToken', pattern: /Bearer\s+[A-Za-z0-9\-_]+\.?[A-Za-z0-9\-_]*\.?[A-Za-z0-9\-_]*/gi },
  { name: 'jwtToken', pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g },
  { name: 'apiKey', pattern: /sk[-_][A-Za-z0-9]{20,}/g },
] as const;

interface RedactionReport {
  totalRedactions: number;
  byRule: {
    authorizationHeader: number;
    cookieHeader: number;
    bearerToken: number;
    jwtToken: number;
    apiKey: number;
  };
}

function redactString(input: string, report: RedactionReport): string {
  let result = input;
  for (const { name, pattern } of REDACTION_PATTERNS) {
    const matches = result.match(pattern);
    if (matches) {
      report.byRule[name as keyof typeof report.byRule] += matches.length;
      report.totalRedactions += matches.length;
    }
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function createReport(): RedactionReport {
  return {
    totalRedactions: 0,
    byRule: {
      authorizationHeader: 0,
      cookieHeader: 0,
      bearerToken: 0,
      jwtToken: 0,
      apiKey: 0,
    },
  };
}

describe('CLI Redaction', () => {
  describe('Authorization header', () => {
    it('should redact Authorization header', () => {
      const report = createReport();
      const result = redactString('Authorization: token123', report);
      assert.ok(result.includes('[REDACTED]'));
      assert.ok(!result.includes('token123'));
      assert.strictEqual(report.byRule.authorizationHeader, 1);
    });

    it('should redact lowercase authorization header', () => {
      const report = createReport();
      const result = redactString('authorization: secret-token', report);
      assert.ok(result.includes('[REDACTED]'));
    });
  });

  describe('Cookie header', () => {
    it('should redact Cookie header', () => {
      const report = createReport();
      const result = redactString('Cookie: session=abc123', report);
      assert.ok(result.includes('[REDACTED]'));
      assert.strictEqual(report.byRule.cookieHeader, 1);
    });
  });

  describe('Bearer tokens', () => {
    it('should redact Bearer token', () => {
      const report = createReport();
      const result = redactString('Token was: Bearer eyJhbGciOiJIUzI1NiJ9', report);
      assert.ok(result.includes('[REDACTED]'));
      assert.strictEqual(report.byRule.bearerToken, 1);
    });

    it('should redact simple Bearer token', () => {
      const report = createReport();
      const result = redactString('Bearer abc123xyz', report);
      assert.strictEqual(result, '[REDACTED]');
    });
  });

  describe('JWT tokens', () => {
    it('should redact JWT token', () => {
      const report = createReport();
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const result = redactString(`Token: ${jwt}`, report);
      assert.ok(result.includes('[REDACTED]'));
      assert.strictEqual(report.byRule.jwtToken, 1);
    });
  });

  describe('API keys', () => {
    it('should redact sk- style API keys', () => {
      const report = createReport();
      const result = redactString('API key: sk-1234567890abcdefghijklmn', report);
      assert.ok(result.includes('[REDACTED]'));
      assert.strictEqual(report.byRule.apiKey, 1);
    });

    it('should redact sk_ style API keys', () => {
      const report = createReport();
      // Key must have 20+ alphanumeric chars after sk_ (no internal underscores)
      const result = redactString('Key: sk_1234567890abcdefghijklmn', report);
      assert.ok(result.includes('[REDACTED]'));
    });

    it('should not redact short sk- strings', () => {
      const report = createReport();
      const result = redactString('sk-short', report);
      assert.strictEqual(result, 'sk-short');
      assert.strictEqual(report.byRule.apiKey, 0);
    });
  });

  describe('Multiple redactions', () => {
    it('should redact multiple sensitive values', () => {
      const report = createReport();
      const input = `
        Authorization: token123
        Cookie: session=abc
        API Key: sk-12345678901234567890abcd
      `;
      const result = redactString(input, report);
      assert.ok(report.totalRedactions >= 2);
      assert.ok(!result.includes('token123'));
    });
  });

  describe('Safe content', () => {
    it('should not redact normal log messages', () => {
      const report = createReport();
      const input = 'User logged in successfully at /api/users';
      const result = redactString(input, report);
      assert.strictEqual(result, input);
      assert.strictEqual(report.totalRedactions, 0);
    });

    it('should not redact error messages', () => {
      const report = createReport();
      const input = 'Error: Failed to fetch data from /api/users - 500 Internal Server Error';
      const result = redactString(input, report);
      assert.strictEqual(result, input);
    });
  });
});
