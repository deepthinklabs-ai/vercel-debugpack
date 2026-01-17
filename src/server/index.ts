/**
 * Server-side utilities for debug session correlation.
 * Helps connect browser logs with Vercel server logs via the x-debug-session-id header.
 *
 * @example
 * ```ts
 * // In a Next.js API route
 * import { getDebugSessionId, withDebugSession } from 'vercel-debugpack/server';
 *
 * export async function GET(request: Request) {
 *   const sessionId = getDebugSessionId(request);
 *   if (sessionId) {
 *     console.log(`[debugSessionId=${sessionId}] Processing request`);
 *   }
 *   return Response.json({ ok: true });
 * }
 *
 * // Or use the wrapper
 * export const POST = withDebugSession(async (request, sessionId) => {
 *   // sessionId is automatically logged
 *   return Response.json({ ok: true });
 * });
 * ```
 */

/** Header name used for debug session correlation */
export const DEBUG_SESSION_HEADER = 'x-debug-session-id';

/**
 * Extract the debug session ID from an incoming request.
 *
 * @param request - The incoming request (Request, Headers, or header-like object)
 * @returns The debug session ID if present, or null
 */
export function getDebugSessionId(
  request: Request | Headers | { headers: Headers | Record<string, string> } | Record<string, string>
): string | null {
  // Handle Request object
  if (request instanceof Request) {
    return request.headers.get(DEBUG_SESSION_HEADER);
  }

  // Handle Headers object
  if (request instanceof Headers) {
    return request.get(DEBUG_SESSION_HEADER);
  }

  // Handle object with headers property
  if ('headers' in request && request.headers) {
    if (request.headers instanceof Headers) {
      return request.headers.get(DEBUG_SESSION_HEADER);
    }
    // Plain object headers
    const headers = request.headers as Record<string, string>;
    return headers[DEBUG_SESSION_HEADER] || headers[DEBUG_SESSION_HEADER.toLowerCase()] || null;
  }

  // Handle plain header object (e.g., from Next.js pages API)
  if (typeof request === 'object') {
    return (request as Record<string, string>)[DEBUG_SESSION_HEADER]
      || (request as Record<string, string>)[DEBUG_SESSION_HEADER.toLowerCase()]
      || null;
  }

  return null;
}

/**
 * Create a log prefix with the debug session ID if present.
 *
 * @param request - The incoming request
 * @returns A prefix string like "[debugSessionId=abc123]" or empty string
 */
export function getDebugLogPrefix(
  request: Request | Headers | { headers: Headers | Record<string, string> }
): string {
  const sessionId = getDebugSessionId(request);
  if (sessionId) {
    return `[debugSessionId=${sessionId}]`;
  }
  return '';
}

/**
 * Create a logger that automatically includes the debug session ID.
 *
 * @param request - The incoming request
 * @returns A logger object with log, warn, error methods
 *
 * @example
 * ```ts
 * const logger = createDebugLogger(request);
 * logger.log('Processing payment');
 * logger.error('Payment failed', error);
 * ```
 */
export function createDebugLogger(
  request: Request | Headers | { headers: Headers | Record<string, string> }
): DebugLogger {
  const prefix = getDebugLogPrefix(request);

  return {
    log: (...args: unknown[]) => {
      if (prefix) {
        console.log(prefix, ...args);
      } else {
        console.log(...args);
      }
    },
    warn: (...args: unknown[]) => {
      if (prefix) {
        console.warn(prefix, ...args);
      } else {
        console.warn(...args);
      }
    },
    error: (...args: unknown[]) => {
      if (prefix) {
        console.error(prefix, ...args);
      } else {
        console.error(...args);
      }
    },
    info: (...args: unknown[]) => {
      if (prefix) {
        console.info(prefix, ...args);
      } else {
        console.info(...args);
      }
    },
  };
}

export interface DebugLogger {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
}

/**
 * Higher-order function that wraps a request handler to automatically log the debug session ID.
 * Useful for Next.js App Router route handlers.
 *
 * @param handler - The request handler to wrap
 * @returns Wrapped handler that logs debug session context
 *
 * @example
 * ```ts
 * // app/api/users/route.ts
 * import { withDebugSession } from 'vercel-debugpack/server';
 *
 * export const GET = withDebugSession(async (request, sessionId) => {
 *   // Your handler logic
 *   return Response.json({ users: [] });
 * });
 * ```
 */
export function withDebugSession<T extends Response | Promise<Response>>(
  handler: (request: Request, sessionId: string | null) => T
): (request: Request) => T {
  return (request: Request) => {
    const sessionId = getDebugSessionId(request);

    if (sessionId) {
      console.log(`[debugSessionId=${sessionId}] ${request.method} ${new URL(request.url).pathname}`);
    }

    return handler(request, sessionId);
  };
}

/**
 * Middleware-style wrapper for Next.js Pages API routes.
 *
 * @example
 * ```ts
 * // pages/api/users.ts
 * import { withDebugSessionPages } from 'vercel-debugpack/server';
 * import type { NextApiRequest, NextApiResponse } from 'next';
 *
 * export default withDebugSessionPages(async (req, res, sessionId) => {
 *   res.json({ users: [] });
 * });
 * ```
 */
export function withDebugSessionPages<
  Req extends { headers: Record<string, string | string[] | undefined>; method?: string; url?: string },
  Res
>(
  handler: (req: Req, res: Res, sessionId: string | null) => void | Promise<void>
): (req: Req, res: Res) => void | Promise<void> {
  return (req: Req, res: Res) => {
    const headerValue = req.headers[DEBUG_SESSION_HEADER] || req.headers[DEBUG_SESSION_HEADER.toLowerCase()];
    const sessionId: string | null = Array.isArray(headerValue) ? (headerValue[0] ?? null) : (headerValue ?? null);

    if (sessionId) {
      console.log(`[debugSessionId=${sessionId}] ${req.method} ${req.url}`);
    }

    return handler(req, res, sessionId);
  };
}

/**
 * Express-style middleware that attaches debug session ID to the request.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { debugSessionMiddleware } from 'vercel-debugpack/server';
 *
 * const app = express();
 * app.use(debugSessionMiddleware());
 * ```
 */
export function debugSessionMiddleware() {
  return (
    req: { headers: Record<string, string | string[] | undefined>; debugSessionId?: string | null },
    _res: unknown,
    next: () => void
  ) => {
    const headerValue = req.headers[DEBUG_SESSION_HEADER] || req.headers[DEBUG_SESSION_HEADER.toLowerCase()];
    req.debugSessionId = Array.isArray(headerValue) ? headerValue[0] : headerValue || null;

    if (req.debugSessionId) {
      console.log(`[debugSessionId=${req.debugSessionId}] Request received`);
    }

    next();
  };
}
