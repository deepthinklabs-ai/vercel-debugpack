/**
 * Log entry captured by the debug capture system.
 * Exported as JSONL (one JSON object per line).
 */
export interface LogEntry {
  /** ISO 8601 timestamp */
  ts: string;
  /** Log level */
  level: 'error' | 'warn' | 'event';
  /** Source type of the log */
  type: 'console' | 'window_error' | 'unhandled_rejection' | 'fetch';
  /** Log message */
  message: string;
  /** Stack trace if available */
  stack: string | null;
  /** Sanitized URL (pathname only, no query params) */
  url: string | null;
  /** Debug session ID for correlation with server logs */
  debugSessionId: string;
  /** Additional metadata for fetch logs */
  meta?: LogEntryMeta;
}

export interface LogEntryMeta {
  /** HTTP method (GET, POST, etc.) */
  method?: string;
  /** HTTP status code */
  status?: number;
  /** Request duration in milliseconds */
  durationMs?: number;
}

/**
 * Configuration options for the debug capture system.
 */
export interface DebugConfig {
  /**
   * Custom function to determine if debug mode is enabled.
   * By default, checks VERCEL_ENV === 'preview' AND ?debug=1 in URL.
   */
  isEnabled?: () => boolean;

  /**
   * Custom preview URL detection for environments with custom domains.
   * Used by the default isEnabled check to detect preview environments.
   *
   * Can be:
   * - A string: matches if hostname includes this string (e.g., 'preview.myapp.com')
   * - A RegExp: matches if hostname matches the pattern (e.g., /preview-.*\.myapp\.com/)
   * - A function: receives hostname, returns true if it's a preview environment
   *
   * @example
   * // String - matches any hostname containing 'staging'
   * previewUrlPattern: 'staging'
   *
   * @example
   * // RegExp - matches preview-*.myapp.com
   * previewUrlPattern: /^preview-.*\.myapp\.com$/
   *
   * @example
   * // Function - custom logic
   * previewUrlPattern: (hostname) => hostname.startsWith('preview-') || hostname.includes('-git-')
   */
  previewUrlPattern?: string | RegExp | ((hostname: string) => boolean);

  /**
   * Maximum number of log entries to keep in the buffer.
   * Oldest entries are removed when this limit is reached.
   * @default 1000
   */
  maxBufferSize?: number;

  /**
   * Maximum length for string values (message, stack).
   * Longer strings are truncated with '...[truncated]'.
   * @default 5000
   */
  maxStringLength?: number;

  /**
   * Whether to capture console.warn in addition to console.error.
   * @default true
   */
  captureWarnings?: boolean;

  /**
   * Whether to capture console.info and console.debug.
   * @default false
   */
  captureInfo?: boolean;

  /**
   * Whether to inject x-debug-session-id header into fetch requests.
   * @default true
   */
  injectSessionHeader?: boolean;

  /**
   * Only capture fetch failures (throw or !res.ok).
   * If false, captures all fetch requests.
   * @default true
   */
  onlyFetchFailures?: boolean;

  /**
   * Custom server URL for bundle creation.
   * Used when connecting to the local debugpack server.
   * @default 'http://localhost:3847'
   */
  serverUrl?: string;

  /**
   * Keyboard shortcut key to toggle debug mode.
   * Used with Ctrl+Shift (or Cmd+Shift on Mac).
   *
   * @default ';'
   * @example ';' for Ctrl+Shift+; (default)
   * @example 'D' for Ctrl+Shift+D
   */
  keyboardShortcutKey?: string;
}

/**
 * Internal state for the debug capture system.
 * Note: previewUrlPattern and keyboardShortcutKey are stored separately at module level.
 */
export interface DebugCaptureState {
  initialized: boolean;
  enabled: boolean;
  sessionId: string;
  buffer: LogEntry[];
  config: Required<Omit<DebugConfig, 'previewUrlPattern' | 'keyboardShortcutKey'>> & Pick<DebugConfig, 'previewUrlPattern'>;
  originalConsoleError: typeof console.error;
  originalConsoleWarn: typeof console.warn;
  originalConsoleInfo: typeof console.info;
  originalConsoleDebug: typeof console.debug;
  originalFetch: typeof fetch;
}

/**
 * Props for the DebugPanel React component.
 */
export interface DebugPanelProps {
  /** Configuration options */
  config?: DebugConfig;
  /** Custom CSS class name for the panel container */
  className?: string;
  /** Position of the panel */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

/**
 * Summary info returned after a bundle is created.
 */
export interface BundleSummary {
  browserLogCount: number;
  vercelLogLines: number;
  sessionId: string;
}

/**
 * Status of bundle creation for UI feedback.
 */
export type BundleStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'success'; bundlePath: string; summary: BundleSummary }
  | { state: 'error'; message: string };
