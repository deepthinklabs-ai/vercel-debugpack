/**
 * Local HTTP server for browser-initiated bundle creation.
 * Run with: npx debugpack serve --project my-app
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';

// Types
export interface ServerConfig {
  port: number;
  outputDir: string;
  projectName?: string;
  minutesBack: number;
}

export interface BrowserLogEntry {
  ts: string;
  level: 'error' | 'warn' | 'event';
  type: 'console' | 'window_error' | 'unhandled_rejection' | 'fetch';
  message: string;
  stack: string | null;
  url: string | null;
  debugSessionId: string;
  meta?: {
    method?: string;
    status?: number;
    durationMs?: number;
  };
}

export interface BundleRequest {
  browserLogs: BrowserLogEntry[];
  sessionId: string;
  metadata: {
    stagingUrl: string;
    userAgent: string;
    timestamp: string;
  };
}

export interface BundleResponse {
  success: boolean;
  bundlePath?: string;
  error?: string;
  summary?: {
    browserLogCount: number;
    vercelLogLines: number;
    sessionId: string;
  };
}

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

interface ContextJson {
  createdAt: string;
  env: string;
  minutesBack: number;
  stagingUrl: string | null;
  git: {
    sha: string | null;
    branch: string | null;
  };
  debugSessionId: string | null;
  nodeVersion: string;
  browserLogCount: number;
  vercelLogLines: number;
}

// Redaction patterns (same as CLI)
const REDACTION_PATTERNS = [
  { name: 'authorizationHeader', pattern: /authorization:\s*[^\s\n]+/gi },
  { name: 'cookieHeader', pattern: /cookie:\s*[^\s\n]+/gi },
  { name: 'bearerToken', pattern: /Bearer\s+[A-Za-z0-9\-_]+\.?[A-Za-z0-9\-_]*\.?[A-Za-z0-9\-_]*/gi },
  { name: 'jwtToken', pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g },
  { name: 'apiKey', pattern: /sk[-_][A-Za-z0-9]{20,}/g },
] as const;

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

function getGitInfo(): { sha: string | null; branch: string | null } {
  let sha: string | null = null;
  let branch: string | null = null;

  try {
    sha = execSync('git rev-parse HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    // Not a git repo or git not available
  }

  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    // Not a git repo or git not available
  }

  return { sha, branch };
}

function checkVercelCli(): boolean {
  try {
    execSync('vercel --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function fetchVercelLogs(
  project: string | undefined,
  minutes: number
): string {
  if (!checkVercelCli()) {
    return '# Vercel CLI not found or not authenticated\n# Install with: npm i -g vercel\n# Then run: vercel login\n';
  }

  const cutoffTime = new Date(Date.now() - minutes * 60 * 1000);

  try {
    let logsOutput: string;

    if (project) {
      // List deployments and get the latest preview deployment
      console.log(`  Finding latest preview deployment for project: ${project}`);

      const listResult = spawnSync('vercel', ['list', project, '--meta', 'env=preview', '-n', '1'], {
        encoding: 'utf-8',
        timeout: 30000,
        shell: true,
      });

      if (listResult.error) {
        throw listResult.error;
      }

      // Parse the deployment URL from output
      const listOutput = listResult.stdout || '';
      const urlMatch = listOutput.match(/https:\/\/[^\s]+\.vercel\.app/);

      if (!urlMatch) {
        // Fallback: try to get logs directly with project name
        console.log('  Could not find specific deployment, fetching recent project logs...');
        const result = spawnSync('vercel', ['logs', project, '--output', 'raw'], {
          encoding: 'utf-8',
          timeout: 60000,
          shell: true,
        });

        if (result.error) {
          throw result.error;
        }

        logsOutput = result.stdout || '';
      } else {
        const deploymentUrl = urlMatch[0];
        console.log(`  Found deployment: ${deploymentUrl}`);

        const result = spawnSync('vercel', ['logs', deploymentUrl, '--output', 'raw'], {
          encoding: 'utf-8',
          timeout: 60000,
          shell: true,
        });

        if (result.error) {
          throw result.error;
        }

        logsOutput = result.stdout || '';
      }
    } else {
      return '# No project configured for server\n# Start server with: npx debugpack serve --project my-app\n';
    }

    const header = `# Vercel logs fetched at ${new Date().toISOString()}\n# Time window: last ${minutes} minutes (from ${cutoffTime.toISOString()})\n# Note: Logs may include entries outside this window; filter by debugSessionId for accuracy\n\n`;

    return header + logsOutput;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `# Error fetching Vercel logs: ${errorMessage}\n# Make sure you're logged in: vercel login\n`;
  }
}

function generateSummary(
  browserLogs: BrowserLogEntry[],
  vercelLogs: string,
  context: ContextJson,
  sessionId: string | null
): string {
  const errors = browserLogs.filter((log) => log.level === 'error');
  const warns = browserLogs.filter((log) => log.level === 'warn');
  const fetchLogs = browserLogs.filter((log) => log.type === 'fetch');

  // Count unique error messages
  const errorCounts = new Map<string, number>();
  for (const log of errors) {
    const key = log.message.slice(0, 200);
    errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
  }

  // Get top 5 errors
  const topErrors = [...errorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Count failing endpoints
  const failingEndpoints = new Map<string, number>();
  for (const log of fetchLogs) {
    if (log.level === 'error' && log.url) {
      failingEndpoints.set(log.url, (failingEndpoints.get(log.url) || 0) + 1);
    }
  }

  const topFailingEndpoints = [...failingEndpoints.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  let summary = `# Debug Bundle Summary

Generated: ${context.createdAt}

## Session Info

- **Debug Session ID**: ${sessionId || 'Unknown'}
- **Environment**: ${context.env}
- **Time Window**: Last ${context.minutesBack} minutes
- **Staging URL**: ${context.stagingUrl || 'Not specified'}

## Git Info

- **SHA**: ${context.git.sha || 'Unknown'}
- **Branch**: ${context.git.branch || 'Unknown'}

## Browser Logs

- **Total Entries**: ${browserLogs.length}
- **Errors**: ${errors.length}
- **Warnings**: ${warns.length}
- **Network Failures**: ${fetchLogs.filter((l) => l.level === 'error').length}

`;

  if (topErrors.length > 0) {
    summary += `### Top Errors

${topErrors.map(([msg, count], i) => `${i + 1}. (${count}x) ${msg}`).join('\n')}

`;
  }

  if (topFailingEndpoints.length > 0) {
    summary += `### Failing Endpoints

${topFailingEndpoints.map(([url, count], i) => `${i + 1}. (${count}x) ${url}`).join('\n')}

`;
  }

  summary += `## Vercel Logs

- **Lines**: ${vercelLogs.split('\n').length}

## Files in Bundle

- \`context.json\` - Metadata about this debug session
- \`browser-logs.jsonl\` - Browser console/error/network logs (JSONL format)
- \`vercel-logs.txt\` - Server-side logs from Vercel
- \`summary.md\` - This file
- \`redaction_report.json\` - Summary of redacted sensitive data

## How to Use

1. Point Claude Code at this folder: \`claude --dir ./debug-bundle\`
2. Or attach files directly in your conversation
3. The \`debugSessionId\` can be used to correlate browser and server logs
`;

  return summary;
}

async function parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function handleBundleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ServerConfig
): Promise<void> {
  try {
    // Parse request body
    const body = await parseJsonBody<BundleRequest>(req);

    console.log(`\nReceived bundle request for session: ${body.sessionId}`);
    console.log(`  Browser logs: ${body.browserLogs.length} entries`);

    // Apply redaction to browser logs
    const redactionReport: RedactionReport = {
      totalRedactions: 0,
      byRule: {
        authorizationHeader: 0,
        cookieHeader: 0,
        bearerToken: 0,
        jwtToken: 0,
        apiKey: 0,
      },
    };

    const redactedBrowserLogs = body.browserLogs.map((log) => ({
      ...log,
      message: redactString(log.message, redactionReport),
      stack: log.stack ? redactString(log.stack, redactionReport) : null,
    }));

    // Fetch Vercel logs if project is configured
    let vercelLogs = '# No Vercel project configured\n';
    if (config.projectName) {
      console.log(`  Fetching Vercel logs for: ${config.projectName}`);
      vercelLogs = fetchVercelLogs(config.projectName, config.minutesBack);
      vercelLogs = redactString(vercelLogs, redactionReport);
    }

    console.log(`  Redacted ${redactionReport.totalRedactions} sensitive values`);

    // Get git info
    const gitInfo = getGitInfo();

    // Build context
    const context: ContextJson = {
      createdAt: new Date().toISOString(),
      env: 'staging',
      minutesBack: config.minutesBack,
      stagingUrl: body.metadata.stagingUrl || null,
      git: gitInfo,
      debugSessionId: body.sessionId,
      nodeVersion: process.version,
      browserLogCount: redactedBrowserLogs.length,
      vercelLogLines: vercelLogs.split('\n').length,
    };

    // Generate summary
    const summary = generateSummary(redactedBrowserLogs, vercelLogs, context, body.sessionId);

    // Create output directory
    const outDir = path.resolve(config.outputDir);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Write files
    console.log(`  Writing bundle to ${outDir}...`);

    fs.writeFileSync(
      path.join(outDir, 'context.json'),
      JSON.stringify(context, null, 2)
    );

    fs.writeFileSync(
      path.join(outDir, 'browser-logs.jsonl'),
      redactedBrowserLogs.map((log) => JSON.stringify(log)).join('\n')
    );

    fs.writeFileSync(
      path.join(outDir, 'vercel-logs.txt'),
      vercelLogs
    );

    fs.writeFileSync(
      path.join(outDir, 'summary.md'),
      summary
    );

    fs.writeFileSync(
      path.join(outDir, 'redaction_report.json'),
      JSON.stringify(redactionReport, null, 2)
    );

    console.log(`  Bundle created successfully!`);

    const response: BundleResponse = {
      success: true,
      bundlePath: outDir,
      summary: {
        browserLogCount: redactedBrowserLogs.length,
        vercelLogLines: vercelLogs.split('\n').length,
        sessionId: body.sessionId,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));

  } catch (error) {
    console.error('  Bundle creation failed:', error);

    const response: BundleResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }
}

function createServer(config: ServerConfig): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS headers for browser requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${config.port}`);

    // GET /health - Server detection
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
      return;
    }

    // GET /config - Return server configuration
    if (url.pathname === '/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        projectName: config.projectName || null,
        outputDir: config.outputDir,
      }));
      return;
    }

    // POST /bundle - Create debug bundle
    if (url.pathname === '/bundle' && req.method === 'POST') {
      await handleBundleRequest(req, res, config);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return server;
}

/**
 * Ensure the output directory is in .gitignore
 */
function ensureGitignore(outputDir: string): void {
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  const relativePath = path.relative(process.cwd(), path.resolve(outputDir));
  const entry = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;

  // Also handle the directory name without ./
  const dirName = path.basename(outputDir);

  try {
    let content = '';
    let needsUpdate = false;

    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
      const lines = content.split('\n').map(l => l.trim());

      // Check if already ignored (exact match or with trailing slash)
      const isIgnored = lines.some(line =>
        line === dirName ||
        line === `${dirName}/` ||
        line === entry ||
        line === `${entry}/`
      );

      if (!isIgnored) {
        needsUpdate = true;
        // Add to existing .gitignore
        content = content.trimEnd() + `\n\n# Debug bundles\n${dirName}/\n`;
      }
    } else {
      // Create new .gitignore
      needsUpdate = true;
      content = `# Debug bundles\n${dirName}/\n`;
    }

    if (needsUpdate) {
      fs.writeFileSync(gitignorePath, content);
      console.log(`Added "${dirName}/" to .gitignore`);
    }
  } catch (error) {
    // Silently fail - not critical
    console.warn('Could not update .gitignore:', error instanceof Error ? error.message : error);
  }
}

export function startServer(config: Partial<ServerConfig> = {}): void {
  const fullConfig: ServerConfig = {
    port: config.port ?? 3847,
    outputDir: config.outputDir ?? './debug-bundle',
    projectName: config.projectName,
    minutesBack: config.minutesBack ?? 15,
  };

  // Ensure output directory is gitignored
  ensureGitignore(fullConfig.outputDir);

  const server = createServer(fullConfig);

  server.listen(fullConfig.port, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                   Debugpack Server                         ║
╠════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${String(fullConfig.port).padEnd(23)}║
║  Output directory:  ${fullConfig.outputDir.padEnd(37)}║
${fullConfig.projectName ? `║  Vercel project:    ${fullConfig.projectName.padEnd(37)}║\n` : ''}║  Minutes of logs:   ${String(fullConfig.minutesBack).padEnd(37)}║
╚════════════════════════════════════════════════════════════╝

Waiting for browser connections...
Press Ctrl+C to stop the server.
`);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
      console.log('Server stopped.');
      process.exit(0);
    });
  });
}
