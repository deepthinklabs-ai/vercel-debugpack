#!/usr/bin/env node
/**
 * debugpack CLI - generates debug bundles from browser logs + Vercel logs.
 *
 * Usage:
 *   debugpack --browserLog ~/Downloads/browser-logs.jsonl --project my-app --minutes 15
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import { startServer } from './server';

// Types for parsed browser logs
interface BrowserLogEntry {
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

// Redaction patterns
const REDACTION_PATTERNS = [
  { name: 'authorizationHeader', pattern: /authorization:\s*[^\s\n]+/gi },
  { name: 'cookieHeader', pattern: /cookie:\s*[^\s\n]+/gi },
  { name: 'bearerToken', pattern: /Bearer\s+[A-Za-z0-9\-_]+\.?[A-Za-z0-9\-_]*\.?[A-Za-z0-9\-_]*/gi },
  { name: 'jwtToken', pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g },
  { name: 'apiKey', pattern: /sk[-_][A-Za-z0-9]{20,}/g },
] as const;

/**
 * Apply redaction to a string and track what was redacted.
 */
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

/**
 * Read and parse browser log file.
 */
function readBrowserLogs(filePath: string): BrowserLogEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter((line) => line.trim());

  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as BrowserLogEntry;
    } catch {
      console.warn(`Warning: Could not parse line ${index + 1} in browser log file`);
      return null;
    }
  }).filter((entry): entry is BrowserLogEntry => entry !== null);
}

/**
 * Extract debug session ID from browser logs.
 */
function extractSessionId(logs: BrowserLogEntry[]): string | null {
  for (const log of logs) {
    if (log.debugSessionId) {
      return log.debugSessionId;
    }
  }
  return null;
}

/**
 * Get git info from current directory.
 */
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

/**
 * Check if Vercel CLI is available.
 */
function checkVercelCli(): boolean {
  try {
    execSync('vercel --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch Vercel logs for a project.
 */
function fetchVercelLogs(
  project: string | undefined,
  deployment: string | undefined,
  minutes: number
): string {
  if (!checkVercelCli()) {
    return '# Vercel CLI not found or not authenticated\n# Install with: npm i -g vercel\n# Then run: vercel login\n';
  }

  const cutoffTime = new Date(Date.now() - minutes * 60 * 1000);

  try {
    let logsOutput: string;

    if (deployment) {
      // Use specific deployment URL
      console.log(`Fetching logs for deployment: ${deployment}`);
      const result = spawnSync('vercel', ['logs', deployment, '--output', 'raw'], {
        encoding: 'utf-8',
        timeout: 60000,
        shell: true,
      });

      if (result.error) {
        throw result.error;
      }

      logsOutput = result.stdout || '';

      if (result.stderr && !result.stderr.includes('Fetching')) {
        console.warn('Vercel CLI warning:', result.stderr);
      }
    } else if (project) {
      // List deployments and get the latest preview deployment
      console.log(`Finding latest preview deployment for project: ${project}`);

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
        console.log('Could not find specific deployment, fetching recent project logs...');
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
        console.log(`Found deployment: ${deploymentUrl}`);

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
      return '# No project or deployment specified\n';
    }

    // Filter logs by time if possible (Vercel CLI doesn't always include timestamps)
    // Just return all logs with a note about the time window
    const header = `# Vercel logs fetched at ${new Date().toISOString()}\n# Time window: last ${minutes} minutes (from ${cutoffTime.toISOString()})\n# Note: Logs may include entries outside this window; filter by debugSessionId for accuracy\n\n`;

    return header + logsOutput;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `# Error fetching Vercel logs: ${errorMessage}\n# Make sure you're logged in: vercel login\n`;
  }
}

/**
 * Generate summary markdown.
 */
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

/**
 * Main CLI entry point.
 */
export function main(): void {
  const program = new Command();

  program
    .name('debugpack')
    .description('Generate debug bundles from browser logs + Vercel logs')
    .version('0.1.0')
    .requiredOption('--browserLog <path>', 'Path to browser-logs.jsonl file')
    .option('--project <name>', 'Vercel project name')
    .option('--deployment <url>', 'Specific Vercel deployment URL')
    .option('--env <env>', 'Environment name', 'staging')
    .option('--minutes <n>', 'Minutes of logs to include', '15')
    .option('--stagingUrl <url>', 'Staging site URL for context')
    .option('--out <dir>', 'Output directory', './debug-bundle')
    .option('--sessionId <id>', 'Override debug session ID')
    .action(async (options: {
      browserLog: string;
      project?: string;
      deployment?: string;
      env: string;
      minutes: string;
      stagingUrl?: string;
      out: string;
      sessionId?: string;
    }) => {
      const {
        browserLog,
        project,
        deployment,
        env,
        minutes: minutesStr,
        stagingUrl,
        out,
        sessionId: overrideSessionId,
      } = options;

      const minutes = parseInt(minutesStr, 10);

      // Validate inputs
      if (!project && !deployment) {
        console.error('Error: Either --project or --deployment is required');
        process.exit(1);
      }

      if (!fs.existsSync(browserLog)) {
        console.error(`Error: Browser log file not found: ${browserLog}`);
        process.exit(1);
      }

      console.log('Creating debug bundle...\n');

      // Read browser logs
      console.log('Reading browser logs...');
      const browserLogs = readBrowserLogs(browserLog);
      console.log(`  Found ${browserLogs.length} entries`);

      // Extract session ID
      const sessionId = overrideSessionId || extractSessionId(browserLogs);
      if (sessionId) {
        console.log(`  Session ID: ${sessionId}`);
      }

      // Fetch Vercel logs
      console.log('\nFetching Vercel logs...');
      let vercelLogs = fetchVercelLogs(project, deployment, minutes);
      console.log(`  Fetched ${vercelLogs.split('\n').length} lines`);

      // Apply redaction
      console.log('\nApplying redaction...');
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

      // Redact browser logs
      const redactedBrowserLogs = browserLogs.map((log) => ({
        ...log,
        message: redactString(log.message, redactionReport),
        stack: log.stack ? redactString(log.stack, redactionReport) : null,
      }));

      // Redact Vercel logs
      vercelLogs = redactString(vercelLogs, redactionReport);

      console.log(`  Redacted ${redactionReport.totalRedactions} sensitive values`);

      // Get git info
      const gitInfo = getGitInfo();

      // Build context
      const context: ContextJson = {
        createdAt: new Date().toISOString(),
        env,
        minutesBack: minutes,
        stagingUrl: stagingUrl || null,
        git: gitInfo,
        debugSessionId: sessionId,
        nodeVersion: process.version,
        browserLogCount: redactedBrowserLogs.length,
        vercelLogLines: vercelLogs.split('\n').length,
      };

      // Generate summary
      const summary = generateSummary(redactedBrowserLogs, vercelLogs, context, sessionId);

      // Create output directory
      const outDir = path.resolve(out);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      // Write files
      console.log(`\nWriting bundle to ${outDir}...`);

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

      console.log('\nDebug bundle created successfully!');
      console.log(`\nFiles:`);
      console.log(`  ${path.join(outDir, 'context.json')}`);
      console.log(`  ${path.join(outDir, 'browser-logs.jsonl')}`);
      console.log(`  ${path.join(outDir, 'vercel-logs.txt')}`);
      console.log(`  ${path.join(outDir, 'summary.md')}`);
      console.log(`  ${path.join(outDir, 'redaction_report.json')}`);

      if (sessionId) {
        console.log(`\nTo filter Vercel logs by session, search for: debugSessionId=${sessionId}`);
      }
    });

  // Add init subcommand
  program
    .command('init')
    .description('Initialize debugpack configuration for this project')
    .action(async () => {
      const configPath = path.join(process.cwd(), 'debugpack.config.json');
      const readline = await import('readline');

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const question = (prompt: string): Promise<string> => {
        return new Promise((resolve) => {
          rl.question(prompt, (answer) => {
            resolve(answer);
          });
        });
      };

      console.log('\n🔧 Debugpack Setup\n');
      console.log(`Project directory: ${process.cwd()}\n`);

      // Check for existing config
      let existingConfig: { project?: string; out?: string } = {};
      if (fs.existsSync(configPath)) {
        try {
          existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          console.log('Found existing config. Press Enter to keep current values.\n');
        } catch {
          // Ignore parse errors
        }
      }

      // Prompt for project name
      const defaultProject = existingConfig.project || '';
      const projectPrompt = defaultProject
        ? `Vercel project name [${defaultProject}]: `
        : 'Vercel project name: ';
      const projectInput = await question(projectPrompt);
      const project = projectInput.trim() || defaultProject;

      // Prompt for output directory
      const defaultOut = existingConfig.out || './debug-bundle';
      const outInput = await question(`Output directory [${defaultOut}]: `);
      const out = outInput.trim() || defaultOut;

      rl.close();

      // Save config
      const config = { project, out };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      // Ensure gitignore
      const gitignorePath = path.join(process.cwd(), '.gitignore');
      const outDirName = path.basename(out);
      let gitignoreContent = '';

      if (fs.existsSync(gitignorePath)) {
        gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
      }

      const entriesToAdd: string[] = [];
      if (!gitignoreContent.includes('debugpack.config.json')) {
        entriesToAdd.push('debugpack.config.json');
      }
      if (!gitignoreContent.includes(outDirName)) {
        entriesToAdd.push(`${outDirName}/`);
      }

      if (entriesToAdd.length > 0) {
        const addition = `\n# Debugpack\n${entriesToAdd.join('\n')}\n`;
        fs.writeFileSync(gitignorePath, gitignoreContent.trimEnd() + addition);
      }

      console.log('\n✅ Configuration saved to debugpack.config.json');
      console.log(`\nTo start debugging, run:\n`);
      console.log(`  npx debugpack serve\n`);
    });

  // Add serve subcommand
  program
    .command('serve')
    .description('Start local server for browser-initiated bundle creation')
    .option('--port <number>', 'Server port', '3847')
    .option('--out <dir>', 'Output directory for bundles')
    .option('--project <name>', 'Vercel project name for log fetching')
    .option('--minutes <n>', 'Minutes of Vercel logs to include', '15')
    .action((options: {
      port: string;
      out?: string;
      project?: string;
      minutes: string;
    }) => {
      // Load config file if exists
      const configPath = path.join(process.cwd(), 'debugpack.config.json');
      let fileConfig: { project?: string; out?: string } = {};

      if (fs.existsSync(configPath)) {
        try {
          fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch {
          // Ignore parse errors
        }
      }

      // CLI options override config file
      const project = options.project || fileConfig.project;
      const out = options.out || fileConfig.out || './debug-bundle';

      if (!project) {
        console.log('No Vercel project configured.');
        console.log('Run "npx debugpack init" to set up, or use --project flag.\n');
      }

      startServer({
        port: parseInt(options.port, 10),
        outputDir: out,
        projectName: project,
        minutesBack: parseInt(options.minutes, 10),
      });
    });

  program.parse();
}

// Run CLI
main();
