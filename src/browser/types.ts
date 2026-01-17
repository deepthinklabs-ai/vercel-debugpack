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
}

/**
 * Internal state for the debug capture system.
 */
export interface DebugCaptureState {
  initialized: boolean;
  enabled: boolean;
  sessionId: string;
  buffer: LogEntry[];
  config: Required<DebugConfig>;
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
