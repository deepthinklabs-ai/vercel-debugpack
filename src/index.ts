/**
 * vercel-debugpack
 *
 * On-demand debug bundle generation for Vercel + Chrome.
 * Captures browser logs, correlates with server logs, and generates
 * a debug bundle for AI-assisted debugging.
 *
 * @example Browser (React)
 * ```tsx
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
 * @example Browser (Vanilla JS)
 * ```ts
 * import { initDebugCapture } from 'vercel-debugpack/browser';
 *
 * const debug = initDebugCapture();
 * if (debug) {
 *   console.log('Debug mode active');
 * }
 * ```
 *
 * @example Server (Next.js App Router)
 * ```ts
 * import { withDebugSession } from 'vercel-debugpack/server';
 *
 * export const GET = withDebugSession(async (request, sessionId) => {
 *   return Response.json({ ok: true });
 * });
 * ```
 *
 * @example CLI
 * ```bash
 * npx debugpack --browserLog ~/Downloads/browser-logs.jsonl --project my-app
 * ```
 *
 * @packageDocumentation
 */

// Re-export browser utilities (for convenience, though /browser subpath is preferred)
export {
  initDebugCapture,
  getDebugCapture,
  isDebugModeActive,
  getDebugSessionId,
  DebugPanel,
  type DebugCaptureAPI,
  type LogEntry,
  type LogEntryMeta,
  type DebugConfig,
  type DebugPanelProps,
} from './browser';

// Re-export server utilities
export {
  DEBUG_SESSION_HEADER,
  getDebugSessionId as getServerDebugSessionId,
  getDebugLogPrefix,
  createDebugLogger,
  withDebugSession,
  withDebugSessionPages,
  debugSessionMiddleware,
  type DebugLogger,
} from './server';
