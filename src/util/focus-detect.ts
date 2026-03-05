import fs from 'fs';
import os from 'os';
import path from 'path';

import type { ShellRunner } from '../types/opencode-sdk.js';

interface FocusDetectionSupport {
  supported: boolean;
  reason?: string;
}

interface FocusCacheState {
  isFocused: boolean;
  timestamp: number;
  terminalName: string | null;
}

interface FrontmostContext {
  appName: string | null;
  bundleId: string | null;
  windowTitle: string | null;
  browserUrl: string | null;
  rawOutput: string | null;
}

interface TerminalFocusOptions {
  debugLog?: boolean;
  shellRunner?: ShellRunner;
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

const CACHE_TTL_MS = 500;
const PRESENCE_CACHE_TTL_MS = 2000;

let cachedTerminalName: string | null = null;
let terminalDetectionAttempted = false;

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

export const KNOWN_TERMINALS_MACOS = [
  'Terminal',
  'iTerm2',
  'iTerm',
  'Warp',
  'Kitty',
  'Alacritty',
  'Hyper',
  'Ghostty',
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

const getErrorMessage = (error: unknown): string => {
  const maybeError = error as { message?: unknown };
  return String(maybeError?.message ?? error);
};

const toOutputString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8');
  }

  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
};

export const getPlatform = (): NodeJS.Platform => os.platform();

const debugLog = (message: string, enabled = false): void => {
  if (!enabled) {
    return;
  }

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
    // Ignore logging failures.
  }
};

const executeCommand = async (
  command: string,
  options: { timeout?: number; maxBuffer?: number } = {},
  shellRunner?: ShellRunner,
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const timeout = options.timeout ?? 2000;

  if (shellRunner) {
    const result = await shellRunner`${command}`.nothrow().quiet();
    return {
      stdout: toOutputString(result.stdout),
      stderr: toOutputString(result.stderr),
      exitCode: Number(result.exitCode ?? 0),
    };
  }

  const proc = Bun.spawn(['/bin/sh', '-lc', command], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timer = setTimeout(() => {
    proc.kill();
  }, timeout);

  const [stdoutBuffer, stderrBuffer, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return {
    stdout: Buffer.from(stdoutBuffer).toString('utf8'),
    stderr: Buffer.from(stderrBuffer).toString('utf8'),
    exitCode: Number(exitCode),
  };
};

export const isFocusDetectionSupported = (): FocusDetectionSupport => {
  if (getPlatform() !== 'darwin') {
    return {
      supported: false,
      reason: `Focus detection is macOS-only (current: ${getPlatform()})`,
    };
  }

  return { supported: true };
};

export const getTerminalName = async (): Promise<string | null> => {
  if (terminalDetectionAttempted) {
    return cachedTerminalName;
  }

  terminalDetectionAttempted = true;

  try {
    const result = await executeCommand(
      'osascript -e \'tell application "System Events" to get name of first application process whose frontmost is true\'',
      { timeout: 1200 },
    );
    cachedTerminalName = result.stdout.trim() || null;
  } catch {
    cachedTerminalName = null;
  }

  return cachedTerminalName;
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

  const [rawAppName = '', rawBundleId = '', rawWindowTitle = '', ...urlParts] = trimmedOutput.split('|||');
  return {
    appName: rawAppName.trim() || null,
    bundleId: rawBundleId.trim() || null,
    windowTitle: rawWindowTitle.trim() || null,
    browserUrl: urlParts.join('|||').trim() || null,
    rawOutput: trimmedOutput,
  };
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

  if (getPlatform() !== 'darwin') {
    return {
      appName: null,
      bundleId: null,
      windowTitle: null,
      browserUrl: null,
      rawOutput: null,
    };
  }

  try {
    const { stdout } = await executeCommand(
      `osascript -e '${APPLESCRIPT_GET_FRONTMOST_CONTEXT}'`,
      { timeout: 2000, maxBuffer: 4096 },
      options.shellRunner,
    );

    const context = parseFrontmostContextOutput(stdout);
    frontmostContextCache = {
      ...context,
      timestamp: now,
    };
    debugLog(
      `frontmost app="${context.appName || ''}" bundle="${context.bundleId || ''}" title="${context.windowTitle || ''}" url="${context.browserUrl || ''}"`,
      debug,
    );
    return context;
  } catch (error) {
    debugLog(`failed to get frontmost context: ${getErrorMessage(error)}`, debug);
    return {
      appName: null,
      bundleId: null,
      windowTitle: null,
      browserUrl: null,
      rawOutput: null,
    };
  }
};

export const isOpenCodeClientFocused = async (
  options: OpenCodeClientFocusOptions = {},
): Promise<boolean> => {
  const debug = options.debugLog || false;
  if (getPlatform() !== 'darwin') {
    return false;
  }

  const context = await getFrontmostContext(options);
  const appName = context.appName;
  const bundleId = context.bundleId;

  if (!appName && !bundleId) {
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
    return true;
  }

  const browserAppNames = options.browserAppNames || KNOWN_BROWSER_APPS;
  const browserBundleIds = options.browserBundleIds || KNOWN_BROWSER_BUNDLE_IDS;
  const isBrowserFocused = matchesKnownApp(appName, browserAppNames) || (bundleId ? hasKeyword(bundleId, browserBundleIds) : false);
  if (!isBrowserFocused) {
    debugLog(`focused app is not browser/openCode (app=${appName || ''})`, debug);
    return false;
  }

  const browserTitleKeywords = options.browserTitleKeywords || OPENCODE_BROWSER_TITLE_KEYWORDS;
  const browserUrlKeywords = options.browserUrlKeywords || OPENCODE_BROWSER_URL_KEYWORDS;
  const titleSource = [context.windowTitle, context.rawOutput].filter(Boolean).join(' ');
  return hasKeyword(titleSource, browserTitleKeywords) || hasKeyword(context.browserUrl, browserUrlKeywords);
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
    const { stdout } = await executeCommand('ioreg -l -n IOPMrootDomain -d1', { timeout: 2000 }, shellRunner);
    const match = stdout.match(/"IOConsoleLocked"\s*=\s*(Yes|No|true|false|1|0)/i);
    if (!match || !match[1]) {
      return null;
    }
    const locked = parseYesNoBoolean(match[1]);
    debugLog(`lock state: ${match[1]} -> ${String(locked)}`, debug);
    return locked;
  } catch (error) {
    debugLog(`lock detection failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const getMacOSDisplayAsleep = async (debug = false, shellRunner?: ShellRunner): Promise<boolean | null> => {
  try {
    const { stdout } = await executeCommand(
      'swift -e \'import CoreGraphics; print(CGDisplayIsAsleep(CGMainDisplayID()) != 0 ? "1" : "0")\'',
      { timeout: 3000 },
      shellRunner,
    );
    const asleep = parseYesNoBoolean(stdout.trim());
    debugLog(`display asleep: ${stdout.trim()} -> ${String(asleep)}`, debug);
    return asleep;
  } catch (error) {
    debugLog(`display sleep detection failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const getMacOSIdleSeconds = async (debug = false, shellRunner?: ShellRunner): Promise<number | null> => {
  try {
    const { stdout } = await executeCommand('ioreg -c IOHIDSystem', { timeout: 2000 }, shellRunner);
    const match = stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/);
    if (!match || !match[1]) {
      return null;
    }

    const idleNanos = Number(match[1]);
    if (!Number.isFinite(idleNanos)) {
      return null;
    }

    const idleSeconds = Math.floor(idleNanos / 1_000_000_000);
    debugLog(`idle seconds: ${idleSeconds}`, debug);
    return idleSeconds;
  } catch (error) {
    debugLog(`idle detection failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const getMacOSDisplaySleepThresholdSeconds = async (
  debug = false,
  shellRunner?: ShellRunner,
): Promise<number | null> => {
  try {
    const { stdout } = await executeCommand('pmset -g', { timeout: 2000 }, shellRunner);
    const match = stdout.match(/\bdisplaysleep\s+(\d+(?:\.\d+)?)/i);
    if (!match || !match[1]) {
      return null;
    }

    const sleepMinutes = Number(match[1]);
    if (!Number.isFinite(sleepMinutes) || sleepMinutes <= 0) {
      return null;
    }

    const thresholdSeconds = Math.floor(sleepMinutes * 60);
    debugLog(`display sleep threshold: ${thresholdSeconds}s`, debug);
    return thresholdSeconds;
  } catch (error) {
    debugLog(`display sleep threshold failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

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

  if (getPlatform() !== 'darwin') {
    const state: UserPresenceState = {
      supported: false,
      isLocked: false,
      isScreenAsleep: false,
      isAway: false,
      idleSeconds: null,
      displaySleepThresholdSeconds: null,
      reason: 'User presence detection is macOS-only',
    };
    presenceCache = { ...state, timestamp: now };
    return state;
  }

  const isLocked = await getMacOSConsoleLocked(debug, options.shellRunner);
  const displayAsleep = await getMacOSDisplayAsleep(debug, options.shellRunner);
  const idleSeconds = await getMacOSIdleSeconds(debug, options.shellRunner);
  const displaySleepThresholdSeconds =
    (await getMacOSDisplaySleepThresholdSeconds(debug, options.shellRunner)) || options.idleThresholdSeconds || null;

  const isScreenAsleep =
    displayAsleep === true ||
    (displayAsleep === null &&
      idleSeconds !== null &&
      displaySleepThresholdSeconds !== null &&
      idleSeconds >= displaySleepThresholdSeconds);

  const state: UserPresenceState = {
    supported: isLocked !== null || displayAsleep !== null || idleSeconds !== null,
    isLocked: isLocked === true,
    isScreenAsleep,
    isAway: isLocked === true || isScreenAsleep,
    idleSeconds,
    displaySleepThresholdSeconds,
  };

  presenceCache = {
    ...state,
    timestamp: now,
  };

  return state;
};

export const isUserAway = async (options: UserPresenceOptions = {}): Promise<boolean> => {
  const state = await getUserPresenceState(options);
  return state.isAway;
};

export const isTerminalFocused = async (options: TerminalFocusOptions = {}): Promise<boolean> => {
  const debug = options.debugLog || false;
  const now = Date.now();

  if (now - focusCache.timestamp < CACHE_TTL_MS) {
    return focusCache.isFocused;
  }

  if (getPlatform() !== 'darwin') {
    focusCache = {
      isFocused: false,
      terminalName: null,
      timestamp: now,
    };
    return false;
  }

  const context = await getFrontmostContext(options);
  const terminalName = context.appName;
  const isFocused = matchesKnownApp(terminalName, KNOWN_TERMINALS_MACOS);

  focusCache = {
    isFocused,
    terminalName,
    timestamp: now,
  };

  debugLog(`terminal focused=${isFocused} app=${terminalName || ''}`, debug);
  return isFocused;
};

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

export const resetTerminalDetection = (): void => {
  cachedTerminalName = null;
  terminalDetectionAttempted = false;
};

export const getCacheState = (): FocusCacheState => ({ ...focusCache });

export const getPresenceCacheState = (): UserPresenceState => ({
  supported: presenceCache.supported,
  isLocked: presenceCache.isLocked,
  isScreenAsleep: presenceCache.isScreenAsleep,
  isAway: presenceCache.isAway,
  idleSeconds: presenceCache.idleSeconds,
  displaySleepThresholdSeconds: presenceCache.displaySleepThresholdSeconds,
  reason: presenceCache.reason,
});

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
  KNOWN_OPENCODE_DESKTOP_APPS,
  KNOWN_OPENCODE_DESKTOP_BUNDLE_IDS,
  KNOWN_BROWSER_APPS,
  KNOWN_BROWSER_BUNDLE_IDS,
  OPENCODE_BROWSER_TITLE_KEYWORDS,
  OPENCODE_BROWSER_URL_KEYWORDS,
};
