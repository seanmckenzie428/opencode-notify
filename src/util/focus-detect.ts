import { exec, type ExecOptionsWithStringEncoding } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import detectTerminal from 'detect-terminal';
import { promisify } from 'util';

import type { ShellRunner } from '../types/opencode-sdk.js';

/**
 * Focus Detection Module for OpenCode Smart Voice Notify
 *
 * Detects whether the user is currently looking at the OpenCode terminal.
 * Used to suppress notifications when the user is already focused on the terminal.
 *
 * Platform support:
 * - macOS: Full support using AppleScript to check frontmost app
 * - Windows: Not supported (returns false - no reliable API)
 * - Linux: Not supported (returns false - varies by desktop environment)
 *
 * @module util/focus-detect
 * @see docs/ARCHITECT_PLAN.md - Phase 3, Task 3.2
 */

type ExecAsync = (
  command: string,
  options?: ExecOptionsWithStringEncoding,
) => Promise<{ stdout: string; stderr: string }>;

interface FocusCacheState {
  isFocused: boolean;
  timestamp: number;
  terminalName: string | null;
}

interface FocusDetectionSupport {
  supported: boolean;
  reason?: string;
}

interface TerminalFocusOptions {
  debugLog?: boolean;
  shellRunner?: ShellRunner;
}

const getErrorMessage = (error: unknown): string => {
  const maybeError = error as { message?: unknown };
  return String(maybeError?.message);
};

const execAsync = promisify(exec) as ExecAsync;

// ========================================
// CACHING CONFIGURATION
// ========================================

/**
 * Cache for focus detection results.
 * Prevents excessive system calls (AppleScript execution).
 */
let focusCache: FocusCacheState = {
  isFocused: false,
  timestamp: 0,
  terminalName: null,
};

/**
 * Cache TTL in milliseconds.
 * Focus detection results are cached for this duration.
 * 500ms provides a good balance between responsiveness and performance.
 */
const CACHE_TTL_MS = 500;

/**
 * List of known terminal application names for macOS.
 * These are matched against the frontmost application name.
 * The detect-terminal package helps identify which terminal is in use.
 */
export const KNOWN_TERMINALS_MACOS = [
  'Terminal',
  'iTerm',
  'iTerm2',
  'Hyper',
  'Alacritty',
  'kitty',
  'WezTerm',
  'Tabby',
  'Warp',
  'Rio',
  'Ghostty',
  // VS Code and other IDEs with integrated terminals
  'Code',
  'Visual Studio Code',
  'VSCodium',
  'Cursor',
  'Windsurf',
  'Zed',
  // JetBrains IDEs
  'IntelliJ IDEA',
  'WebStorm',
  'PyCharm',
  'PhpStorm',
  'GoLand',
  'RubyMine',
  'CLion',
  'DataGrip',
  'Rider',
  'Android Studio',
] as const;

// ========================================
// DEBUG LOGGING
// ========================================

/**
 * Debug logging to file.
 * Only logs when enabled.
 * Writes to ~/.config/opencode/logs/smart-voice-notify-debug.log
 *
 * @param message - Message to log
 * @param enabled - Whether debug logging is enabled
 */
const debugLog = (message: string, enabled = false): void => {
  if (!enabled) return;

  try {
    const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
    const logsDir = path.join(configDir, 'logs');

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const logFile = path.join(logsDir, 'smart-voice-notify-debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] [focus-detect] ${message}\n`);
  } catch {
    // Silently fail - logging should never break the plugin
  }
};

// ========================================
// PLATFORM DETECTION
// ========================================

/**
 * Get the current platform identifier.
 */
export const getPlatform = (): NodeJS.Platform => os.platform();

/**
 * Check if focus detection is supported on this platform.
 *
 * @returns Support status
 */
export const isFocusDetectionSupported = (): FocusDetectionSupport => {
  const platform = getPlatform();

  switch (platform) {
    case 'darwin':
      return { supported: true };
    case 'win32':
      return { supported: false, reason: 'Windows focus detection not supported - no reliable API' };
    case 'linux':
      return {
        supported: false,
        reason: 'Linux focus detection not supported - varies by desktop environment',
      };
    default:
      return { supported: false, reason: `Unsupported platform: ${platform}` };
  }
};

// ========================================
// TERMINAL DETECTION
// ========================================

/**
 * Detect the current terminal emulator using detect-terminal package.
 * Caches the result since the terminal doesn't change during execution.
 *
 * @param debug - Enable debug logging
 * @returns Terminal name or null if not detected
 */
let cachedTerminalName: string | null = null;
let terminalDetectionAttempted = false;

export const getTerminalName = (debug = false): string | null => {
  // Return cached result if already detected
  if (terminalDetectionAttempted) {
    return cachedTerminalName;
  }

  try {
    terminalDetectionAttempted = true;
    // Prefer the outer terminal (GUI app) over multiplexers like tmux/screen
    const terminal = detectTerminal({ preferOuter: true });
    cachedTerminalName = terminal || null;
    debugLog(`Detected terminal: ${cachedTerminalName}`, debug);
    return cachedTerminalName;
  } catch (error) {
    debugLog(`Terminal detection failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

// ========================================
// FOCUS DETECTION - macOS
// ========================================

/**
 * AppleScript to get the frontmost application name.
 * Uses System Events to determine which app is currently focused.
 */
const APPLESCRIPT_GET_FRONTMOST = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  return name of frontApp
end tell
`;

/**
 * Get the name of the frontmost application on macOS.
 *
 * @param debug - Enable debug logging
 * @returns Frontmost app name or null on error
 */
const getFrontmostAppMacOS = async (debug = false): Promise<string | null> => {
  try {
    const { stdout } = await execAsync(`osascript -e '${APPLESCRIPT_GET_FRONTMOST}'`, {
      encoding: 'utf8',
      timeout: 2000, // 2 second timeout
      maxBuffer: 1024, // Small buffer - we only expect app name
    });

    const appName = stdout.trim();
    debugLog(`Frontmost app: "${appName}"`, debug);
    return appName;
  } catch (error) {
    debugLog(`Failed to get frontmost app: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

/**
 * Check if the frontmost app is a known terminal on macOS.
 *
 * @param appName - The frontmost application name
 * @param debug - Enable debug logging
 * @returns True if the app is a known terminal
 */
const isKnownTerminal = (appName: string | null, debug = false): boolean => {
  if (!appName) return false;

  // Direct match
  if (KNOWN_TERMINALS_MACOS.some((t) => t.toLowerCase() === appName.toLowerCase())) {
    debugLog(`"${appName}" is a known terminal (direct match)`, debug);
    return true;
  }

  // Partial match (for apps like "iTerm2" matching "iTerm")
  if (KNOWN_TERMINALS_MACOS.some((t) => appName.toLowerCase().includes(t.toLowerCase()))) {
    debugLog(`"${appName}" is a known terminal (partial match)`, debug);
    return true;
  }

  // Check if the detected terminal from detect-terminal matches
  const detectedTerminal = getTerminalName(debug);
  if (detectedTerminal && appName.toLowerCase().includes(detectedTerminal.toLowerCase())) {
    debugLog(`"${appName}" matches detected terminal "${detectedTerminal}"`, debug);
    return true;
  }

  debugLog(`"${appName}" is NOT a known terminal`, debug);
  return false;
};

// ========================================
// MAIN FOCUS DETECTION FUNCTION
// ========================================

/**
 * Check if the OpenCode terminal is currently focused.
 *
 * This function detects whether the user is currently looking at the terminal
 * where OpenCode is running. Used to suppress notifications when the user
 * is already paying attention to the terminal.
 *
 * Platform behavior:
 * - macOS: Uses AppleScript to check the frontmost application
 * - Windows: Always returns false (not supported)
 * - Linux: Always returns false (not supported)
 *
 * Results are cached for 500ms to avoid excessive system calls.
 *
 * @param options - Options
 * @returns True if terminal is focused, false otherwise
 *
 * @example
 * const focused = await isTerminalFocused({ debugLog: true });
 * if (focused) {
 *   console.log('User is looking at the terminal - skip notification');
 * }
 */
export const isTerminalFocused = async (options: TerminalFocusOptions = {}): Promise<boolean> => {
  const debug = options?.debugLog || false;
  const now = Date.now();

  // Check cache first
  if (now - focusCache.timestamp < CACHE_TTL_MS) {
    debugLog(`Using cached focus result: ${focusCache.isFocused}`, debug);
    return focusCache.isFocused;
  }

  const platform = getPlatform();

  // Platform-specific implementation
  if (platform === 'darwin') {
    try {
      const frontmostApp = await getFrontmostAppMacOS(debug);
      const isFocused = isKnownTerminal(frontmostApp, debug);

      // Update cache
      focusCache = {
        isFocused,
        timestamp: now,
        terminalName: frontmostApp,
      };

      debugLog(`Focus detection complete: ${isFocused} (frontmost: "${frontmostApp}")`, debug);
      return isFocused;
    } catch (error) {
      debugLog(`Focus detection error: ${getErrorMessage(error)}`, debug);
      // On error, assume not focused (fail open - still notify)
      focusCache = {
        isFocused: false,
        timestamp: now,
        terminalName: null,
      };
      return false;
    }
  }

  // Windows and Linux: Not supported
  if (platform === 'win32') {
    debugLog('Focus detection not supported on Windows', debug);
  } else if (platform === 'linux') {
    debugLog('Focus detection not supported on Linux', debug);
  } else {
    debugLog(`Focus detection not supported on platform: ${platform}`, debug);
  }

  // Cache the result even for unsupported platforms
  focusCache = {
    isFocused: false,
    timestamp: now,
    terminalName: null,
  };

  return false;
};

/**
 * Clear the focus detection cache.
 * Useful for testing or when forcing a fresh check.
 */
export const clearFocusCache = (): void => {
  focusCache = {
    isFocused: false,
    timestamp: 0,
    terminalName: null,
  };
};

/**
 * Reset the terminal detection cache.
 * Useful for testing.
 */
export const resetTerminalDetection = (): void => {
  cachedTerminalName = null;
  terminalDetectionAttempted = false;
};

/**
 * Get the current cache state.
 * Useful for testing and debugging.
 */
export const getCacheState = (): FocusCacheState => ({ ...focusCache });

// Default export for convenience
export default {
  isTerminalFocused,
  isFocusDetectionSupported,
  getTerminalName,
  getPlatform,
  clearFocusCache,
  resetTerminalDetection,
  getCacheState,
  KNOWN_TERMINALS_MACOS,
};
