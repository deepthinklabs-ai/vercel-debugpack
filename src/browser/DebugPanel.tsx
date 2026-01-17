/**
 * React component for the debug capture UI overlay.
 * Wraps the vanilla capture core and provides a simple UI for staging environments.
 */

import React, { useEffect, useState, useCallback } from 'react';
import type { DebugPanelProps } from './types';
import { initDebugCapture, getDebugCapture, type DebugCaptureAPI } from './capture';

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

  const handleDownload = useCallback(() => {
    api?.downloadLogs();
  }, [api]);

  const handleClear = useCallback(() => {
    api?.clearLogs();
    setLogCount(0);
  }, [api]);

  const toggleMinimize = useCallback(() => {
    setIsMinimized((prev) => !prev);
  }, []);

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
    minWidth: isMinimized ? 'auto' : 200,
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

  const downloadButtonStyle: React.CSSProperties = {
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

        <div style={statsStyle}>
          <span style={{ color: logCount > 0 ? '#fbbf24' : 'rgba(255, 255, 255, 0.6)' }}>
            {logCount} {logCount === 1 ? 'entry' : 'entries'} captured
          </span>
        </div>

        <div style={buttonContainerStyle}>
          <button
            type="button"
            style={downloadButtonStyle}
            onClick={handleDownload}
            onMouseOver={(e) => { e.currentTarget.style.opacity = '0.9'; }}
            onMouseOut={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            Download Logs
          </button>
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
