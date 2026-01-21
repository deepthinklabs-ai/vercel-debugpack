# vercel-debugpack

On-demand debug bundle generation for Vercel + Chrome. Stop copy-pasting console logs — generate a single debug folder with browser logs, Vercel server logs, and metadata for AI-assisted debugging.

## How It Works

### Quick Start (Recommended)

1. **Setup once** in your project directory:
   ```bash
   npx debugpack init
   ```
   This prompts for your Vercel project name and saves config.

2. **Start the debug server** when you need to debug:
   ```bash
   npx debugpack serve
   ```

3. **On your staging site**, press **Ctrl+Shift+L** (or Cmd+Shift+L on Mac) to enable debug mode

4. **Reproduce the bug**

5. **Click "Create Bundle"** in the debug panel — bundle is written directly to `./debug-bundle/`

6. **Point Claude Code** (or any AI) at the folder:
   ```bash
   claude --dir ./debug-bundle
   ```

## Installation

```bash
npm install vercel-debugpack
```

## Browser Setup

Add the `<DebugPanel />` component to your root layout. It only renders on staging (`VERCEL_ENV === 'preview'`) when debug mode is enabled via:
- `?debug=1` in the URL, or
- **Ctrl+Shift+L** keyboard shortcut (Cmd+Shift+L on Mac)

### Next.js App Router

```tsx
// app/layout.tsx
import { DebugPanel } from 'vercel-debugpack/browser';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <DebugPanel />
      </body>
    </html>
  );
}
```

### Next.js Pages Router

```tsx
// pages/_app.tsx
import { DebugPanel } from 'vercel-debugpack/browser';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <DebugPanel />
    </>
  );
}
```

### Vanilla JS (Non-React)

```ts
import { initDebugCapture } from 'vercel-debugpack/browser';

const debug = initDebugCapture();

if (debug) {
  console.log('Debug mode active, session:', debug.getSessionId());

  // Later, to download logs:
  debug.downloadLogs();
}
```

## Server Setup (Optional)

Add session ID correlation to your server logs. This makes it easy to filter Vercel logs by debug session.

### Next.js App Router

```ts
// app/api/users/route.ts
import { withDebugSession } from 'vercel-debugpack/server';

export const GET = withDebugSession(async (request, sessionId) => {
  // sessionId is automatically logged
  // Your handler logic here
  return Response.json({ users: [] });
});
```

### Next.js Pages Router

```ts
// pages/api/users.ts
import { withDebugSessionPages } from 'vercel-debugpack/server';
import type { NextApiRequest, NextApiResponse } from 'next';

export default withDebugSessionPages(async (req, res, sessionId) => {
  res.json({ users: [] });
});
```

### Manual Logging

```ts
import { getDebugSessionId, createDebugLogger } from 'vercel-debugpack/server';

export async function GET(request: Request) {
  const sessionId = getDebugSessionId(request);
  const logger = createDebugLogger(request);

  logger.log('Processing request'); // Logs: [debugSessionId=abc123] Processing request

  return Response.json({ ok: true });
}
```

## CLI Usage

The CLI bundles browser logs with Vercel server logs into a single debug folder.

### Prerequisites

- [Vercel CLI](https://vercel.com/docs/cli) installed and authenticated (`vercel login`)

### Initialize (First Time Setup)

Run this once in your project directory:

```bash
npx debugpack init
```

This will prompt you for your **Vercel project name** from the Vercel dashboard.

Configuration is saved to `debugpack.config.json` and automatically added to `.gitignore`. Bundles are saved to `./debug-bundle/` by default.

### Start Debug Server

```bash
npx debugpack serve
```

This starts a local server that the browser can connect to. When you click "Create Bundle" in the DebugPanel, it:
1. Sends browser logs to the local server
2. Fetches Vercel server logs automatically
3. Writes the complete bundle to your output directory

#### Serve Options

| Option | Description | Default |
|--------|-------------|---------|
| `--port <number>` | Server port | `3847` |
| `--out <dir>` | Output directory | from config or `./debug-bundle` |
| `--project <name>` | Vercel project name | from config |
| `--minutes <n>` | Minutes of Vercel logs | `15` |

### Output

```
debug-bundle/
├── context.json         # Metadata (git SHA, timestamps, session ID)
├── browser-logs.jsonl   # Browser console/error/network logs
├── vercel-logs.txt      # Server-side logs from Vercel
├── summary.md           # Human-readable summary
└── redaction_report.json # What sensitive data was redacted
```

## What Gets Captured

### Browser (Automatic)

- `console.error` and `console.warn` (optionally `info`/`debug`)
- `window.onerror` and `unhandledrejection` events
- Failed `fetch` requests (network errors or non-2xx responses)

### What's NOT Captured

- Cookies or Authorization headers
- Request/response bodies
- localStorage/sessionStorage values
- Query parameters (URLs are sanitized)

### Redaction

The CLI automatically redacts:

- `Authorization:` headers
- `Cookie:` headers
- Bearer tokens
- JWT tokens (`eyJ...`)
- API keys (`sk-...`)

## Configuration

### DebugPanel Props

```tsx
<DebugPanel
  position="bottom-right"  // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  className="my-debug-panel"
  config={{
    maxBufferSize: 1000,      // Max log entries to keep
    maxStringLength: 5000,    // Truncate long strings
    captureWarnings: true,    // Capture console.warn
    captureInfo: false,       // Capture console.info/debug
    injectSessionHeader: true, // Add x-debug-session-id to fetch
    onlyFetchFailures: true,  // Only log failed fetches
  }}
/>
```

### Custom Enable Logic

```tsx
import { initDebugCapture } from 'vercel-debugpack/browser';

const debug = initDebugCapture({
  isEnabled: () => {
    // Your custom logic
    return window.location.hostname.includes('staging');
  },
});
```

## Log Format

Browser logs are exported as JSON Lines (one JSON object per line):

```json
{"ts":"2024-01-15T10:30:00.000Z","level":"error","type":"console","message":"Failed to load user","stack":"Error: Failed to load user\n    at loadUser (app.js:42)","url":"https://staging.myapp.com/dashboard","debugSessionId":"abc-123"}
{"ts":"2024-01-15T10:30:01.000Z","level":"error","type":"fetch","message":"GET /api/users - 500 Internal Server Error","url":"https://staging.myapp.com/api/users","debugSessionId":"abc-123","meta":{"method":"GET","status":500,"durationMs":234}}
```

## Debug Session Correlation

When debug mode is active:

1. A unique `debugSessionId` is generated and stored in `sessionStorage`
2. Every browser log entry includes this ID
3. All `fetch` requests include an `x-debug-session-id` header
4. Server-side code can read this header and include it in logs
5. The CLI can filter Vercel logs by session ID

This lets you trace a bug from browser to server across the same session.

## Security

- Debug mode only activates on Vercel Preview deployments with `?debug=1` or Ctrl+Shift+L
- No sensitive data (cookies, auth headers, request bodies) is captured
- URLs are sanitized (query params stripped)
- The CLI redacts tokens and secrets before writing files
- `debug-bundle/` and `debugpack.config.json` are automatically added to `.gitignore`

## License

MIT
