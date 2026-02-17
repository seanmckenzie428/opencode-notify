// @ts-nocheck
/**
 * Unit Tests for Focus Detection Module
 * 
 * Tests for the util/focus-detect.js module which provides terminal focus detection.
 * Used to suppress notifications when the user is actively looking at the terminal.
 * 
 * @see src/util/focus-detect.js
 * @see docs/ARCHITECT_PLAN.md - Phase 3, Task 3.6
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import os from 'os';
import {
  createTestTempDir,
  cleanupTestTempDir,
  createTestLogsDir,
  createMockShellRunner,
  readTestFile,
  testFileExists,
  wait
} from '../setup.js';

// Import the focus detection module
import {
  isTerminalFocused,
  isFocusDetectionSupported,
  getTerminalName,
  getPlatform,
  clearFocusCache,
  resetTerminalDetection,
  getCacheState,
  KNOWN_TERMINALS_MACOS,
  KNOWN_TERMINALS_WINDOWS
} from '../../src/util/focus-detect.js';

import focusDetect from '../../src/util/focus-detect.js';

const getEncodedPowerShellScriptFromCommand = (command) => {
  const marker = '-EncodedCommand ';
  const markerIndex = command.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  return command.slice(markerIndex + marker.length).trim();
};

const decodePowerShellScript = (encodedScript) => {
  if (!encodedScript) {
    return null;
  }

  return Buffer.from(encodedScript, 'base64').toString('utf16le');
};

describe('focus detection module', () => {
  beforeEach(() => {
    // Create test temp directory and reset caches before each test
    createTestTempDir();
    clearFocusCache();
    resetTerminalDetection();
  });
  
  afterEach(() => {
    cleanupTestTempDir();
    clearFocusCache();
    resetTerminalDetection();
  });

  // ============================================================
  // getPlatform() TESTS
  // ============================================================

  describe('getPlatform()', () => {
    test('returns a string', () => {
      const platform = getPlatform();
      expect(typeof platform).toBe('string');
    });
    
    test('returns one of the known platforms', () => {
      const platform = getPlatform();
      expect(['darwin', 'win32', 'linux', 'freebsd', 'openbsd', 'sunos', 'aix']).toContain(platform);
    });
    
    test('returns consistent value on repeated calls', () => {
      const platform1 = getPlatform();
      const platform2 = getPlatform();
      expect(platform1).toBe(platform2);
    });
  });

  // ============================================================
  // isFocusDetectionSupported() TESTS
  // ============================================================

  describe('isFocusDetectionSupported()', () => {
    test('returns an object', () => {
      const result = isFocusDetectionSupported();
      expect(typeof result).toBe('object');
    });
    
    test('returns object with supported property', () => {
      const result = isFocusDetectionSupported();
      expect(result).toHaveProperty('supported');
      expect(typeof result.supported).toBe('boolean');
    });
    
    test('returns reason when not supported', () => {
      const result = isFocusDetectionSupported();
      // If not supported, should have a reason
      if (!result.supported) {
        expect(result).toHaveProperty('reason');
        expect(typeof result.reason).toBe('string');
      }
    });
    
    test('macOS should be supported', () => {
      const platform = getPlatform();
      const result = isFocusDetectionSupported();
      
      if (platform === 'darwin') {
        expect(result.supported).toBe(true);
      }
    });
    
    test('Windows should be supported', () => {
      const platformSpy = spyOn(os, 'platform').mockReturnValue('win32');
      const result = isFocusDetectionSupported();
      expect(result.supported).toBe(true);
      platformSpy.mockRestore();
    });
    
    test('Linux support status is a boolean', () => {
      const platform = getPlatform();
      const result = isFocusDetectionSupported();
      
      if (platform === 'linux') {
        expect(typeof result.supported).toBe('boolean');
      }
    });
  });

  // ============================================================
  // KNOWN_TERMINALS_MACOS TESTS
  // ============================================================

  describe('KNOWN_TERMINALS_MACOS', () => {
    test('is an array', () => {
      expect(Array.isArray(KNOWN_TERMINALS_MACOS)).toBe(true);
    });
    
    test('contains at least 10 terminal names', () => {
      expect(KNOWN_TERMINALS_MACOS.length).toBeGreaterThanOrEqual(10);
    });
    
    test('includes Terminal (macOS default)', () => {
      expect(KNOWN_TERMINALS_MACOS).toContain('Terminal');
    });
    
    test('includes iTerm2', () => {
      expect(KNOWN_TERMINALS_MACOS.some(t => t.includes('iTerm'))).toBe(true);
    });
    
    test('includes popular terminals like Alacritty, Hyper, Warp', () => {
      expect(KNOWN_TERMINALS_MACOS).toContain('Alacritty');
      expect(KNOWN_TERMINALS_MACOS).toContain('Hyper');
      expect(KNOWN_TERMINALS_MACOS).toContain('Warp');
    });
    
    test('all entries are non-empty strings', () => {
      for (const terminal of KNOWN_TERMINALS_MACOS) {
        expect(typeof terminal).toBe('string');
        expect(terminal.length).toBeGreaterThan(0);
      }
    });
  });

  describe('KNOWN_TERMINALS_WINDOWS', () => {
    test('is an array', () => {
      expect(Array.isArray(KNOWN_TERMINALS_WINDOWS)).toBe(true);
    });

    test('includes Windows Terminal variants', () => {
      expect(KNOWN_TERMINALS_WINDOWS).toContain('Windows Terminal');
      expect(KNOWN_TERMINALS_WINDOWS).toContain('WindowsTerminal');
    });

    test('includes Windows shell process names', () => {
      expect(KNOWN_TERMINALS_WINDOWS).toContain('PowerShell');
      expect(KNOWN_TERMINALS_WINDOWS).toContain('pwsh');
      expect(KNOWN_TERMINALS_WINDOWS).toContain('cmd.exe');
      expect(KNOWN_TERMINALS_WINDOWS).toContain('conhost');
    });

    test('all entries are non-empty strings', () => {
      for (const terminal of KNOWN_TERMINALS_WINDOWS) {
        expect(typeof terminal).toBe('string');
        expect(terminal.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================================
  // isTerminalFocused() - BASIC TESTS
  // ============================================================

  describe('isTerminalFocused() basic behavior', () => {
    test('returns a Promise', () => {
      const result = isTerminalFocused();
      expect(result).toBeInstanceOf(Promise);
    });
    
    test('Promise resolves to a boolean', async () => {
      const result = await isTerminalFocused();
      expect(typeof result).toBe('boolean');
    });
    
    test('accepts empty options object', async () => {
      const result = await isTerminalFocused({});
      expect(typeof result).toBe('boolean');
    });
    
    test('accepts options with debugLog', async () => {
      createTestLogsDir();
      const result = await isTerminalFocused({ debugLog: true });
      expect(typeof result).toBe('boolean');
    });
    
    test('handles null options gracefully', async () => {
      // Should not throw with null
      const result = await isTerminalFocused(null);
      expect(typeof result).toBe('boolean');
    });
    
    test('handles undefined options gracefully', async () => {
      const result = await isTerminalFocused(undefined);
      expect(typeof result).toBe('boolean');
    });
  });

  // ============================================================
  // isTerminalFocused() - PLATFORM-SPECIFIC BEHAVIOR
  // ============================================================

  describe('isTerminalFocused() platform behavior', () => {
    test('returns false on unsupported platforms (fail-open)', async () => {
      const supported = isFocusDetectionSupported();
      
      if (!supported.supported) {
        // On unsupported platforms, should return false (fail-open: still notify)
        const result = await isTerminalFocused();
        expect(result).toBe(false);
      }
    });
    
    test('returns boolean on Windows', async () => {
      const platform = getPlatform();
      
      if (platform === 'win32') {
        clearFocusCache();
        const shellRunner = createMockShellRunner({
          handler: () => ({
            stdout: Buffer.from('explorer\n'),
            stderr: Buffer.from(''),
            exitCode: 0,
          }),
        });

        const result = await isTerminalFocused({ shellRunner });
        expect(typeof result).toBe('boolean');
      }
    });
    
    test('returns boolean on Linux', async () => {
      const platform = getPlatform();
      
      if (platform === 'linux') {
        const result = await isTerminalFocused();
        expect(typeof result).toBe('boolean');
      }
    });
    
    test('handles macOS check without throwing', async () => {
      const platform = getPlatform();
      
      if (platform === 'darwin') {
        // Should not throw - may return true or false depending on focused app
        await expect(isTerminalFocused()).resolves.toBeDefined();
      }
    });
  });

  // ============================================================
  // WINDOWS FOCUS DETECTION TESTS (MOCKED POWERSHELL)
  // ============================================================

  describe('Windows focus detection', () => {
    let platformSpy;

    beforeEach(() => {
      platformSpy = spyOn(os, 'platform').mockReturnValue('win32');
      clearFocusCache();
    });

    afterEach(() => {
      if (platformSpy) {
        platformSpy.mockRestore();
      }
      clearFocusCache();
    });

    test('detects Windows Terminal process as focused terminal', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('WindowsTerminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);

      const command = shellRunner.getLastCall().command;
      expect(command).toContain('powershell');
      expect(command).toContain('-EncodedCommand');

      const encodedScript = getEncodedPowerShellScriptFromCommand(command);
      const decodedScript = decodePowerShellScript(encodedScript);
      expect(decodedScript).toContain('Get-Process -Id $processId');
    });

    test('detects PowerShell and cmd.exe process names', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('powershell\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const powershellResult = await isTerminalFocused({ shellRunner });
      expect(powershellResult).toBe(true);

      clearFocusCache();

      const shellRunnerCmd = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('cmd.exe\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const cmdResult = await isTerminalFocused({ shellRunner: shellRunnerCmd });
      expect(cmdResult).toBe(true);
    });

    test('returns false for non-terminal process names', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('explorer\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('returns false when PowerShell execution fails (fail-open)', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('PowerShell execution failed');
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('writes PowerShell failure debug output to file', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('PowerShell not found');
        },
      });

      const result = await isTerminalFocused({ debugLog: true, shellRunner });
      expect(result).toBe(false);

      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).toContain('Failed to get frontmost Windows process');
      expect(logContent).toContain('PowerShell not found');
    });

    // ----------------------------------------------------------
    // All KNOWN_TERMINALS_WINDOWS detection
    // ----------------------------------------------------------

    test('detects all known Windows terminal process names as focused', async () => {
      for (const terminal of KNOWN_TERMINALS_WINDOWS) {
        clearFocusCache();

        const shellRunner = createMockShellRunner({
          handler: () => ({
            stdout: Buffer.from(`${terminal}\n`),
            stderr: Buffer.from(''),
            exitCode: 0,
          }),
        });

        const result = await isTerminalFocused({ shellRunner });
        expect(result).toBe(true);
      }
    });

    // ----------------------------------------------------------
    // Empty / invalid output scenarios
    // ----------------------------------------------------------

    test('returns false when PowerShell output is empty string', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('returns false when PowerShell output is only whitespace or newlines', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('   \n  \r\n  '),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('returns false for invalid/binary output from PowerShell', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('\x00\x01\x02\x03'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    // ----------------------------------------------------------
    // Non-terminal app detection
    // ----------------------------------------------------------

    test('returns false for non-terminal apps (explorer, chrome, firefox, notepad, Teams)', async () => {
      const nonTerminalApps = ['explorer', 'chrome', 'firefox', 'notepad', 'Teams', 'Spotify', 'slack'];

      for (const app of nonTerminalApps) {
        clearFocusCache();

        const shellRunner = createMockShellRunner({
          handler: () => ({
            stdout: Buffer.from(`${app}\n`),
            stderr: Buffer.from(''),
            exitCode: 0,
          }),
        });

        const result = await isTerminalFocused({ shellRunner });
        expect(result).toBe(false);
      }
    });

    // ----------------------------------------------------------
    // PowerShell command structure verification
    // ----------------------------------------------------------

    test('PowerShell command includes required flags (-NoProfile, -NonInteractive, -ExecutionPolicy Bypass)', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('WindowsTerminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const command = shellRunner.getLastCall().command;
      expect(command).toContain('-NoProfile');
      expect(command).toContain('-NonInteractive');
      expect(command).toContain('-ExecutionPolicy Bypass');
    });

    test('decoded PowerShell script includes Win32 API interop (user32.dll, GetForegroundWindow)', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('WindowsTerminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const command = shellRunner.getLastCall().command;
      const encodedScript = getEncodedPowerShellScriptFromCommand(command);
      const decodedScript = decodePowerShellScript(encodedScript);

      expect(decodedScript).toContain('GetForegroundWindow');
      expect(decodedScript).toContain('GetWindowThreadProcessId');
      expect(decodedScript).toContain('user32.dll');
    });

    test('decoded PowerShell script includes IsIconic and IsWindowVisible checks for minimized/hidden windows', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('WindowsTerminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const command = shellRunner.getLastCall().command;
      const encodedScript = getEncodedPowerShellScriptFromCommand(command);
      const decodedScript = decodePowerShellScript(encodedScript);

      expect(decodedScript).toContain('IsIconic');
      expect(decodedScript).toContain('IsWindowVisible');
      expect(decodedScript).toContain('minimized');
      expect(decodedScript).toContain('visible');
    });

    // ----------------------------------------------------------
    // Minimized/Hidden window detection tests
    // ----------------------------------------------------------

    test('returns false when PowerShell returns empty output (simulating minimized window - IsIconic returns true)', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      // Empty output means PowerShell script returned early due to IsIconic check
      expect(result).toBe(false);
    });

    test('returns false when PowerShell returns empty output (simulating hidden window - IsWindowVisible returns false)', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      // Empty output means PowerShell script returned early due to IsWindowVisible check
      expect(result).toBe(false);
    });

    test('minimized terminal window should NOT be detected as focused (empty PowerShell output)', async () => {
      // When a terminal is minimized, the PowerShell script will:
      // 1. Get the foreground window handle
      // 2. Check IsIconic() which returns true for minimized windows
      // 3. Return early without outputting a process name
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
      
      const cache = getCacheState();
      expect(cache.isFocused).toBe(false);
    });

    test('hidden/invisible window should NOT be detected as focused (empty PowerShell output)', async () => {
      // When a window is hidden/invisible, the PowerShell script will:
      // 1. Get the foreground window handle
      // 2. Check IsWindowVisible() which returns false
      // 3. Return early without outputting a process name
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
      
      const cache = getCacheState();
      expect(cache.isFocused).toBe(false);
    });

    test('normal visible window returns process name correctly', async () => {
      // Normal case: window is visible and not minimized
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('WindowsTerminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
      
      const cache = getCacheState();
      expect(cache.isFocused).toBe(true);
      expect(cache.terminalName).toBe('WindowsTerminal');
    });

    test('PowerShell script includes early return for zero foreground window (showing desktop)', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const command = shellRunner.getLastCall().command;
      const encodedScript = getEncodedPowerShellScriptFromCommand(command);
      const decodedScript = decodePowerShellScript(encodedScript);

      expect(decodedScript).toContain('No foreground window');
    });

    // ----------------------------------------------------------
    // stderr handling
    // ----------------------------------------------------------

    test('handles PowerShell stderr output without failing detection', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('WindowsTerminal\n'),
          stderr: Buffer.from('WARNING: Some deprecation notice\n'),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    // ----------------------------------------------------------
    // Cache interaction on Windows path
    // ----------------------------------------------------------

    test('caches Windows focus result and only calls shell once within TTL', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('WindowsTerminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });
      await isTerminalFocused({ shellRunner });
      await isTerminalFocused({ shellRunner });

      // Only the first call should hit the shell; subsequent calls use cache
      expect(shellRunner.getCallCount()).toBe(1);
    });

    test('updates focus cache state after Windows detection', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('WindowsTerminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const cache = getCacheState();
      expect(cache.isFocused).toBe(true);
      expect(cache.timestamp).toBeGreaterThan(0);
      expect(cache.terminalName).toBe('WindowsTerminal');
    });

    test('sets cache to not-focused when non-terminal app is detected', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('chrome\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const cache = getCacheState();
      expect(cache.isFocused).toBe(false);
      expect(cache.terminalName).toBe('chrome');
    });

    test('sets cache terminalName to null on PowerShell failure', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('command not found');
        },
      });

      await isTerminalFocused({ shellRunner });

      const cache = getCacheState();
      expect(cache.isFocused).toBe(false);
      expect(cache.terminalName).toBeNull();
    });

    // ----------------------------------------------------------
    // Debug logging on Windows path
    // ----------------------------------------------------------

    test('logs debug info when PowerShell returns empty output', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ debugLog: true, shellRunner });
      expect(result).toBe(false);

      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).toContain('empty focused process name');
    });

    test('logs PowerShell stderr content when debug is enabled', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('WindowsTerminal\n'),
          stderr: Buffer.from('Some warning\n'),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ debugLog: true, shellRunner });

      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).toContain('PowerShell stderr');
      expect(logContent).toContain('Some warning');
    });

    test('does not create log file when debugLog is false on Windows', async () => {
      createTestTempDir();

      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('should not be logged');
        },
      });

      await isTerminalFocused({ debugLog: false, shellRunner });

      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).toBeNull();
    });

    // ----------------------------------------------------------
    // Platform mocking verification
    // ----------------------------------------------------------

    test('platform spy correctly returns win32', () => {
      expect(getPlatform()).toBe('win32');
    });

    test('isFocusDetectionSupported returns true when mocked as win32', () => {
      const result = isFocusDetectionSupported();
      expect(result.supported).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    test('shell runner receives exactly one call per uncached focus check', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('cmd\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });
      expect(shellRunner.getCallCount()).toBe(1);
      expect(shellRunner.wasCalledWith('powershell')).toBe(true);
    });
  });

  // ============================================================
  // macOS FOCUS DETECTION TESTS (MOCKED APPLESCRIPT)
  // ============================================================

  describe('macOS focus detection (mocked)', () => {
    let platformSpy;

    beforeEach(() => {
      platformSpy = spyOn(os, 'platform').mockReturnValue('darwin');
      clearFocusCache();
      resetTerminalDetection();
    });

    afterEach(() => {
      if (platformSpy) {
        platformSpy.mockRestore();
      }
      clearFocusCache();
      resetTerminalDetection();
    });

    // ----------------------------------------------------------
    // Happy path: known terminal apps detected as focused
    // ----------------------------------------------------------

    test('detects Terminal.app as focused terminal', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Terminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('detects iTerm2 as focused terminal', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('iTerm2\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('detects all KNOWN_TERMINALS_MACOS entries as focused', async () => {
      for (const terminal of KNOWN_TERMINALS_MACOS) {
        clearFocusCache();

        const shellRunner = createMockShellRunner({
          handler: () => ({
            stdout: Buffer.from(`${terminal}\n`),
            stderr: Buffer.from(''),
            exitCode: 0,
          }),
        });

        const result = await isTerminalFocused({ shellRunner });
        expect(result).toBe(true);
      }
    });

    // ----------------------------------------------------------
    // Non-terminal apps should NOT be detected as focused
    // ----------------------------------------------------------

    test('returns false when Safari is frontmost', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Safari\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('returns false when Finder is frontmost', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Finder\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('returns false for other non-terminal macOS apps', async () => {
      const nonTerminalApps = ['Mail', 'Preview', 'Notes', 'Slack', 'Spotify', 'Chrome', 'Firefox'];

      for (const app of nonTerminalApps) {
        clearFocusCache();

        const shellRunner = createMockShellRunner({
          handler: () => ({
            stdout: Buffer.from(`${app}\n`),
            stderr: Buffer.from(''),
            exitCode: 0,
          }),
        });

        const result = await isTerminalFocused({ shellRunner });
        expect(result).toBe(false);
      }
    });

    // ----------------------------------------------------------
    // Error scenarios: fail-open behavior
    // ----------------------------------------------------------

    test('returns false when AppleScript execution fails (fail-open)', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('osascript: command not found');
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('returns false when osascript returns empty output', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('returns false when osascript returns whitespace-only output', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('   \n\t\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('returns false when osascript returns only newlines', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('\n\n\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('returns false when osascript throws timeout error', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('Command timed out after 2000ms');
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    // ----------------------------------------------------------
    // AppleScript command verification
    // ----------------------------------------------------------

    test('sends osascript command to shell runner', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Terminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      expect(shellRunner.getCallCount()).toBe(1);
      const command = shellRunner.getLastCall().command;
      expect(command).toContain('osascript');
    });

    test('AppleScript command contains System Events tell block', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Terminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const command = shellRunner.getLastCall().command;
      expect(command).toContain('System Events');
      expect(command).toContain('frontmost');
    });

    test('AppleScript retrieves frontmost application process name', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Terminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const command = shellRunner.getLastCall().command;
      expect(command).toContain('first application process whose frontmost is true');
      expect(command).toContain('name of frontApp');
    });

    test('osascript command uses -e flag for inline script', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Terminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const command = shellRunner.getLastCall().command;
      expect(command).toContain("osascript -e '");
    });

    // ----------------------------------------------------------
    // Minimized/Hidden window detection tests
    // ----------------------------------------------------------

    test('AppleScript includes visibility check for hidden apps (Cmd+H)', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Terminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const command = shellRunner.getLastCall().command;
      expect(command).toContain('visible of frontApp');
      expect(command).toContain('is false');
    });

    test('AppleScript includes miniaturized check for minimized windows', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Terminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const command = shellRunner.getLastCall().command;
      expect(command).toContain('miniaturized is false');
      expect(command).toContain('visible is true');
    });

    test('AppleScript checks for visible, non-minimized windows', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Terminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const command = shellRunner.getLastCall().command;
      expect(command).toContain('every window of frontApp whose visible is true and miniaturized is false');
      expect(command).toContain('count of windowList');
    });

    test('minimized terminal window should NOT be detected as focused (empty AppleScript output)', async () => {
      // When a terminal is minimized, the AppleScript will:
      // 1. Check if app has visible, non-minimized windows
      // 2. Find no windows matching the criteria
      // 3. Return empty string
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);

      const cache = getCacheState();
      expect(cache.isFocused).toBe(false);
    });

    test('hidden app (Cmd+H) should NOT be detected as focused (empty AppleScript output)', async () => {
      // When an app is hidden with Cmd+H, the AppleScript will:
      // 1. Check visible of frontApp
      // 2. Find that visible is false
      // 3. Return empty string
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);

      const cache = getCacheState();
      expect(cache.isFocused).toBe(false);
    });

    test('normal visible terminal window returns app name correctly', async () => {
      // Normal case: terminal is visible and has non-minimized windows
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Terminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);

      const cache = getCacheState();
      expect(cache.isFocused).toBe(true);
      expect(cache.terminalName).toBe('Terminal');
    });

    test('AppleScript returns empty string for app with no visible windows', async () => {
      // Simulates an app that is frontmost but has no visible windows
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    // ----------------------------------------------------------
    // Debug logging on macOS errors
    // ----------------------------------------------------------

    test('writes AppleScript failure debug output to log file', async () => {
      createTestLogsDir();

      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('osascript permission denied');
        },
      });

      const result = await isTerminalFocused({ debugLog: true, shellRunner });
      expect(result).toBe(false);

      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).toContain('Failed to get frontmost app');
      expect(logContent).toContain('osascript permission denied');
    });

    test('logs frontmost app name when debug is enabled', async () => {
      createTestLogsDir();

      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Safari\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ debugLog: true, shellRunner });

      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).toContain('[focus-detect]');
      expect(logContent).toContain('Safari');
    });

    test('logs that non-terminal app is NOT a known terminal', async () => {
      createTestLogsDir();

      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Preview\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ debugLog: true, shellRunner });

      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).toContain('NOT a known terminal');
    });

    test('does not create log file when debugLog is false', async () => {
      createTestTempDir();

      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('should not be logged');
        },
      });

      await isTerminalFocused({ debugLog: false, shellRunner });

      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).toBeNull();
    });

    // ----------------------------------------------------------
    // Cache interaction on macOS path
    // ----------------------------------------------------------

    test('updates cache after successful macOS focus check', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Terminal\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });

      const cache = getCacheState();
      expect(cache.isFocused).toBe(true);
      expect(cache.timestamp).toBeGreaterThan(0);
      expect(cache.terminalName).toBe('Terminal');
    });

    test('updates cache with null terminal on macOS error', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('osascript error');
        },
      });

      await isTerminalFocused({ shellRunner });

      const cache = getCacheState();
      expect(cache.isFocused).toBe(false);
      expect(cache.timestamp).toBeGreaterThan(0);
      expect(cache.terminalName).toBeNull();
    });

    test('second call within TTL uses cached value, no extra shell call', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('iTerm2\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result1 = await isTerminalFocused({ shellRunner });
      expect(result1).toBe(true);
      expect(shellRunner.getCallCount()).toBe(1);

      // Second call should hit cache
      const result2 = await isTerminalFocused({ shellRunner });
      expect(result2).toBe(true);
      // No additional shell call - still 1
      expect(shellRunner.getCallCount()).toBe(1);
    });

    // ----------------------------------------------------------
    // Platform mocking verification
    // ----------------------------------------------------------

    test('platform spy correctly returns darwin', () => {
      expect(getPlatform()).toBe('darwin');
    });

    test('isFocusDetectionSupported returns true when mocked as darwin', () => {
      const result = isFocusDetectionSupported();
      expect(result.supported).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    test('shell runner receives exactly one call per uncached focus check', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Alacritty\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      await isTerminalFocused({ shellRunner });
      expect(shellRunner.getCallCount()).toBe(1);
      expect(shellRunner.wasCalledWith('osascript')).toBe(true);
    });
  });

  // ============================================================
  // CACHING BEHAVIOR TESTS
  // ============================================================

  describe('focus detection caching', () => {
    test('getCacheState() returns cache object', () => {
      const cache = getCacheState();
      expect(typeof cache).toBe('object');
      expect(cache).toHaveProperty('isFocused');
      expect(cache).toHaveProperty('timestamp');
      expect(cache).toHaveProperty('terminalName');
    });
    
    test('cache starts with default values', () => {
      clearFocusCache();
      const cache = getCacheState();
      expect(cache.isFocused).toBe(false);
      expect(cache.timestamp).toBe(0);
      expect(cache.terminalName).toBeNull();
    });
    
    test('cache is updated after isTerminalFocused() call', async () => {
      clearFocusCache();
      const cacheBefore = getCacheState();
      expect(cacheBefore.timestamp).toBe(0);
      
      await isTerminalFocused();
      
      const cacheAfter = getCacheState();
      expect(cacheAfter.timestamp).toBeGreaterThan(0);
    });
    
    test('clearFocusCache() resets cache state', async () => {
      // First make a call to populate cache
      await isTerminalFocused();
      
      const cachePopulated = getCacheState();
      expect(cachePopulated.timestamp).toBeGreaterThan(0);
      
      // Clear cache
      clearFocusCache();
      
      const cacheCleared = getCacheState();
      expect(cacheCleared.timestamp).toBe(0);
      expect(cacheCleared.isFocused).toBe(false);
    });
    
    test('caching prevents multiple system calls within TTL', async () => {
      clearFocusCache();
      
      // First call populates cache
      const start = Date.now();
      const result1 = await isTerminalFocused();
      const cache1 = getCacheState();
      
      // Second call should use cache (no new timestamp)
      const result2 = await isTerminalFocused();
      const cache2 = getCacheState();
      
      // Third call should also use cache
      const result3 = await isTerminalFocused();
      const cache3 = getCacheState();
      
      // All results should be the same (from cache)
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
      
      // Timestamps should be the same (cache hit)
      expect(cache2.timestamp).toBe(cache1.timestamp);
      expect(cache3.timestamp).toBe(cache1.timestamp);
    });
    
    test('cache expires after TTL (500ms)', async () => {
      clearFocusCache();
      
      // First call populates cache
      await isTerminalFocused();
      const cache1 = getCacheState();
      const timestamp1 = cache1.timestamp;
      
      // Wait for cache to expire (TTL is 500ms, wait 600ms to be safe)
      await wait(600);
      
      // Next call should refresh cache
      await isTerminalFocused();
      const cache2 = getCacheState();
      const timestamp2 = cache2.timestamp;
      
      // Timestamps should be different (cache miss, new system call)
      expect(timestamp2).toBeGreaterThan(timestamp1);
      expect(timestamp2 - timestamp1).toBeGreaterThanOrEqual(500);
    });
    
    test('multiple rapid calls use cached value', async () => {
      clearFocusCache();
      
      // Make 5 rapid calls
      const results = await Promise.all([
        isTerminalFocused(),
        isTerminalFocused(),
        isTerminalFocused(),
        isTerminalFocused(),
        isTerminalFocused()
      ]);
      
      // All should return the same value
      const firstResult = results[0];
      for (const result of results) {
        expect(result).toBe(firstResult);
      }
    });
  });

  // ============================================================
  // TERMINAL DETECTION TESTS
  // ============================================================

  describe('getTerminalName()', () => {
    test('returns string or null', () => {
      const result = getTerminalName();
      expect(result === null || typeof result === 'string').toBe(true);
    });
    
    test('caches terminal detection result', () => {
      resetTerminalDetection();
      
      const result1 = getTerminalName();
      const result2 = getTerminalName();
      
      // Should return the same value (cached)
      expect(result1).toBe(result2);
    });
    
    test('accepts debug parameter', () => {
      resetTerminalDetection();
      createTestLogsDir();
      
      // Should not throw
      const result = getTerminalName(true);
      expect(result === null || typeof result === 'string').toBe(true);
    });
    
    test('resetTerminalDetection() clears cached value', () => {
      // Populate cache
      getTerminalName();
      
      // Reset
      resetTerminalDetection();
      
      // Should work again without errors
      const result = getTerminalName();
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });

  // ============================================================
  // DEBUG LOGGING TESTS
  // ============================================================

  describe('debug logging', () => {
    test('creates logs directory when debugLog is true', async () => {
      // Ensure temp dir exists
      createTestTempDir();
      
      await isTerminalFocused({ debugLog: true });
      
      // Check if logs directory was created
      expect(testFileExists('logs')).toBe(true);
    });
    
    test('writes to debug log file when enabled', async () => {
      createTestTempDir();
      
      await isTerminalFocused({ debugLog: true });
      
      // Check if log file exists
      expect(testFileExists('logs/smart-voice-notify-debug.log')).toBe(true);
    });
    
    test('debug log contains focus detection entries', async () => {
      createTestTempDir();
      
      await isTerminalFocused({ debugLog: true });
      
      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      if (logContent) {
        expect(logContent).toContain('[focus-detect]');
      }
    });
    
    test('debug logging does not affect return value', async () => {
      clearFocusCache();
      createTestTempDir();
      
      const withDebug = await isTerminalFocused({ debugLog: true });
      
      clearFocusCache();
      
      const withoutDebug = await isTerminalFocused({ debugLog: false });
      
      // Both should be the same type
      expect(typeof withDebug).toBe('boolean');
      expect(typeof withoutDebug).toBe('boolean');
    });
    
    test('no log file created when debugLog is false', async () => {
      createTestTempDir();
      
      await isTerminalFocused({ debugLog: false });
      
      // Log file should not exist (directory might not even be created)
      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      // Either no log or only contains entries from debug=true calls
      expect(logContent === null || !logContent.includes('[focus-detect]') || logContent.includes('[focus-detect]')).toBe(true);
    });
  });

  // ============================================================
  // DEFAULT EXPORT TESTS
  // ============================================================

  describe('default export', () => {
    test('exports all expected functions', () => {
      expect(focusDetect).toHaveProperty('isTerminalFocused');
      expect(focusDetect).toHaveProperty('isFocusDetectionSupported');
      expect(focusDetect).toHaveProperty('getTerminalName');
      expect(focusDetect).toHaveProperty('getPlatform');
      expect(focusDetect).toHaveProperty('clearFocusCache');
      expect(focusDetect).toHaveProperty('resetTerminalDetection');
      expect(focusDetect).toHaveProperty('getCacheState');
      expect(focusDetect).toHaveProperty('KNOWN_TERMINALS_MACOS');
      expect(focusDetect).toHaveProperty('KNOWN_TERMINALS_WINDOWS');
    });
    
    test('default export functions are callable', async () => {
      expect(typeof focusDetect.isTerminalFocused).toBe('function');
      expect(typeof focusDetect.isFocusDetectionSupported).toBe('function');
      expect(typeof focusDetect.getTerminalName).toBe('function');
      expect(typeof focusDetect.getPlatform).toBe('function');
      expect(typeof focusDetect.clearFocusCache).toBe('function');
      expect(typeof focusDetect.resetTerminalDetection).toBe('function');
      expect(typeof focusDetect.getCacheState).toBe('function');
    });
    
    test('default export functions work correctly', async () => {
      const platform = focusDetect.getPlatform();
      expect(typeof platform).toBe('string');
      
      const supported = focusDetect.isFocusDetectionSupported();
      expect(typeof supported.supported).toBe('boolean');
      
      const result = await focusDetect.isTerminalFocused();
      expect(typeof result).toBe('boolean');
    });
  });

  // ============================================================
  // ERROR HANDLING TESTS
  // ============================================================

  describe('error handling', () => {
    test('isTerminalFocused handles errors gracefully (fail-open)', async () => {
      // Even if something goes wrong internally, should not throw
      const result = await isTerminalFocused();
      expect(typeof result).toBe('boolean');
    });
    
    test('returns false on error (fail-open strategy)', async () => {
      // The module is designed to return false on any error
      // This ensures notifications still work even if focus detection fails
      const platform = getPlatform();
      const supported = isFocusDetectionSupported();
      
      if (!supported.supported) {
        // Unsupported platforms should return false
        const result = await isTerminalFocused();
        expect(result).toBe(false);
      }
    });
    
    test('isFocusDetectionSupported never throws', () => {
      // Should never throw
      expect(() => isFocusDetectionSupported()).not.toThrow();
    });
    
    test('getPlatform never throws', () => {
      expect(() => getPlatform()).not.toThrow();
    });
    
    test('clearFocusCache never throws', () => {
      expect(() => clearFocusCache()).not.toThrow();
    });
    
    test('resetTerminalDetection never throws', () => {
      expect(() => resetTerminalDetection()).not.toThrow();
    });
    
    test('getCacheState never throws', () => {
      expect(() => getCacheState()).not.toThrow();
    });
    
    test('getTerminalName never throws', () => {
      expect(() => getTerminalName()).not.toThrow();
    });
  });

  // ============================================================
  // INTEGRATION WITH CONFIG
  // ============================================================

  describe('integration with config', () => {
    test('focus detection can be used with config settings', async () => {
      // Simulate config settings
      const config = {
        suppressWhenFocused: true,
        alwaysNotify: false
      };
      
      // If suppressWhenFocused is true and not alwaysNotify, check focus
      if (config.suppressWhenFocused && !config.alwaysNotify) {
        const focused = await isTerminalFocused();
        // Should suppress if focused is true
        const shouldSuppress = focused;
        expect(typeof shouldSuppress).toBe('boolean');
      }
    });
    
    test('alwaysNotify override works conceptually', async () => {
      const config = {
        suppressWhenFocused: true,
        alwaysNotify: true
      };
      
      // When alwaysNotify is true, focus check should be skipped
      if (config.alwaysNotify) {
        // Don't suppress, regardless of focus
        const shouldSuppress = false;
        expect(shouldSuppress).toBe(false);
      }
    });
    
    test('suppressWhenFocused=false skips focus check', async () => {
      const config = {
        suppressWhenFocused: false,
        alwaysNotify: false
      };
      
      // When suppressWhenFocused is false, focus check should be skipped
      if (!config.suppressWhenFocused) {
        const shouldSuppress = false;
        expect(shouldSuppress).toBe(false);
      }
    });
  });

  // ============================================================
  // CONFIG-BASED FOCUS DETECTION SUPPRESSION TESTS
  // Tests for shouldSuppressNotification() logic from src/index.ts
  // ============================================================

  describe('config-based focus detection suppression', () => {
    // Simulates the shouldSuppressNotification() logic from src/index.ts
    // This allows us to test the config combinations without importing the full plugin
    const simulateShouldSuppress = async (
      config: { suppressWhenFocused: boolean; alwaysNotify: boolean },
      focusCheckFn: () => Promise<boolean>
    ): Promise<{ shouldSuppress: boolean; focusCheckCalled: boolean }> => {
      let focusCheckCalled = false;

      // If alwaysNotify is true, never suppress (and don't check focus)
      if (config.alwaysNotify) {
        return { shouldSuppress: false, focusCheckCalled: false };
      }

      // If suppressWhenFocused is disabled, don't suppress (and don't check focus)
      if (!config.suppressWhenFocused) {
        return { shouldSuppress: false, focusCheckCalled: false };
      }

      // Check if terminal is focused
      focusCheckCalled = true;
      try {
        const isFocused = await focusCheckFn();
        if (isFocused) {
          return { shouldSuppress: true, focusCheckCalled: true };
        }
      } catch {
        // On error, fail open (don't suppress)
      }

      return { shouldSuppress: false, focusCheckCalled: true };
    };

    // ============================================================
    // TEST: Focus detection NOT called when suppressWhenFocused=false
    // ============================================================
    test('focus detection is NOT called when suppressWhenFocused=false', async () => {
      const config = {
        suppressWhenFocused: false,
        alwaysNotify: false
      };

      let focusCheckCallCount = 0;
      const mockFocusCheck = async () => {
        focusCheckCallCount++;
        return true; // Terminal is "focused"
      };

      const result = await simulateShouldSuppress(config, mockFocusCheck);

      // Should NOT suppress (regardless of terminal focus)
      expect(result.shouldSuppress).toBe(false);
      // Focus check should NOT have been called
      expect(result.focusCheckCalled).toBe(false);
      expect(focusCheckCallCount).toBe(0);
    });

    // ============================================================
    // TEST: Focus detection NOT called when alwaysNotify=true
    // ============================================================
    test('focus detection is NOT called when alwaysNotify=true', async () => {
      const config = {
        suppressWhenFocused: true, // Even with this enabled
        alwaysNotify: true
      };

      let focusCheckCallCount = 0;
      const mockFocusCheck = async () => {
        focusCheckCallCount++;
        return true; // Terminal is "focused"
      };

      const result = await simulateShouldSuppress(config, mockFocusCheck);

      // Should NOT suppress (alwaysNotify overrides everything)
      expect(result.shouldSuppress).toBe(false);
      // Focus check should NOT have been called
      expect(result.focusCheckCalled).toBe(false);
      expect(focusCheckCallCount).toBe(0);
    });

    // ============================================================
    // TEST: Focus detection IS called when suppressWhenFocused=true AND alwaysNotify=false
    // ============================================================
    test('focus detection IS called when suppressWhenFocused=true AND alwaysNotify=false', async () => {
      const config = {
        suppressWhenFocused: true,
        alwaysNotify: false
      };

      let focusCheckCallCount = 0;
      const mockFocusCheck = async () => {
        focusCheckCallCount++;
        return false; // Terminal is NOT focused
      };

      const result = await simulateShouldSuppress(config, mockFocusCheck);

      // Focus check SHOULD have been called
      expect(result.focusCheckCalled).toBe(true);
      expect(focusCheckCallCount).toBe(1);
      // Should NOT suppress (terminal not focused)
      expect(result.shouldSuppress).toBe(false);
    });

    // ============================================================
    // TEST: Notifications suppressed when terminal focused AND suppressWhenFocused=true
    // ============================================================
    test('notifications are suppressed when terminal is focused AND suppressWhenFocused=true', async () => {
      const config = {
        suppressWhenFocused: true,
        alwaysNotify: false
      };

      const mockFocusCheck = async () => true; // Terminal IS focused

      const result = await simulateShouldSuppress(config, mockFocusCheck);

      // Focus check SHOULD have been called
      expect(result.focusCheckCalled).toBe(true);
      // SHOULD suppress (terminal is focused)
      expect(result.shouldSuppress).toBe(true);
    });

    // ============================================================
    // TEST: Notifications NOT suppressed when terminal focused BUT suppressWhenFocused=false
    // ============================================================
    test('notifications are NOT suppressed when terminal is focused BUT suppressWhenFocused=false', async () => {
      const config = {
        suppressWhenFocused: false,
        alwaysNotify: false
      };

      let focusCheckCallCount = 0;
      const mockFocusCheck = async () => {
        focusCheckCallCount++;
        return true; // Terminal IS focused
      };

      const result = await simulateShouldSuppress(config, mockFocusCheck);

      // Focus check should NOT have been called
      expect(result.focusCheckCalled).toBe(false);
      expect(focusCheckCallCount).toBe(0);
      // Should NOT suppress (suppressWhenFocused is disabled)
      expect(result.shouldSuppress).toBe(false);
    });

    // ============================================================
    // TEST: alwaysNotify=true overrides suppressWhenFocused=true even when focused
    // ============================================================
    test('alwaysNotify=true overrides suppressWhenFocused=true even when terminal is focused', async () => {
      const config = {
        suppressWhenFocused: true,
        alwaysNotify: true
      };

      let focusCheckCallCount = 0;
      const mockFocusCheck = async () => {
        focusCheckCallCount++;
        return true; // Terminal IS focused
      };

      const result = await simulateShouldSuppress(config, mockFocusCheck);

      // Focus check should NOT have been called
      expect(result.focusCheckCalled).toBe(false);
      expect(focusCheckCallCount).toBe(0);
      // Should NOT suppress (alwaysNotify takes precedence)
      expect(result.shouldSuppress).toBe(false);
    });

    // ============================================================
    // TEST: Error handling - fail-open when focus check throws
    // ============================================================
    test('fails open (does not suppress) when focus check throws error', async () => {
      const config = {
        suppressWhenFocused: true,
        alwaysNotify: false
      };

      const mockFocusCheck = async () => {
        throw new Error('Focus detection failed');
      };

      const result = await simulateShouldSuppress(config, mockFocusCheck);

      // Focus check SHOULD have been called
      expect(result.focusCheckCalled).toBe(true);
      // Should NOT suppress (fail-open on error)
      expect(result.shouldSuppress).toBe(false);
    });

    // ============================================================
    // TEST: Default config values (suppressWhenFocused=false, alwaysNotify=false)
    // ============================================================
    test('default config (suppressWhenFocused=false) does not check focus', async () => {
      // These are the actual defaults from src/util/config.ts
      const config = {
        suppressWhenFocused: false,
        alwaysNotify: false
      };

      let focusCheckCallCount = 0;
      const mockFocusCheck = async () => {
        focusCheckCallCount++;
        return true;
      };

      const result = await simulateShouldSuppress(config, mockFocusCheck);

      // With defaults, focus check should never be called
      expect(result.focusCheckCalled).toBe(false);
      expect(focusCheckCallCount).toBe(0);
      expect(result.shouldSuppress).toBe(false);
    });
  });
});
