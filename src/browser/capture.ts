/**
 * Vanilla JS debug capture core.
 * Framework-agnostic implementation that can be used standalone or wrapped by React.
 */

import type { LogEntry, DebugConfig, DebugCaptureState } from './types';
import { sanitizeUrl, truncateString, safeStringify, extractStack } from './redaction';

// Global state - singleton pattern for browser environment
let state: DebugCaptureState | null = null;

/** Storage key for keyboard-activated debug mode */
const DEBUG_KEYBOARD_KEY = 'vercel-debugpack-keyboard-enabled';

/** Flag to prevent multiple keyboard shortcut listeners */
let keyboardShortcutSetup = false;

/** Stored custom isEnabled function from user config (used by toggleDebugMode) */
let customIsEnabled: (() => boolean) | null = null;

/** Stored custom preview URL pattern from user config */
let customPreviewUrlPattern: string | RegExp | ((hostname: string) => boolean) | null = null;

/** Stored keyboard shortcut key (default: ';') */
let keyboardShortcutKey = ';';

/** Debug mode for verbose logging - enable via localStorage */
function isVerboseDebug(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem('vercel-debugpack-verbose') === 'true';
}

/** Log helper for debug messages */
function debugLog(...args: unknown[]): void {
  if (isVerboseDebug()) {
    console.log('[debugpack:verbose]', ...args);
  }
}

/**
 * Set the custom preview URL pattern.
 * Call this before setupKeyboardShortcut() to ensure the keyboard shortcut
 * can correctly detect preview environments with custom domains.
 */
export function setPreviewUrlPattern(pattern: string | RegExp | ((hostname: string) => boolean) | undefined): void {
  debugLog('setPreviewUrlPattern called with:', pattern ? (typeof pattern === 'function' ? 'function' : pattern) : 'undefined');
  if (pattern !== undefined) {
    customPreviewUrlPattern = pattern;
    debugLog('customPreviewUrlPattern set to:', typeof pattern === 'function' ? 'function' : pattern);
  }
}

/**
 * Set the keyboard shortcut key.
 * Call this before setupKeyboardShortcut() to customize the activation key.
 * @param key - The key to use with Ctrl+Shift (or Cmd+Shift on Mac). Default is 'D'.
 */
export function setKeyboardShortcutKey(key: string | undefined): void {
  if (key) {
    keyboardShortcutKey = key.toUpperCase();
    debugLog('keyboardShortcutKey set to:', keyboardShortcutKey);
  }
}

/**
 * Generate a UUID v4 for debug session identification.
 */
function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback using crypto.getRandomValues (secure)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // Set version (4) and variant (RFC 4122)
    const b6 = bytes[6]!;
    const b8 = bytes[8]!;
    bytes[6] = (b6 & 0x0f) | 0x40;
    bytes[8] = (b8 & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last resort fallback for very old environments (non-secure, but functional)
  return `debug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Get or create a debug session ID.
 * Persists in sessionStorage so it survives page refreshes during a debug session.
 */
function getOrCreateSessionId(): string {
  const STORAGE_KEY = 'vercel-debugpack-session-id';

  if (typeof sessionStorage !== 'undefined') {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const newId = generateSessionId();
    sessionStorage.setItem(STORAGE_KEY, newId);
    return newId;
  }

  return generateSessionId();
}

/**
 * Check if debug was enabled via keyboard shortcut.
 */
function isKeyboardEnabled(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  return sessionStorage.getItem(DEBUG_KEYBOARD_KEY) === 'true';
}

/**
 * Set keyboard-enabled state.
 */
function setKeyboardEnabled(enabled: boolean): void {
  if (typeof sessionStorage === 'undefined') return;
  if (enabled) {
    sessionStorage.setItem(DEBUG_KEYBOARD_KEY, 'true');
  } else {
    sessionStorage.removeItem(DEBUG_KEYBOARD_KEY);
  }
}

/**
 * Check if hostname matches the custom preview URL pattern.
 */
function matchesCustomPreviewPattern(hostname: string): boolean {
  debugLog('matchesCustomPreviewPattern called with hostname:', hostname);
  debugLog('customPreviewUrlPattern is:', customPreviewUrlPattern ? (typeof customPreviewUrlPattern === 'function' ? 'function' : customPreviewUrlPattern) : 'null');

  if (!customPreviewUrlPattern) {
    debugLog('No custom pattern set, returning false');
    return false;
  }

  let result = false;

  if (typeof customPreviewUrlPattern === 'string') {
    result = hostname.includes(customPreviewUrlPattern);
    debugLog('String pattern match result:', result);
  } else if (customPreviewUrlPattern instanceof RegExp) {
    result = customPreviewUrlPattern.test(hostname);
    debugLog('RegExp pattern match result:', result);
  } else if (typeof customPreviewUrlPattern === 'function') {
    result = customPreviewUrlPattern(hostname);
    debugLog('Function pattern match result:', result);
  }

  return result;
}

/**
 * Check if we're in a Vercel preview environment.
 * Supports multiple detection methods for compatibility with:
 * - Custom preview URL patterns (via config.previewUrlPattern)
 * - Next.js Pages Router (via __NEXT_DATA__)
 * - Next.js App Router (via NEXT_PUBLIC_VERCEL_ENV or URL detection)
 * - Other frameworks on Vercel
 */
function isPreviewEnvironment(): boolean {
  debugLog('isPreviewEnvironment called');

  if (typeof window === 'undefined') {
    debugLog('window is undefined, returning false');
    return false;
  }

  const hostname = window.location.hostname;
  debugLog('Current hostname:', hostname);

  // Method 0: Check custom preview URL pattern (highest priority)
  // This allows users to specify their own preview domain patterns
  if (customPreviewUrlPattern && matchesCustomPreviewPattern(hostname)) {
    debugLog('Method 0 (custom pattern) matched!');
    return true;
  }

  // Method 1: Check NEXT_PUBLIC_VERCEL_ENV (works in App Router if user sets it)
  // Users can set NEXT_PUBLIC_VERCEL_ENV=$VERCEL_ENV in Vercel project settings
  const nextPublicVercelEnv = typeof process !== 'undefined'
    ? process.env?.NEXT_PUBLIC_VERCEL_ENV
    : undefined;
  debugLog('Method 1 - NEXT_PUBLIC_VERCEL_ENV:', nextPublicVercelEnv);
  if (nextPublicVercelEnv === 'preview') {
    debugLog('Method 1 matched!');
    return true;
  }

  // Method 2: Check window.__NEXT_DATA__ (Pages Router only)
  const nextData = (window as unknown as { __NEXT_DATA__?: { env?: { VERCEL_ENV?: string } } }).__NEXT_DATA__;
  debugLog('Method 2 - __NEXT_DATA__.env.VERCEL_ENV:', nextData?.env?.VERCEL_ENV);
  if (nextData?.env?.VERCEL_ENV === 'preview') {
    debugLog('Method 2 matched!');
    return true;
  }

  // Method 3: Check for custom injected global (for App Router users)
  // Users can add: window.__VERCEL_ENV__ = 'preview' in their layout
  const injectedEnv = (window as unknown as { __VERCEL_ENV__?: string }).__VERCEL_ENV__;
  debugLog('Method 3 - window.__VERCEL_ENV__:', injectedEnv);
  if (injectedEnv === 'preview') {
    debugLog('Method 3 matched!');
    return true;
  }

  // Method 4: URL-based detection for Vercel preview deployments
  // Preview URLs follow pattern: <project>-<hash>-<scope>.vercel.app
  // or custom preview domains, but NOT production domains
  // Check for Vercel preview URL pattern (has hash in subdomain)
  // Production is typically: <project>.vercel.app or custom domain
  // Preview is typically: <project>-<hash>-<scope>.vercel.app
  if (hostname.endsWith('.vercel.app')) {
    // Count dashes in the subdomain part
    const subdomain = hostname.replace('.vercel.app', '');
    const dashCount = (subdomain.match(/-/g) || []).length;
    debugLog('Method 4 - Vercel URL subdomain:', subdomain, 'dashCount:', dashCount);
    // Preview URLs typically have 2+ dashes (project-hash-scope)
    // Production URLs typically have 0-1 dashes (project or project-name)
    if (dashCount >= 2) {
      debugLog('Method 4 matched!');
      return true;
    }
  }

  // Method 5: Legacy process.env check (may work in some bundler configs)
  const processVercelEnv = typeof process !== 'undefined' ? process.env?.VERCEL_ENV : undefined;
  debugLog('Method 5 - process.env.VERCEL_ENV:', processVercelEnv);
  if (processVercelEnv === 'preview') {
    debugLog('Method 5 matched!');
    return true;
  }

  debugLog('No preview environment detected');
  return false;
}

/**
 * Default check for whether debug mode should be enabled.
 * Requires VERCEL_ENV === 'preview' AND keyboard shortcut activated (Ctrl+Shift+L).
 */
function defaultIsEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // Must be in preview environment
  if (!isPreviewEnvironment()) {
    return false;
  }

  // Only keyboard activation enables debug mode
  return isKeyboardEnabled();
}

/**
 * Add a log entry to the buffer.
 */
function addLogEntry(entry: Omit<LogEntry, 'ts' | 'debugSessionId'>): void {
  if (!state || !state.enabled) return;

  const fullEntry: LogEntry = {
    ...entry,
    ts: new Date().toISOString(),
    debugSessionId: state.sessionId,
  };

  state.buffer.push(fullEntry);

  // Trim buffer if it exceeds max size
  if (state.buffer.length > state.config.maxBufferSize) {
    state.buffer.shift();
  }
}

/**
 * Wrap console methods to capture logs.
 */
function wrapConsole(): void {
  if (!state) return;

  // Wrap console.error
  state.originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const message = args.map((a) => safeStringify(a, state!.config.maxStringLength)).join(' ');
    const stack = extractStack(args[0] instanceof Error ? args[0] : undefined, state!.config.maxStringLength);

    addLogEntry({
      level: 'error',
      type: 'console',
      message,
      stack,
      url: typeof window !== 'undefined' ? sanitizeUrl(window.location.href) : null,
    });

    state!.originalConsoleError.apply(console, args);
  };

  // Wrap console.warn
  if (state.config.captureWarnings) {
    state.originalConsoleWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const message = args.map((a) => safeStringify(a, state!.config.maxStringLength)).join(' ');
      const stack = extractStack(undefined, state!.config.maxStringLength);

      addLogEntry({
        level: 'warn',
        type: 'console',
        message,
        stack,
        url: typeof window !== 'undefined' ? sanitizeUrl(window.location.href) : null,
      });

      state!.originalConsoleWarn.apply(console, args);
    };
  }

  // Wrap console.info and console.debug if configured
  if (state.config.captureInfo) {
    state.originalConsoleInfo = console.info;
    console.info = (...args: unknown[]) => {
      const message = args.map((a) => safeStringify(a, state!.config.maxStringLength)).join(' ');

      addLogEntry({
        level: 'event',
        type: 'console',
        message,
        stack: null,
        url: typeof window !== 'undefined' ? sanitizeUrl(window.location.href) : null,
      });

      state!.originalConsoleInfo.apply(console, args);
    };

    state.originalConsoleDebug = console.debug;
    console.debug = (...args: unknown[]) => {
      const message = args.map((a) => safeStringify(a, state!.config.maxStringLength)).join(' ');

      addLogEntry({
        level: 'event',
        type: 'console',
        message,
        stack: null,
        url: typeof window !== 'undefined' ? sanitizeUrl(window.location.href) : null,
      });

      state!.originalConsoleDebug.apply(console, args);
    };
  }
}

/**
 * Wrap fetch to capture network failures.
 */
function wrapFetch(): void {
  if (!state || typeof window === 'undefined') return;

  state.originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const startTime = Date.now();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || 'GET';

    // Inject debug session header if configured
    let modifiedInit = init;
    if (state!.config.injectSessionHeader) {
      const headers = new Headers(init?.headers);
      headers.set('x-debug-session-id', state!.sessionId);
      modifiedInit = { ...init, headers };
    }

    try {
      const response = await state!.originalFetch(input, modifiedInit);
      const durationMs = Date.now() - startTime;

      // Capture if configured to capture all, or if it's a failure
      const shouldCapture = !state!.config.onlyFetchFailures || !response.ok;

      if (shouldCapture) {
        addLogEntry({
          level: response.ok ? 'event' : 'error',
          type: 'fetch',
          message: `${method} ${sanitizeUrl(url)} - ${response.status} ${response.statusText}`,
          stack: null,
          url: sanitizeUrl(url),
          meta: {
            method,
            status: response.status,
            durationMs,
          },
        });
      }

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      addLogEntry({
        level: 'error',
        type: 'fetch',
        message: `${method} ${sanitizeUrl(url)} - Network Error: ${truncateString(message, 200)}`,
        stack: error instanceof Error ? extractStack(error, state!.config.maxStringLength) : null,
        url: sanitizeUrl(url),
        meta: {
          method,
          durationMs,
        },
      });

      throw error;
    }
  };
}

/**
 * Set up global error listeners.
 */
function setupErrorListeners(): void {
  if (typeof window === 'undefined') return;

  // Handle uncaught errors
  window.addEventListener('error', (event: ErrorEvent) => {
    addLogEntry({
      level: 'error',
      type: 'window_error',
      message: event.message || 'Unknown error',
      stack: event.error ? extractStack(event.error, state!.config.maxStringLength) : null,
      url: event.filename ? sanitizeUrl(event.filename) : sanitizeUrl(window.location.href),
    });
  });

  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message = reason instanceof Error
      ? reason.message
      : safeStringify(reason, state!.config.maxStringLength);

    addLogEntry({
      level: 'error',
      type: 'unhandled_rejection',
      message: `Unhandled Promise Rejection: ${message}`,
      stack: reason instanceof Error ? extractStack(reason, state!.config.maxStringLength) : null,
      url: sanitizeUrl(window.location.href),
    });
  });
}

/**
 * Initialize the debug capture system.
 * Call this once at app startup.
 *
 * @param config - Optional configuration options
 * @returns Object with control methods, or null if debug mode is not enabled
 */
export function initDebugCapture(config: DebugConfig = {}): DebugCaptureAPI | null {
  // Already initialized
  if (state?.initialized) {
    return createAPI();
  }

  // Store custom config values for use by toggleDebugMode and isPreviewEnvironment
  if (config.isEnabled) {
    customIsEnabled = config.isEnabled;
  }
  if (config.previewUrlPattern) {
    customPreviewUrlPattern = config.previewUrlPattern;
  }

  // Merge config with defaults
  const fullConfig = {
    isEnabled: config.isEnabled || defaultIsEnabled,
    previewUrlPattern: config.previewUrlPattern,
    maxBufferSize: config.maxBufferSize ?? 1000,
    maxStringLength: config.maxStringLength ?? 5000,
    captureWarnings: config.captureWarnings ?? true,
    captureInfo: config.captureInfo ?? false,
    injectSessionHeader: config.injectSessionHeader ?? true,
    onlyFetchFailures: config.onlyFetchFailures ?? true,
    serverUrl: config.serverUrl ?? 'http://localhost:3847',
  };

  // Check if we should enable debug mode
  const enabled = fullConfig.isEnabled();

  if (!enabled) {
    return null;
  }

  // Initialize state
  state = {
    initialized: true,
    enabled: true,
    sessionId: getOrCreateSessionId(),
    buffer: [],
    config: fullConfig,
    originalConsoleError: console.error,
    originalConsoleWarn: console.warn,
    originalConsoleInfo: console.info,
    originalConsoleDebug: console.debug,
    originalFetch: typeof window !== 'undefined' ? window.fetch : (() => Promise.reject(new Error('fetch not available'))) as typeof fetch,
  };

  // Set up capture hooks
  wrapConsole();
  wrapFetch();
  setupErrorListeners();

  return createAPI();
}

/**
 * Public API for the debug capture system.
 */
export interface DebugCaptureAPI {
  /** Get all captured log entries */
  getLogs: () => LogEntry[];
  /** Get the current debug session ID */
  getSessionId: () => string;
  /** Check if debug capture is enabled */
  isEnabled: () => boolean;
  /** Clear all captured logs */
  clearLogs: () => void;
  /** Get log count */
  getLogCount: () => number;
  /** Export logs as JSONL string */
  exportAsJsonl: () => string;
  /** Download logs as a JSONL file */
  downloadLogs: (filename?: string) => void;
  /** Manually add a log entry */
  log: (level: 'error' | 'warn' | 'event', message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Create the public API object.
 */
function createAPI(): DebugCaptureAPI {
  return {
    getLogs: () => state?.buffer ? [...state.buffer] : [],

    getSessionId: () => state?.sessionId || '',

    isEnabled: () => state?.enabled || false,

    clearLogs: () => {
      if (state) {
        state.buffer = [];
      }
    },

    getLogCount: () => state?.buffer.length || 0,

    exportAsJsonl: () => {
      if (!state) return '';
      return state.buffer.map((entry) => JSON.stringify(entry)).join('\n');
    },

    downloadLogs: (filename = 'browser-logs.jsonl') => {
      if (!state || typeof window === 'undefined') return;

      const jsonl = state.buffer.map((entry) => JSON.stringify(entry)).join('\n');
      const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    log: (level, message, meta) => {
      addLogEntry({
        level,
        type: 'console',
        message,
        stack: null,
        url: typeof window !== 'undefined' ? sanitizeUrl(window.location.href) : null,
        meta: meta as LogEntry['meta'],
      });
    },
  };
}

/**
 * Get the current debug capture API if initialized.
 * Returns null if not initialized or not enabled.
 */
export function getDebugCapture(): DebugCaptureAPI | null {
  if (!state?.enabled) return null;
  return createAPI();
}

/**
 * Check if debug mode is currently active.
 */
export function isDebugModeActive(): boolean {
  return state?.enabled || false;
}

/**
 * Get the current session ID if debug mode is active.
 */
export function getDebugSessionId(): string | null {
  return state?.sessionId || null;
}

/**
 * Toggle debug mode via keyboard shortcut.
 * Respects custom config.isEnabled if provided, otherwise requires preview environment.
 * @returns The new enabled state, or null if toggle is not allowed
 */
export function toggleDebugMode(): boolean | null {
  debugLog('toggleDebugMode called');
  debugLog('customIsEnabled is:', customIsEnabled ? 'function' : 'null');
  debugLog('customPreviewUrlPattern is:', customPreviewUrlPattern ? (typeof customPreviewUrlPattern === 'function' ? 'function' : customPreviewUrlPattern) : 'null');
  debugLog('isKeyboardEnabled():', isKeyboardEnabled());

  if (typeof window === 'undefined') {
    debugLog('window is undefined, returning null');
    return null;
  }

  // Check if toggle should be allowed
  // If user provided custom isEnabled, we check if enabling would be allowed
  // by simulating keyboard enabled state and calling the function
  if (customIsEnabled) {
    debugLog('Using customIsEnabled path');
    // For disabling, always allow (user can always turn it off)
    if (isKeyboardEnabled()) {
      setKeyboardEnabled(false);
      console.log('[debugpack] Debug mode disabled. Reloading...');
      window.location.reload();
      return false;
    }

    // For enabling, temporarily set keyboard enabled and check if custom isEnabled allows it
    setKeyboardEnabled(true);
    const wouldBeEnabled = customIsEnabled();
    debugLog('customIsEnabled() returned:', wouldBeEnabled);
    if (!wouldBeEnabled) {
      // Custom check failed, revert and warn
      setKeyboardEnabled(false);
      console.warn('[debugpack] Cannot enable debug mode: custom isEnabled() returned false');
      return null;
    }

    console.log('[debugpack] Debug mode enabled. Reloading...');
    window.location.reload();
    return true;
  }

  // No custom isEnabled - use default preview environment check
  debugLog('Using default isPreviewEnvironment check');
  const isPreview = isPreviewEnvironment();
  debugLog('isPreviewEnvironment() returned:', isPreview);

  if (!isPreview) {
    console.warn('[debugpack] Cannot toggle debug mode outside preview environment. Enable verbose logging with: localStorage.setItem("vercel-debugpack-verbose", "true") and try again.');
    return null;
  }

  const currentlyEnabled = isKeyboardEnabled();

  if (currentlyEnabled) {
    // Disable: clear storage and reload
    setKeyboardEnabled(false);
    console.log('[debugpack] Debug mode disabled. Reloading...');
    window.location.reload();
    return false;
  } else {
    // Enable: set storage and reload
    setKeyboardEnabled(true);
    console.log('[debugpack] Debug mode enabled. Reloading...');
    window.location.reload();
    return true;
  }
}

/**
 * Set up the keyboard shortcut listener (Ctrl+Shift+D or Cmd+Shift+D on Mac by default).
 * Call this once at app startup (even before initDebugCapture).
 * Safe to call multiple times - will only set up the listener once.
 * Use setKeyboardShortcutKey() before calling this to customize the key.
 */
export function setupKeyboardShortcut(): void {
  debugLog('setupKeyboardShortcut called');

  if (typeof window === 'undefined') {
    debugLog('window is undefined, skipping keyboard shortcut setup');
    return;
  }

  if (keyboardShortcutSetup) {
    debugLog('Keyboard shortcut already set up, skipping');
    return;
  }

  keyboardShortcutSetup = true;
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modifierName = isMac ? 'Cmd' : 'Ctrl';
  debugLog('Setting up keyboard shortcut listener for key:', keyboardShortcutKey);
  console.log(`[debugpack] Keyboard shortcut enabled (${modifierName}+Shift+${keyboardShortcutKey})`);

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    // Ctrl+Shift+<key> (or Cmd+Shift+<key> on Mac)
    const modifier = isMac ? event.metaKey : event.ctrlKey;

    // For semicolon, Shift changes ';' to ':' so we need to check both
    // Also use event.code as fallback for more reliable key detection
    const pressedKey = event.key.toUpperCase();
    const pressedCode = event.code;

    let keyMatches = pressedKey === keyboardShortcutKey.toUpperCase();

    // Special handling for semicolon - Shift+; produces ':'
    if (keyboardShortcutKey === ';' && (pressedKey === ':' || pressedCode === 'Semicolon')) {
      keyMatches = true;
    }

    if (modifier && event.shiftKey && keyMatches) {
      event.preventDefault();
      console.log(`[debugpack] Keyboard shortcut triggered (${modifierName}+Shift+${keyboardShortcutKey})`);
      toggleDebugMode();
    }
  });
}

/**
 * Check if debug mode is keyboard-enabled (without checking preview environment).
 * Useful for UI indicators.
 */
export function isDebugKeyboardEnabled(): boolean {
  return isKeyboardEnabled();
}

/**
 * Diagnostic info for debugging configuration issues.
 * Call this from the browser console to see current debugpack state.
 *
 * @example
 * ```js
 * // In browser console:
 * import('vercel-debugpack/browser').then(m => console.log(m.getDebugpackDiagnostics()));
 * // Or if already imported:
 * window.__DEBUGPACK_DIAGNOSTICS__?.()
 * ```
 */
export function getDebugpackDiagnostics(): {
  keyboardShortcutSetup: boolean;
  keyboardShortcutKey: string;
  isKeyboardEnabled: boolean;
  customPreviewUrlPattern: string | null;
  customIsEnabled: boolean;
  isPreviewEnvironment: boolean;
  hostname: string;
  stateInitialized: boolean;
  stateEnabled: boolean;
  sessionId: string | null;
} {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'N/A (no window)';

  const diagnostics = {
    keyboardShortcutSetup,
    keyboardShortcutKey,
    isKeyboardEnabled: isKeyboardEnabled(),
    customPreviewUrlPattern: customPreviewUrlPattern
      ? (typeof customPreviewUrlPattern === 'function' ? '[Function]' : String(customPreviewUrlPattern))
      : null,
    customIsEnabled: !!customIsEnabled,
    isPreviewEnvironment: isPreviewEnvironment(),
    hostname,
    stateInitialized: !!state?.initialized,
    stateEnabled: !!state?.enabled,
    sessionId: state?.sessionId || null,
  };

  // Also expose as global for easy console access
  if (typeof window !== 'undefined') {
    (window as unknown as { __DEBUGPACK_DIAGNOSTICS__?: () => typeof diagnostics }).__DEBUGPACK_DIAGNOSTICS__ = () => diagnostics;
  }

  return diagnostics;
}

// Auto-expose diagnostics on load for easier debugging
if (typeof window !== 'undefined') {
  (window as unknown as { __DEBUGPACK_DIAGNOSTICS__?: () => ReturnType<typeof getDebugpackDiagnostics> }).__DEBUGPACK_DIAGNOSTICS__ = getDebugpackDiagnostics;
}
