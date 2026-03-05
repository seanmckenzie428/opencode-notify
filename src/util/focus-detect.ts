import { exec, type ExecOptionsWithStringEncoding } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import detectTerminal from 'detect-terminal';
import { promisify } from 'util';

import { createLinuxPlatform } from './linux.js';
import type { ShellRunner } from '../types/opencode-sdk.js';

/**
 * Focus Detection Module for OpenCode Smart Voice Notify
 *
 * Detects app focus and user presence for OpenCode notifications.
 * Used to suppress local notifications while user is actively focused,
 * and to gate remote webhooks when the user appears away.
 *
 * Platform support:
 * - macOS: Full support using AppleScript to check frontmost app
 * - Windows: Full support using PowerShell + Get-Process
 * - Linux: X11 (xdotool/xprop) and Wayland (Sway/GNOME/KDE)
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

interface FrontmostContext {
  appName: string | null;
  bundleId: string | null;
  windowTitle: string | null;
  browserUrl: string | null;
  rawOutput: string | null;
}

interface OpenCodeClientFocusOptions extends TerminalFocusOptions {
  desktopAppNames?: readonly string[];
  desktopBundleIds?: readonly string[];
  browserAppNames?: readonly string[];
  browserBundleIds?: readonly string[];
  browserTitleKeywords?: readonly string[];
  browserUrlKeywords?: readonly string[];
}

interface UserPresenceOptions extends TerminalFocusOptions {
  idleThresholdSeconds?: number;
}

export interface UserPresenceState {
  supported: boolean;
  isLocked: boolean;
  isScreenAsleep: boolean;
  isAway: boolean;
  idleSeconds: number | null;
  displaySleepThresholdSeconds: number | null;
  reason?: string;
}

const getErrorMessage = (error: unknown): string => {
  const maybeError = error as { message?: unknown };
  return String(maybeError?.message);
};

const execAsync = promisify(exec) as ExecAsync;

const toUtf8Text = (value: Buffer | Uint8Array | string | null | undefined): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (!value) {
    return '';
  }

  return Buffer.from(value).toString('utf8');
};

const executeCommand = async (
  command: string,
  options: ExecOptionsWithStringEncoding,
  shellRunner?: ShellRunner,
): Promise<{ stdout: string; stderr: string }> => {
  if (!shellRunner) {
    return execAsync(command, options);
  }

  const execution = shellRunner`${command}`.quiet().nothrow();
  if (typeof execution.timeout === 'function') {
    execution.timeout(typeof options.timeout === 'number' ? options.timeout : 2000);
  }

  const shellResult = await execution;

  return {
    stdout: toUtf8Text(shellResult.stdout),
    stderr: toUtf8Text(shellResult.stderr),
  };
};

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

let frontmostContextCache: FrontmostContext & { timestamp: number } = {
  appName: null,
  bundleId: null,
  windowTitle: null,
  browserUrl: null,
  rawOutput: null,
  timestamp: 0,
};

let presenceCache: UserPresenceState & { timestamp: number } = {
  supported: false,
  isLocked: false,
  isScreenAsleep: false,
  isAway: false,
  idleSeconds: null,
  displaySleepThresholdSeconds: null,
  reason: 'No presence check has run yet',
  timestamp: 0,
};

/**
 * Cache TTL in milliseconds.
 * Focus detection results are cached for this duration.
 * 500ms provides a good balance between responsiveness and performance.
 */
const CACHE_TTL_MS = 500;

/**
 * Presence cache TTL in milliseconds.
 * Presence checks invoke multiple system commands, so cache a bit longer.
 */
const PRESENCE_CACHE_TTL_MS = 2000;

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
] as const;

/**
 * List of known terminal application names and process names for Windows.
 * These are matched against the focused process name from PowerShell.
 */
export const KNOWN_TERMINALS_WINDOWS = [
  'Windows Terminal',
  'WindowsTerminal',
  'cmd',
  'cmd.exe',
  'Command Prompt',
  'PowerShell',
  'powershell',
  'pwsh',
  'conhost',
  'Alacritty',
  'kitty',
  'WezTerm',
  'Hyper',
  'Tabby',
  'Warp',
  'Rio',
  'Ghostty',
  // Unix-like shells on Windows
  'Git Bash',
  'bash',
  'MINGW64',
  'Cygwin',
  'MSYS2',
] as const;

/**
 * List of known terminal application names and window classes for Linux.
 */
export const KNOWN_TERMINALS_LINUX = [
  'gnome-terminal',
  'gnome terminal',
  'gnome-terminal-server',
  'konsole',
  'xfce4-terminal',
  'mate-terminal',
  'lxterminal',
  'terminator',
  'tilix',
  'terminology',
  'kitty',
  'alacritty',
  'wezterm',
  'hyper',
  'tabby',
  'warp',
  'rio',
  'ghostty',
  'foot',
  'xterm',
  'urxvt',
  'rxvt',
  'st',
] as const;

export const KNOWN_OPENCODE_DESKTOP_APPS = [
  'OpenCode',
  'Open Code',
  'OpenCode Desktop',
] as const;

export const KNOWN_OPENCODE_DESKTOP_BUNDLE_IDS = [
  'ai.opencode.desktop',
  'com.opencode.desktop',
  'ai.opencode.app',
  'com.opencode.app',
] as const;

export const KNOWN_BROWSER_APPS = [
  'Safari',
  'Google Chrome',
  'Chrome',
  'Arc',
  'Firefox',
  'Brave Browser',
  'Microsoft Edge',
  'Edge',
  'Opera',
  'Vivaldi',
  'Chromium',
  'msedge',
  'msedge.exe',
  'chrome',
  'chrome.exe',
  'firefox',
  'firefox.exe',
] as const;

export const KNOWN_BROWSER_BUNDLE_IDS = [
  'com.apple.Safari',
  'com.google.Chrome',
  'company.thebrowser.Browser',
  'org.mozilla.firefox',
  'com.brave.Browser',
  'com.microsoft.edgemac',
  'com.operasoftware.Opera',
  'com.vivaldi.Vivaldi',
] as const;

export const OPENCODE_BROWSER_TITLE_KEYWORDS = [
  'opencode',
  'open code',
  'opencode.ai',
] as const;

export const OPENCODE_BROWSER_URL_KEYWORDS = [
  'opencode.ai',
  'opencode',
  'localhost:4096',
  'opencode.local',
  'opencode.local:4096',
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
      return { supported: true };
    case 'linux':
      return { supported: true };
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
 * Includes checks for:
 * - App visibility (not hidden with Cmd+H)
 * - Visible, non-minimized windows
 * Returns empty string if app is hidden or has no visible windows.
 */
const APPLESCRIPT_GET_FRONTMOST = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  
  -- Check if app is visible (not hidden with Cmd+H)
  if visible of frontApp is false then
    return ""
  end if
  
  -- Check if the app has any visible, non-minimized windows
  try
    set windowList to every window of frontApp whose visible is true and miniaturized is false
    if (count of windowList) is 0 then
      return ""
    end if
  end try
  
  return name of frontApp
end tell
`;

const APPLESCRIPT_GET_FRONTMOST_CONTEXT = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true

  set appName to ""
  set bundleID to ""
  set windowTitle to ""
  set browserURL to ""

  try
    set appName to name of frontApp
  end try

  try
    set bundleID to bundle identifier of frontApp
  end try

  if visible of frontApp is false then
    return appName & "|||" & bundleID & "|||" & windowTitle & "|||" & browserURL
  end if

  try
    set windowList to every window of frontApp whose visible is true and miniaturized is false
    if (count of windowList) is greater than 0 then
      set windowTitle to name of first item of windowList
    end if
  end try

  try
    if appName is "Safari" then
      tell application "Safari"
        if (count of windows) is greater than 0 then
          set browserURL to URL of front document
        end if
      end tell
    else if appName is in {"Google Chrome", "Chrome", "Chromium", "Brave Browser", "Microsoft Edge", "Opera", "Vivaldi", "Arc"} then
      tell application appName
        if (count of windows) is greater than 0 then
          set browserURL to URL of active tab of front window
        end if
      end tell
    end if
  end try

  return appName & "|||" & bundleID & "|||" & windowTitle & "|||" & browserURL
end tell
`;

/**
 * PowerShell script to get the frontmost process on Windows.
 * Uses user32.dll to get foreground window handle, then Get-Process by PID.
 * Includes checks for minimized (IsIconic) and invisible (IsWindowVisible) windows.
 */
const POWERSHELL_GET_FRONTMOST_PROCESS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class Win32FocusDetect {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@

$processId = 0
$foregroundWindow = [Win32FocusDetect]::GetForegroundWindow()

# No foreground window (e.g., showing desktop)
if ($foregroundWindow -eq [IntPtr]::Zero) {
  return
}

# Check if window is minimized (iconic) - if so, not truly focused
if ([Win32FocusDetect]::IsIconic($foregroundWindow)) {
  return
}

# Check if window is visible - if not, not truly focused
if (-not [Win32FocusDetect]::IsWindowVisible($foregroundWindow)) {
  return
}

[Win32FocusDetect]::GetWindowThreadProcessId($foregroundWindow, [ref]$processId) | Out-Null
if ($processId -le 0) {
  return
}

Get-Process -Id $processId | Select-Object -ExpandProperty ProcessName
`;

const getEncodedPowerShellScript = (script: string): string =>
  Buffer.from(script, 'utf16le').toString('base64');

/**
 * Get the name of the frontmost application on macOS.
 *
 * @param debug - Enable debug logging
 * @returns Frontmost app name or null on error
 */
const getFrontmostAppMacOS = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  try {
    const { stdout } = await executeCommand(
      `osascript -e '${APPLESCRIPT_GET_FRONTMOST}'`,
      {
        encoding: 'utf8',
        timeout: 2000, // 2 second timeout
        maxBuffer: 1024, // Small buffer - we only expect app name
      },
      shellRunner,
    );

    const appName = stdout.trim();
    debugLog(`Frontmost app: "${appName}"`, debug);
    return appName;
  } catch (error) {
    debugLog(`Failed to get frontmost app: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const parseFrontmostContextOutput = (output: string): FrontmostContext => {
  const trimmedOutput = output.trim();
  if (!trimmedOutput) {
    return {
      appName: null,
      bundleId: null,
      windowTitle: null,
      browserUrl: null,
      rawOutput: null,
    };
  }

  const delimiter = '|||';
  if (!trimmedOutput.includes(delimiter)) {
    return {
      appName: trimmedOutput,
      bundleId: null,
      windowTitle: null,
      browserUrl: null,
      rawOutput: trimmedOutput,
    };
  }

  const [rawAppName = '', rawBundleId = '', rawWindowTitle = '', ...urlParts] = trimmedOutput.split(delimiter);
  const rawBrowserUrl = urlParts.join(delimiter);
  const appName = rawAppName?.trim() || null;
  const bundleId = rawBundleId?.trim() || null;
  const windowTitle = rawWindowTitle?.trim() || null;
  const browserUrl = rawBrowserUrl?.trim() || null;

  return {
    appName,
    bundleId,
    windowTitle,
    browserUrl,
    rawOutput: trimmedOutput,
  };
};

const getFrontmostContextMacOS = async (debug = false, shellRunner?: ShellRunner): Promise<FrontmostContext> => {
  try {
    const { stdout } = await executeCommand(
      `osascript -e '${APPLESCRIPT_GET_FRONTMOST_CONTEXT}'`,
      {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 4096,
      },
      shellRunner,
    );

    const context = parseFrontmostContextOutput(stdout);
    debugLog(
      `Frontmost context: app="${context.appName || ''}" bundle="${context.bundleId || ''}" title="${context.windowTitle || ''}" url="${context.browserUrl || ''}"`,
      debug,
    );
    return context;
  } catch (error) {
    debugLog(`Failed to get frontmost context: ${getErrorMessage(error)}`, debug);
    return {
      appName: null,
      bundleId: null,
      windowTitle: null,
      browserUrl: null,
      rawOutput: null,
    };
  }
};

/**
 * Get the focused process name on Windows via PowerShell.
 *
 * @param debug - Enable debug logging
 * @param shellRunner - Optional shell runner override for testing
 * @returns Focused process name or null on error
 */
const getFrontmostAppWindows = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  try {
    const encodedScript = getEncodedPowerShellScript(POWERSHELL_GET_FRONTMOST_PROCESS);
    const command =
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

    const { stdout, stderr } = await executeCommand(
      command,
      {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 1024,
      },
      shellRunner,
    );

    if (stderr.trim()) {
      debugLog(`PowerShell stderr: ${stderr.trim()}`, debug);
    }

    const processName = stdout.trim();
    if (!processName) {
      debugLog('PowerShell returned empty focused process name', debug);
      return null;
    }

    debugLog(`Frontmost process: "${processName}"`, debug);
    return processName;
  } catch (error) {
    debugLog(`Failed to get frontmost Windows process: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const getFrontmostContextWindows = async (debug = false, shellRunner?: ShellRunner): Promise<FrontmostContext> => {
  const appName = await getFrontmostAppWindows(debug, shellRunner);
  return {
    appName,
    bundleId: null,
    windowTitle: null,
    browserUrl: null,
    rawOutput: appName,
  };
};

const getLinuxSessionType = (): 'x11' | 'wayland' | 'tty' | 'unknown' => {
  try {
    return createLinuxPlatform({}).getSessionType();
  } catch {
    return 'unknown';
  }
};

const runLinuxFocusCommand = async (
  command: string,
  debug: boolean,
  label: string,
  shellRunner?: ShellRunner,
): Promise<string | null> => {
  try {
    const { stdout, stderr } = await executeCommand(
      command,
      {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 1024 * 1024,
      },
      shellRunner,
    );

    if (stderr.trim()) {
      debugLog(`${label}: stderr: ${stderr.trim()}`, debug);
    }

    const output = stdout.trim();
    if (!output) {
      debugLog(`${label}: empty output`, debug);
      return null;
    }

    return output;
  } catch (error) {
    debugLog(`${label}: command failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const parseQuotedValues = (text: string): string[] => {
  const values: string[] = [];
  const matches = text.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g) || [];

  for (const match of matches) {
    const value = match.slice(1, -1).trim();
    if (value) {
      values.push(value);
    }
  }

  return values;
};

const getFrontmostAppLinuxX11 = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  if (!process.env.DISPLAY) {
    debugLog('linux.x11: DISPLAY not set', debug);
    return null;
  }

  const xdotoolClass = await runLinuxFocusCommand(
    'xdotool getwindowfocus getwindowclassname',
    debug,
    'linux.x11.xdotool-class',
    shellRunner,
  );
  if (xdotoolClass) {
    debugLog(`linux.x11: focused class from xdotool: "${xdotoolClass}"`, debug);
    return xdotoolClass;
  }

  const xdotoolName = await runLinuxFocusCommand(
    'xdotool getwindowfocus getwindowname',
    debug,
    'linux.x11.xdotool-name',
    shellRunner,
  );
  if (xdotoolName) {
    debugLog(`linux.x11: focused name from xdotool: "${xdotoolName}"`, debug);
    return xdotoolName;
  }

  const activeWindow = await runLinuxFocusCommand(
    'xprop -root _NET_ACTIVE_WINDOW',
    debug,
    'linux.x11.xprop-active-window',
    shellRunner,
  );

  const windowId = activeWindow?.match(/0x[0-9a-f]+/i)?.[0] || null;
  if (!windowId) {
    debugLog('linux.x11: active window id parse failed', debug);
    return null;
  }

  const windowProps = await runLinuxFocusCommand(
    `xprop -id ${windowId} WM_CLASS WM_NAME`,
    debug,
    'linux.x11.xprop-window-props',
    shellRunner,
  );

  if (!windowProps) {
    return null;
  }

  const quotedValues = parseQuotedValues(windowProps);
  const focused = quotedValues.find(Boolean) || null;
  if (focused) {
    debugLog(`linux.x11: focused value from xprop: "${focused}"`, debug);
  }

  return focused;
};

interface SwayTreeNode {
  focused?: boolean;
  name?: string;
  app_id?: string;
  window_properties?: {
    class?: string;
    instance?: string;
    title?: string;
  };
  nodes?: SwayTreeNode[];
  floating_nodes?: SwayTreeNode[];
}

const findFocusedSwayNode = (node: SwayTreeNode): SwayTreeNode | null => {
  if (node.focused) {
    return node;
  }

  const children = [...(node.nodes || []), ...(node.floating_nodes || [])];
  for (const child of children) {
    const result = findFocusedSwayNode(child);
    if (result) {
      return result;
    }
  }

  return null;
};

const getFrontmostAppWaylandSway = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  const treeOutput = await runLinuxFocusCommand(
    'swaymsg -t get_tree',
    debug,
    'linux.wayland.swaymsg',
    shellRunner,
  );

  if (!treeOutput) {
    return null;
  }

  try {
    const tree = JSON.parse(treeOutput) as SwayTreeNode;
    const focused = findFocusedSwayNode(tree);
    if (!focused) {
      debugLog('linux.wayland.swaymsg: focused node not found', debug);
      return null;
    }

    const name =
      focused.app_id ||
      focused.window_properties?.class ||
      focused.window_properties?.instance ||
      focused.name ||
      focused.window_properties?.title ||
      null;

    if (name) {
      debugLog(`linux.wayland.swaymsg: focused app "${name}"`, debug);
    }

    return name;
  } catch (error) {
    debugLog(`linux.wayland.swaymsg: parse failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const parseGdbusEvalResult = (output: string): string | null => {
  const match = output.match(/^\((true|false),\s*(.*)\)$/s);
  if (!match) {
    return output.trim() || null;
  }

  if (match[1] !== 'true') {
    return null;
  }

  let value = match[2]?.trim() || '';
  if (!value || value === "''" || value === '""') {
    return null;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value.trim() || null;
};

const getFrontmostAppWaylandGnome = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  const command =
    'gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "(() => { const w = global.display.focus_window; if (!w) return \"\"; return [w.get_wm_class(), w.get_title()].filter(Boolean).join(\" - \" ); })()"';

  const result = await runLinuxFocusCommand(command, debug, 'linux.wayland.gdbus', shellRunner);
  if (!result) {
    return null;
  }

  const parsed = parseGdbusEvalResult(result);
  if (parsed) {
    debugLog(`linux.wayland.gdbus: focused app "${parsed}"`, debug);
  }

  return parsed;
};

const getFrontmostAppWaylandKde = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  const activeWindow = await runLinuxFocusCommand(
    'qdbus org.kde.KWin /KWin org.kde.KWin.activeWindow',
    debug,
    'linux.wayland.qdbus-active-window',
    shellRunner,
  );

  if (!activeWindow) {
    return null;
  }

  const caption = await runLinuxFocusCommand(
    `qdbus org.kde.KWin /KWin org.kde.KWin.caption ${activeWindow}`,
    debug,
    'linux.wayland.qdbus-caption',
    shellRunner,
  );

  const windowClass = await runLinuxFocusCommand(
    `qdbus org.kde.KWin /KWin org.kde.KWin.windowClass ${activeWindow}`,
    debug,
    'linux.wayland.qdbus-window-class',
    shellRunner,
  );

  const appName = windowClass || caption || activeWindow;
  debugLog(`linux.wayland.qdbus: focused app "${appName}"`, debug);
  return appName;
};

type LinuxDesktopEnvironment = 'sway' | 'gnome' | 'kde' | 'unknown';

const detectWaylandDesktopEnvironment = (): LinuxDesktopEnvironment => {
  const desktopInfo = [
    process.env.XDG_CURRENT_DESKTOP,
    process.env.XDG_SESSION_DESKTOP,
    process.env.DESKTOP_SESSION,
  ]
    .filter(Boolean)
    .join(':')
    .toLowerCase();

  if (desktopInfo.includes('sway') || !!process.env.SWAYSOCK) {
    return 'sway';
  }
  if (desktopInfo.includes('gnome')) {
    return 'gnome';
  }
  if (desktopInfo.includes('kde') || desktopInfo.includes('plasma')) {
    return 'kde';
  }

  return 'unknown';
};

const getFrontmostAppLinuxWayland = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  const desktop = detectWaylandDesktopEnvironment();
  debugLog(`linux.wayland: desktop detected as ${desktop}`, debug);

  if (desktop === 'sway') {
    const swayResult = await getFrontmostAppWaylandSway(debug, shellRunner);
    if (swayResult) {
      return swayResult;
    }
  }

  if (desktop === 'gnome') {
    const gnomeResult = await getFrontmostAppWaylandGnome(debug, shellRunner);
    if (gnomeResult) {
      return gnomeResult;
    }
  }

  if (desktop === 'kde') {
    const kdeResult = await getFrontmostAppWaylandKde(debug, shellRunner);
    if (kdeResult) {
      return kdeResult;
    }
  }

  const swayResult = await getFrontmostAppWaylandSway(debug, shellRunner);
  if (swayResult) {
    return swayResult;
  }

  const gnomeResult = await getFrontmostAppWaylandGnome(debug, shellRunner);
  if (gnomeResult) {
    return gnomeResult;
  }

  return await getFrontmostAppWaylandKde(debug, shellRunner);
};

/**
 * Get the focused Linux app/window name via X11 or Wayland fallback chain.
 */
const getFrontmostAppLinux = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  const sessionType = getLinuxSessionType();
  debugLog(`linux: session type detected as ${sessionType}`, debug);

  if (sessionType === 'x11') {
    return await getFrontmostAppLinuxX11(debug, shellRunner);
  }

  if (sessionType === 'wayland') {
    return await getFrontmostAppLinuxWayland(debug, shellRunner);
  }

  if (sessionType === 'tty') {
    debugLog('linux: tty session - no focus window available', debug);
    return null;
  }

  const x11Result = await getFrontmostAppLinuxX11(debug, shellRunner);
  if (x11Result) {
    return x11Result;
  }

  return await getFrontmostAppLinuxWayland(debug, shellRunner);
};

const getFrontmostContextLinux = async (debug = false, shellRunner?: ShellRunner): Promise<FrontmostContext> => {
  const sessionType = getLinuxSessionType();

  if (sessionType === 'x11') {
    const appName = await runLinuxFocusCommand(
      'xdotool getwindowfocus getwindowclassname',
      debug,
      'linux.context.x11.class',
      shellRunner,
    );
    const windowTitle = await runLinuxFocusCommand(
      'xdotool getwindowfocus getwindowname',
      debug,
      'linux.context.x11.name',
      shellRunner,
    );
    return {
      appName: appName || windowTitle,
      bundleId: null,
      windowTitle,
      browserUrl: null,
      rawOutput: [appName, windowTitle].filter(Boolean).join(' || ') || null,
    };
  }

  const appName = await getFrontmostAppLinux(debug, shellRunner);
  return {
    appName,
    bundleId: null,
    windowTitle: appName,
    browserUrl: null,
    rawOutput: appName,
  };
};

/**
 * Check if the frontmost app is a known terminal on macOS.
 *
 * @param appName - The frontmost application name
 * @param debug - Enable debug logging
 * @returns True if the app is a known terminal
 */
const normalizeTerminalName = (name: string): string => name.trim().toLowerCase().replace(/\.exe$/i, '');

const isKnownTerminal = (
  appName: string | null,
  knownTerminals: readonly string[],
  debug = false,
  useDetectedTerminal = true,
): boolean => {
  if (!appName) return false;

  const normalizedAppName = normalizeTerminalName(appName);

  // Direct match
  if (knownTerminals.some((t) => normalizeTerminalName(t) === normalizedAppName)) {
    debugLog(`"${appName}" is a known terminal (direct match)`, debug);
    return true;
  }

  // Partial match (for apps like "iTerm2" matching "iTerm")
  if (knownTerminals.some((t) => normalizedAppName.includes(normalizeTerminalName(t)))) {
    debugLog(`"${appName}" is a known terminal (partial match)`, debug);
    return true;
  }

  // Check if the detected terminal from detect-terminal matches
  if (useDetectedTerminal) {
    const detectedTerminal = getTerminalName(debug);
    if (detectedTerminal && normalizedAppName.includes(normalizeTerminalName(detectedTerminal))) {
      debugLog(`"${appName}" matches detected terminal "${detectedTerminal}"`, debug);
      return true;
    }
  }

  debugLog(`"${appName}" is NOT a known terminal`, debug);
  return false;
};

const normalizeAppName = (name: string): string => name.trim().toLowerCase().replace(/\.exe$/i, '');

const matchesKnownApp = (appName: string | null, candidates: readonly string[]): boolean => {
  if (!appName) {
    return false;
  }

  const normalizedAppName = normalizeAppName(appName);
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeAppName(candidate);
    return normalizedAppName === normalizedCandidate || normalizedAppName.includes(normalizedCandidate);
  });
};

const hasKeyword = (value: string | null, keywords: readonly string[]): boolean => {
  if (!value) {
    return false;
  }

  const normalizedValue = value.toLowerCase();
  return keywords.some((keyword) => normalizedValue.includes(keyword.toLowerCase()));
};

const getFrontmostContext = async (options: TerminalFocusOptions = {}): Promise<FrontmostContext> => {
  const debug = options.debugLog || false;
  const now = Date.now();

  if (now - frontmostContextCache.timestamp < CACHE_TTL_MS) {
    return {
      appName: frontmostContextCache.appName,
      bundleId: frontmostContextCache.bundleId,
      windowTitle: frontmostContextCache.windowTitle,
      browserUrl: frontmostContextCache.browserUrl,
      rawOutput: frontmostContextCache.rawOutput,
    };
  }

  const platform = getPlatform();
  let context: FrontmostContext = {
    appName: null,
    bundleId: null,
    windowTitle: null,
    browserUrl: null,
    rawOutput: null,
  };

  if (platform === 'darwin') {
    context = await getFrontmostContextMacOS(debug, options.shellRunner);
  } else if (platform === 'win32') {
    context = await getFrontmostContextWindows(debug, options.shellRunner);
  } else if (platform === 'linux') {
    context = await getFrontmostContextLinux(debug, options.shellRunner);
  }

  frontmostContextCache = {
    ...context,
    timestamp: now,
  };

  return context;
};

/**
 * Check whether the OpenCode desktop app (or browser-based web client) is focused.
 */
export const isOpenCodeClientFocused = async (
  options: OpenCodeClientFocusOptions = {},
): Promise<boolean> => {
  const debug = options.debugLog || false;
  const context = await getFrontmostContext(options);
  const appName = context.appName;
  const bundleId = context.bundleId;

  if (!appName && !bundleId) {
    debugLog('OpenCode client focus check: frontmost app unavailable (name/bundle missing)', debug);
    return false;
  }

  const desktopAppNames = options.desktopAppNames || KNOWN_OPENCODE_DESKTOP_APPS;
  const desktopBundleIds = options.desktopBundleIds || KNOWN_OPENCODE_DESKTOP_BUNDLE_IDS;
  const isDesktopByName = matchesKnownApp(appName, desktopAppNames);
  const isDesktopByBundle = bundleId ? hasKeyword(bundleId, desktopBundleIds) : false;
  const isDesktopByGenericOpenCode =
    (appName ? normalizeAppName(appName).includes('opencode') : false) ||
    (bundleId ? bundleId.toLowerCase().includes('opencode') : false);

  if (isDesktopByName || isDesktopByBundle || isDesktopByGenericOpenCode) {
    debugLog(
      `OpenCode client focus check: desktop app focused (app="${appName || ''}", bundle="${bundleId || ''}")`,
      debug,
    );
    return true;
  }

  const browserAppNames = options.browserAppNames || KNOWN_BROWSER_APPS;
  const browserBundleIds = options.browserBundleIds || KNOWN_BROWSER_BUNDLE_IDS;
  const isBrowserByName = matchesKnownApp(appName, browserAppNames);
  const isBrowserByBundle = bundleId ? hasKeyword(bundleId, browserBundleIds) : false;
  const isBrowserFocused = isBrowserByName || isBrowserByBundle;
  if (!isBrowserFocused) {
    debugLog(
      `OpenCode client focus check: non-browser app focused (app="${appName || ''}", bundle="${bundleId || ''}")`,
      debug,
    );
    return false;
  }

  const browserTitleKeywords = options.browserTitleKeywords || OPENCODE_BROWSER_TITLE_KEYWORDS;
  const browserUrlKeywords = options.browserUrlKeywords || OPENCODE_BROWSER_URL_KEYWORDS;
  const titleSource = [context.windowTitle, context.rawOutput]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  const hasOpenCodeUrl = hasKeyword(context.browserUrl, browserUrlKeywords);
  const hasOpenCodeTitle = hasKeyword(titleSource, browserTitleKeywords);
  const isOpenCodeBrowserFocused = hasOpenCodeUrl || hasOpenCodeTitle;

  debugLog(
    `OpenCode client focus check: browser focused (app="${appName || ''}", bundle="${bundleId || ''}", title="${context.windowTitle || ''}", url="${context.browserUrl || ''}", hasOpenCodeUrl=${hasOpenCodeUrl}, hasOpenCodeTitle=${hasOpenCodeTitle})`,
    debug,
  );
  return isOpenCodeBrowserFocused;
};

const parseYesNoBoolean = (value: string): boolean | null => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'no' || normalized === 'false' || normalized === '0') {
    return false;
  }
  return null;
};

const getMacOSConsoleLocked = async (debug = false, shellRunner?: ShellRunner): Promise<boolean | null> => {
  try {
    const { stdout } = await executeCommand(
      'ioreg -l -n IOPMrootDomain -d1',
      {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 1024 * 1024,
      },
      shellRunner,
    );

    const match = stdout.match(/"IOConsoleLocked"\s*=\s*(Yes|No|true|false|1|0)/i);
    if (!match || !match[1]) {
      debugLog('presence.macos: could not parse IOConsoleLocked', debug);
      return null;
    }

    const isLocked = parseYesNoBoolean(match[1]);
    debugLog(`presence.macos: IOConsoleLocked=${match[1]} parsed=${String(isLocked)}`, debug);
    return isLocked;
  } catch (error) {
    debugLog(`presence.macos: lock check failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const getMacOSIdleSeconds = async (debug = false, shellRunner?: ShellRunner): Promise<number | null> => {
  try {
    const { stdout } = await executeCommand(
      'ioreg -c IOHIDSystem',
      {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 1024 * 1024,
      },
      shellRunner,
    );

    const match = stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/);
    const idleNanosRaw = match?.[1];
    if (!idleNanosRaw) {
      debugLog('presence.macos: could not parse HIDIdleTime', debug);
      return null;
    }

    const idleNanos = Number(idleNanosRaw);
    if (!Number.isFinite(idleNanos)) {
      debugLog(`presence.macos: HIDIdleTime is not numeric (${idleNanosRaw})`, debug);
      return null;
    }

    const idleSeconds = Math.floor(idleNanos / 1_000_000_000);
    debugLog(`presence.macos: idleSeconds=${idleSeconds}`, debug);
    return idleSeconds;
  } catch (error) {
    debugLog(`presence.macos: idle check failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const getMacOSDisplaySleepThresholdSeconds = async (
  debug = false,
  shellRunner?: ShellRunner,
): Promise<number | null> => {
  try {
    const { stdout } = await executeCommand(
      'pmset -g',
      {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 1024 * 128,
      },
      shellRunner,
    );

    const match = stdout.match(/\bdisplaysleep\s+(\d+(?:\.\d+)?)/i);
    const sleepMinutesRaw = match?.[1];
    if (!sleepMinutesRaw) {
      debugLog('presence.macos: could not parse displaysleep from pmset', debug);
      return null;
    }

    const sleepMinutes = Number(sleepMinutesRaw);
    if (!Number.isFinite(sleepMinutes) || sleepMinutes <= 0) {
      debugLog(`presence.macos: displaysleep not usable (${sleepMinutesRaw})`, debug);
      return null;
    }

    const thresholdSeconds = Math.floor(sleepMinutes * 60);
    debugLog(`presence.macos: displaysleep threshold=${thresholdSeconds}s`, debug);
    return thresholdSeconds;
  } catch (error) {
    debugLog(`presence.macos: display sleep threshold check failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const getMacOSDisplayAsleep = async (debug = false, shellRunner?: ShellRunner): Promise<boolean | null> => {
  try {
    const { stdout } = await executeCommand(
      'swift -e \'import CoreGraphics; print(CGDisplayIsAsleep(CGMainDisplayID()) != 0 ? "1" : "0")\'',
      {
        encoding: 'utf8',
        timeout: 3000,
        maxBuffer: 1024,
      },
      shellRunner,
    );

    const parsed = parseYesNoBoolean(stdout.trim());
    debugLog(`presence.macos: CGDisplayIsAsleep=${stdout.trim()} parsed=${String(parsed)}`, debug);
    return parsed;
  } catch (error) {
    debugLog(`presence.macos: CGDisplayIsAsleep check failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

/**
 * Get whether the current user appears away (locked or screen asleep).
 */
export const getUserPresenceState = async (
  options: UserPresenceOptions = {},
): Promise<UserPresenceState> => {
  const debug = options.debugLog || false;
  const now = Date.now();

  if (now - presenceCache.timestamp < PRESENCE_CACHE_TTL_MS) {
    return {
      supported: presenceCache.supported,
      isLocked: presenceCache.isLocked,
      isScreenAsleep: presenceCache.isScreenAsleep,
      isAway: presenceCache.isAway,
      idleSeconds: presenceCache.idleSeconds,
      displaySleepThresholdSeconds: presenceCache.displaySleepThresholdSeconds,
      reason: presenceCache.reason,
    };
  }

  const platform = getPlatform();
  if (platform !== 'darwin') {
    const unsupportedState: UserPresenceState = {
      supported: false,
      isLocked: false,
      isScreenAsleep: false,
      isAway: false,
      idleSeconds: null,
      displaySleepThresholdSeconds: null,
      reason: `User presence check not implemented on ${platform}`,
    };
    presenceCache = {
      ...unsupportedState,
      timestamp: now,
    };
    return unsupportedState;
  }

  const isLocked = await getMacOSConsoleLocked(debug, options.shellRunner);
  const displayAsleepByApi = await getMacOSDisplayAsleep(debug, options.shellRunner);
  const idleSeconds = await getMacOSIdleSeconds(debug, options.shellRunner);
  const displaySleepThresholdSeconds =
    (await getMacOSDisplaySleepThresholdSeconds(debug, options.shellRunner)) ||
    options.idleThresholdSeconds ||
    null;

  const isScreenAsleep =
    displayAsleepByApi === true ||
    (displayAsleepByApi === null &&
      idleSeconds !== null &&
      displaySleepThresholdSeconds !== null &&
      idleSeconds >= displaySleepThresholdSeconds);
  const locked = isLocked === true;
  const supported = isLocked !== null || displayAsleepByApi !== null || idleSeconds !== null;
  const state: UserPresenceState = {
    supported,
    isLocked: locked,
    isScreenAsleep,
    isAway: locked || isScreenAsleep,
    idleSeconds,
    displaySleepThresholdSeconds,
    reason: supported ? undefined : 'Could not read macOS presence signals',
  };

  presenceCache = {
    ...state,
    timestamp: now,
  };

  debugLog(
    `presence: supported=${state.supported} locked=${state.isLocked} screenAsleep=${state.isScreenAsleep} idleSeconds=${String(state.idleSeconds)} thresholdSeconds=${String(state.displaySleepThresholdSeconds)} away=${state.isAway}`,
    debug,
  );

  return state;
};

export const isUserAway = async (options: UserPresenceOptions = {}): Promise<boolean> => {
  const state = await getUserPresenceState(options);
  return state.isAway;
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
 * - Windows: Uses PowerShell to check focused window process name
 * - Linux: Uses X11/Wayland specific focus detection commands
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
      const frontmostApp = await getFrontmostAppMacOS(debug, options.shellRunner);
      const isFocused = isKnownTerminal(frontmostApp, KNOWN_TERMINALS_MACOS, debug);

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

  if (platform === 'win32') {
    try {
      const frontmostProcess = await getFrontmostAppWindows(debug, options.shellRunner);
      const isFocused = isKnownTerminal(frontmostProcess, KNOWN_TERMINALS_WINDOWS, debug, false);

      focusCache = {
        isFocused,
        timestamp: now,
        terminalName: frontmostProcess,
      };

      debugLog(
        `Focus detection complete: ${isFocused} (frontmost process: "${frontmostProcess}")`,
        debug,
      );
      return isFocused;
    } catch (error) {
      debugLog(`Windows focus detection error: ${getErrorMessage(error)}`, debug);
      focusCache = {
        isFocused: false,
        timestamp: now,
        terminalName: null,
      };
      return false;
    }
  }

  if (platform === 'linux') {
    try {
      const frontmostApp = await getFrontmostAppLinux(debug, options.shellRunner);
      const isFocused = isKnownTerminal(frontmostApp, KNOWN_TERMINALS_LINUX, debug);

      focusCache = {
        isFocused,
        timestamp: now,
        terminalName: frontmostApp,
      };

      debugLog(`Focus detection complete: ${isFocused} (frontmost app: "${frontmostApp}")`, debug);
      return isFocused;
    } catch (error) {
      debugLog(`Linux focus detection error: ${getErrorMessage(error)}`, debug);
      focusCache = {
        isFocused: false,
        timestamp: now,
        terminalName: null,
      };
      return false;
    }
  }

  // Other platforms: Not supported
  debugLog(`Focus detection not supported on platform: ${platform}`, debug);

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

  frontmostContextCache = {
    appName: null,
    bundleId: null,
    windowTitle: null,
    browserUrl: null,
    rawOutput: null,
    timestamp: 0,
  };
};

/**
 * Clear user presence detection cache.
 */
export const clearPresenceCache = (): void => {
  presenceCache = {
    supported: false,
    isLocked: false,
    isScreenAsleep: false,
    isAway: false,
    idleSeconds: null,
    displaySleepThresholdSeconds: null,
    reason: 'No presence check has run yet',
    timestamp: 0,
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

/**
 * Get cached user presence state.
 */
export const getPresenceCacheState = (): UserPresenceState => ({
  supported: presenceCache.supported,
  isLocked: presenceCache.isLocked,
  isScreenAsleep: presenceCache.isScreenAsleep,
  isAway: presenceCache.isAway,
  idleSeconds: presenceCache.idleSeconds,
  displaySleepThresholdSeconds: presenceCache.displaySleepThresholdSeconds,
  reason: presenceCache.reason,
});

// Default export for convenience
export default {
  isTerminalFocused,
  isOpenCodeClientFocused,
  isUserAway,
  getUserPresenceState,
  isFocusDetectionSupported,
  getTerminalName,
  getPlatform,
  clearFocusCache,
  clearPresenceCache,
  resetTerminalDetection,
  getCacheState,
  getPresenceCacheState,
  KNOWN_TERMINALS_MACOS,
  KNOWN_TERMINALS_WINDOWS,
  KNOWN_TERMINALS_LINUX,
  KNOWN_OPENCODE_DESKTOP_APPS,
  KNOWN_OPENCODE_DESKTOP_BUNDLE_IDS,
  KNOWN_BROWSER_APPS,
  KNOWN_BROWSER_BUNDLE_IDS,
  OPENCODE_BROWSER_TITLE_KEYWORDS,
  OPENCODE_BROWSER_URL_KEYWORDS,
};
