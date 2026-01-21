/**
 * React component for the debug capture UI overlay.
 * Wraps the vanilla capture core and provides a simple UI for staging environments.
 */

import React, { useEffect, useState, useCallback } from 'react';
import type { DebugPanelProps, BundleStatus } from './types';
import { initDebugCapture, getDebugCapture, setupKeyboardShortcut, type DebugCaptureAPI } from './capture';
import { probeServer, createBundleOnServer, type ServerStatus } from './serverClient';

const POSITION_STYLES: Record<NonNullable<DebugPanelProps['position']>, React.CSSProperties> = {
  'bottom-right': { bottom: 16, right: 16 },
  'bottom-left': { bottom: 16, left: 16 },
  'top-right': { top: 16, right: 16 },
  'top-left': { top: 16, left: 16 },
};

/**
 * DebugPanel component - renders a floating overlay panel when debug mode is active.
 * Add this to your app's root layout to enable debug capture on staging.
 *
 * @example
 * ```tsx
 * // In your layout.tsx or _app.tsx
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
 */
export function DebugPanel({
  config,
  className,
  position = 'bottom-right',
}: DebugPanelProps): React.ReactElement | null {
  const [api, setApi] = useState<DebugCaptureAPI | null>(null);
  const [logCount, setLogCount] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);

  // Server integration state
  const [serverStatus, setServerStatus] = useState<ServerStatus>({
    available: false,
    lastChecked: 0,
  });
  const [bundleStatus, setBundleStatus] = useState<BundleStatus>({ state: 'idle' });

  // Setup keyboard shortcut (Ctrl+Shift+L) on mount
  useEffect(() => {
    setupKeyboardShortcut();
  }, []);

  // Initialize capture on mount
  useEffect(() => {
    const captureApi = initDebugCapture(config) || getDebugCapture();
    setApi(captureApi);

    if (captureApi) {
      setLogCount(captureApi.getLogCount());
    }
  }, [config]);

  // Update log count periodically
  useEffect(() => {
    if (!api) return;

    const interval = setInterval(() => {
      setLogCount(api.getLogCount());
    }, 1000);

    return () => clearInterval(interval);
  }, [api]);

  // Probe server on mount and periodically
  useEffect(() => {
    const checkServer = async () => {
      const status = await probeServer(config?.serverUrl);
      setServerStatus(status);
    };

    checkServer();
    const interval = setInterval(checkServer, 30000);
    return () => clearInterval(interval);
  }, [config?.serverUrl]);

  const handleDownload = useCallback(() => {
    api?.downloadLogs();
  }, [api]);

  const handleClear = useCallback(() => {
    api?.clearLogs();
    setLogCount(0);
    setBundleStatus({ state: 'idle' });
  }, [api]);

  const toggleMinimize = useCallback(() => {
    setIsMinimized((prev) => !prev);
  }, []);

  // Handle bundle creation via local server
  const handleCreateBundle = useCallback(async () => {
    if (!api || !serverStatus.available) return;

    setBundleStatus({ state: 'loading' });

    try {
      const result = await createBundleOnServer(
        api.getLogs(),
        api.getSessionId(),
        config?.serverUrl
      );

      if (result.success && result.bundlePath) {
        setBundleStatus({
          state: 'success',
          bundlePath: result.bundlePath,
          summary: result.summary!,
        });
      } else {
        setBundleStatus({
          state: 'error',
          message: result.error || 'Unknown error',
        });
      }
    } catch (error) {
      setBundleStatus({
        state: 'error',
        message: error instanceof Error ? error.message : 'Failed to create bundle',
      });
    }
  }, [api, serverStatus.available, config?.serverUrl]);

  // Don't render anything if debug mode is not active
  if (!api) {
    return null;
  }

  const positionStyle = POSITION_STYLES[position];

  // Inline styles to avoid requiring external CSS
  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    ...positionStyle,
    zIndex: 99999,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 12,
  };

  const panelStyle: React.CSSProperties = {
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    color: '#fff',
    borderRadius: 8,
    padding: isMinimized ? '8px 12px' : 12,
    minWidth: isMinimized ? 'auto' : 220,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    cursor: 'pointer',
  };

  const statusDotStyle: React.CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: '#22c55e',
    animation: 'pulse 2s infinite',
  };

  const titleStyle: React.CSSProperties = {
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  };

  const sessionIdStyle: React.CSSProperties = {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
    fontFamily: 'monospace',
    wordBreak: 'break-all',
  };

  const statsStyle: React.CSSProperties = {
    marginTop: 8,
    padding: '8px 0',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  };

  const buttonContainerStyle: React.CSSProperties = {
    display: 'flex',
    gap: 8,
    marginTop: 8,
  };

  const buttonBaseStyle: React.CSSProperties = {
    flex: 1,
    padding: '6px 10px',
    borderRadius: 4,
    border: 'none',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 500,
    transition: 'opacity 0.2s',
  };

  const primaryButtonStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    backgroundColor: '#22c55e',
    color: '#fff',
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    backgroundColor: '#3b82f6',
    color: '#fff',
  };

  const clearButtonStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: '#fff',
  };

  const minimizeButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'rgba(255, 255, 255, 0.6)',
    cursor: 'pointer',
    padding: 0,
    fontSize: 14,
    lineHeight: 1,
  };

  const statusMessageStyle: React.CSSProperties = {
    marginTop: 8,
    padding: '6px 8px',
    borderRadius: 4,
    fontSize: 10,
  };

  const successStyle: React.CSSProperties = {
    ...statusMessageStyle,
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    color: '#86efac',
  };

  const errorStyle: React.CSSProperties = {
    ...statusMessageStyle,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    color: '#fca5a5',
  };

  const loadingStyle: React.CSSProperties = {
    ...statusMessageStyle,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    color: '#93c5fd',
  };

  const serverIndicatorStyle: React.CSSProperties = {
    fontSize: 10,
    color: serverStatus.available ? '#86efac' : 'rgba(255, 255, 255, 0.4)',
    marginTop: 2,
  };

  // Render bundle status message
  const renderBundleStatus = () => {
    switch (bundleStatus.state) {
      case 'loading':
        return <div style={loadingStyle}>Creating bundle...</div>;
      case 'success':
        return (
          <div style={successStyle}>
            Bundle created!
            <div style={{ fontSize: 9, marginTop: 2, opacity: 0.8, wordBreak: 'break-all' }}>
              {bundleStatus.bundlePath}
            </div>
          </div>
        );
      case 'error':
        return (
          <div style={errorStyle}>
            Error: {bundleStatus.message}
          </div>
        );
      default:
        return null;
    }
  };

  // Render action buttons based on server availability
  const renderActionButtons = () => {
    if (serverStatus.available) {
      return (
        <>
          <button
            type="button"
            style={{
              ...primaryButtonStyle,
              opacity: bundleStatus.state === 'loading' ? 0.6 : 1,
              cursor: bundleStatus.state === 'loading' ? 'not-allowed' : 'pointer',
            }}
            onClick={handleCreateBundle}
            disabled={bundleStatus.state === 'loading'}
            onMouseOver={(e) => { if (bundleStatus.state !== 'loading') e.currentTarget.style.opacity = '0.9'; }}
            onMouseOut={(e) => { if (bundleStatus.state !== 'loading') e.currentTarget.style.opacity = '1'; }}
          >
            {bundleStatus.state === 'loading' ? 'Creating...' : 'Create Bundle'}
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={handleDownload}
            onMouseOver={(e) => { e.currentTarget.style.opacity = '0.9'; }}
            onMouseOut={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            Download
          </button>
        </>
      );
    }

    // Fallback: server not available
    return (
      <button
        type="button"
        style={secondaryButtonStyle}
        onClick={handleDownload}
        onMouseOver={(e) => { e.currentTarget.style.opacity = '0.9'; }}
        onMouseOut={(e) => { e.currentTarget.style.opacity = '1'; }}
      >
        Download Logs
      </button>
    );
  };

  if (isMinimized) {
    return (
      <div style={containerStyle} className={className}>
        <div style={panelStyle}>
          <div style={headerStyle} onClick={toggleMinimize}>
            <div style={titleStyle}>
              <span style={statusDotStyle} />
              <span>Debug</span>
              <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>({logCount})</span>
            </div>
            <button
              type="button"
              style={minimizeButtonStyle}
              onClick={(e) => {
                e.stopPropagation();
                toggleMinimize();
              }}
              aria-label="Expand"
            >
              +
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle} className={className}>
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
      <div style={panelStyle}>
        <div style={headerStyle} onClick={toggleMinimize}>
          <div style={titleStyle}>
            <span style={statusDotStyle} />
            <span>Debug capture ON</span>
          </div>
          <button
            type="button"
            style={minimizeButtonStyle}
            onClick={(e) => {
              e.stopPropagation();
              toggleMinimize();
            }}
            aria-label="Minimize"
          >
            -
          </button>
        </div>

        <div style={sessionIdStyle}>
          Session: {api.getSessionId().slice(0, 8)}...
        </div>
        <div style={serverIndicatorStyle}>
          {serverStatus.available
            ? `Server: connected${serverStatus.projectName ? ` (${serverStatus.projectName})` : ''}`
            : 'Server: not connected'}
        </div>
        {serverStatus.available && serverStatus.outputDir && (
          <div style={{ ...serverIndicatorStyle, marginTop: 1, opacity: 0.8 }}>
            Output: {serverStatus.outputDir}
          </div>
        )}

        <div style={statsStyle}>
          <span style={{ color: logCount > 0 ? '#fbbf24' : 'rgba(255, 255, 255, 0.6)' }}>
            {logCount} {logCount === 1 ? 'entry' : 'entries'} captured
          </span>
        </div>

        {renderBundleStatus()}

        <div style={buttonContainerStyle}>
          {renderActionButtons()}
          <button
            type="button"
            style={clearButtonStyle}
            onClick={handleClear}
            onMouseOver={(e) => { e.currentTarget.style.opacity = '0.8'; }}
            onMouseOut={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

export default DebugPanel;
