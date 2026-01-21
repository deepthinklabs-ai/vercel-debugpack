/**
 * Browser-side debug capture module.
 *
 * @example
 * ```tsx
 * // Using the React component (recommended for Next.js)
 * import { DebugPanel } from 'vercel-debugpack/browser';
 *
 * export default function Layout({ children }) {
 *   return (
 *     <>
 *       {children}
 *       <DebugPanel />
 *     </>
 *   );
 * }
 * ```
 *
 * @example
 * ```ts
 * // Using the vanilla JS API
 * import { initDebugCapture } from 'vercel-debugpack/browser';
 *
 * const debug = initDebugCapture();
 * if (debug) {
 *   console.log('Debug mode active, session:', debug.getSessionId());
 * }
 * ```
 */

// Vanilla JS core
export {
  initDebugCapture,
  getDebugCapture,
  isDebugModeActive,
  getDebugSessionId,
  toggleDebugMode,
  setupKeyboardShortcut,
  isDebugKeyboardEnabled,
  type DebugCaptureAPI,
} from './capture';

// React component
export { DebugPanel } from './DebugPanel';

// Server client (for custom integrations)
export {
  probeServer,
  refreshServerStatus,
  clearServerStatusCache,
  createBundleOnServer,
  getDefaultServerUrl,
  type ServerStatus,
  type BundleResult,
} from './serverClient';

// Types
export type {
  LogEntry,
  LogEntryMeta,
  DebugConfig,
  DebugPanelProps,
  BundleStatus,
  BundleSummary,
} from './types';

// Redaction utilities (for advanced use cases)
export {
  sanitizeUrl,
  truncateString,
  safeStringify,
  extractStack,
} from './redaction';
