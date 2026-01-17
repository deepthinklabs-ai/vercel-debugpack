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
  type DebugCaptureAPI,
} from './capture';

// React component
export { DebugPanel } from './DebugPanel';

// Types
export type {
  LogEntry,
  LogEntryMeta,
  DebugConfig,
  DebugPanelProps,
} from './types';

// Redaction utilities (for advanced use cases)
export {
  sanitizeUrl,
  truncateString,
  safeStringify,
  extractStack,
} from './redaction';
