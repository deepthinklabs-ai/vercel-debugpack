/**
 * Browser-side redaction utilities.
 * Sanitizes URLs and truncates strings to prevent sensitive data capture.
 */

/**
 * Sanitizes a URL by removing query parameters and hash.
 * Keeps only the origin and pathname.
 *
 * @param url - The URL to sanitize
 * @returns Sanitized URL with only origin + pathname, or the original if parsing fails
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Return origin + pathname only (no query params, no hash)
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // If URL parsing fails (e.g., relative URL), try to strip query params manually
    const queryIndex = url.indexOf('?');
    const hashIndex = url.indexOf('#');

    let endIndex = url.length;
    if (queryIndex !== -1) endIndex = Math.min(endIndex, queryIndex);
    if (hashIndex !== -1) endIndex = Math.min(endIndex, hashIndex);

    return url.slice(0, endIndex);
  }
}

/**
 * Truncates a string if it exceeds the maximum length.
 *
 * @param str - The string to potentially truncate
 * @param maxLength - Maximum allowed length
 * @returns Original string or truncated version with '...[truncated]' suffix
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }

  const suffix = '...[truncated]';
  const truncateAt = maxLength - suffix.length;

  if (truncateAt <= 0) {
    return suffix;
  }

  return str.slice(0, truncateAt) + suffix;
}

/**
 * Safely converts any value to a string for logging.
 * Handles objects, errors, and circular references.
 *
 * @param value - Any value to convert to string
 * @param maxLength - Maximum length for the result
 * @returns String representation of the value
 */
export function safeStringify(value: unknown, maxLength: number): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  if (value instanceof Error) {
    return truncateString(value.message || String(value), maxLength);
  }

  if (typeof value === 'string') {
    return truncateString(value, maxLength);
  }

  if (typeof value === 'object') {
    try {
      const seen = new WeakSet();
      const json = JSON.stringify(value, (key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) {
            return '[Circular]';
          }
          seen.add(val);
        }
        return val;
      });
      return truncateString(json, maxLength);
    } catch {
      return truncateString(String(value), maxLength);
    }
  }

  return truncateString(String(value), maxLength);
}

/**
 * Extracts a stack trace from an Error or creates one from the current call site.
 *
 * @param error - Optional Error object
 * @param maxLength - Maximum length for the stack trace
 * @returns Stack trace string or null
 */
export function extractStack(error: Error | undefined, maxLength: number): string | null {
  if (error?.stack) {
    return truncateString(error.stack, maxLength);
  }

  // Try to capture current stack
  try {
    const tempError = new Error();
    if (tempError.stack) {
      // Remove the first few lines (this function and its callers)
      const lines = tempError.stack.split('\n');
      const relevantLines = lines.slice(3); // Skip Error, extractStack, and caller
      if (relevantLines.length > 0) {
        return truncateString(relevantLines.join('\n'), maxLength);
      }
    }
  } catch {
    // Ignore stack capture errors
  }

  return null;
}
