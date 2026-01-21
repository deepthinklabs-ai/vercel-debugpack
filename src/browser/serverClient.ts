/**
 * Browser-side client for communicating with the local debugpack server.
 * Handles server detection, probing, and bundle creation requests.
 */

import type { LogEntry } from './types';

export interface ServerStatus {
  available: boolean;
  version?: string;
  projectName?: string | null;
  outputDir?: string;
  lastChecked: number;
}

export interface BundleResult {
  success: boolean;
  bundlePath?: string;
  error?: string;
  summary?: {
    browserLogCount: number;
    vercelLogLines: number;
    sessionId: string;
  };
}

const DEFAULT_SERVER_URL = 'http://localhost:3847';
const PROBE_TIMEOUT_MS = 2000;
const PROBE_CACHE_MS = 30000; // Re-check every 30 seconds

let cachedStatus: ServerStatus | null = null;

/**
 * Probe the local debugpack server to check if it's running.
 * Results are cached for 30 seconds.
 */
export async function probeServer(
  serverUrl: string = DEFAULT_SERVER_URL
): Promise<ServerStatus> {
  // Return cached result if fresh
  if (cachedStatus && Date.now() - cachedStatus.lastChecked < PROBE_CACHE_MS) {
    return cachedStatus;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const response = await fetch(`${serverUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();

      // Fetch config for project name and output dir
      let projectName: string | null = null;
      let outputDir: string | undefined;
      try {
        const configResponse = await fetch(`${serverUrl}/config`, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (configResponse.ok) {
          const config = await configResponse.json();
          projectName = config.projectName;
          outputDir = config.outputDir;
        }
      } catch {
        // Config fetch failed, continue without it
      }

      cachedStatus = {
        available: true,
        version: data.version,
        projectName,
        outputDir,
        lastChecked: Date.now(),
      };
    } else {
      cachedStatus = { available: false, lastChecked: Date.now() };
    }
  } catch {
    cachedStatus = { available: false, lastChecked: Date.now() };
  }

  return cachedStatus;
}

/**
 * Force a fresh server probe (bypass cache).
 */
export async function refreshServerStatus(
  serverUrl: string = DEFAULT_SERVER_URL
): Promise<ServerStatus> {
  cachedStatus = null;
  return probeServer(serverUrl);
}

/**
 * Clear the cached server status.
 */
export function clearServerStatusCache(): void {
  cachedStatus = null;
}

/**
 * Send browser logs to the local server to create a bundle.
 */
export async function createBundleOnServer(
  logs: LogEntry[],
  sessionId: string,
  serverUrl: string = DEFAULT_SERVER_URL
): Promise<BundleResult> {
  const request = {
    browserLogs: logs,
    sessionId,
    metadata: {
      stagingUrl: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      timestamp: new Date().toISOString(),
    },
  };

  try {
    const response = await fetch(`${serverUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const result = await response.json();
    return result as BundleResult;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to connect to server',
    };
  }
}

/**
 * Get the default server URL.
 */
export function getDefaultServerUrl(): string {
  return DEFAULT_SERVER_URL;
}
