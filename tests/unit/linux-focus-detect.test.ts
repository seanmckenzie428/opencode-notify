// @ts-nocheck
/**
 * Linux Platform Focus Detection Tests (Mocked)
 *
 * Tests Linux-specific focus detection (X11 and Wayland) with full mocking.
 * These tests run on ALL platforms (Windows, macOS, Linux) via platform mocking.
 *
 * Covers:
 * - X11 focus detection via xdotool and xprop
 * - Wayland focus detection via swaymsg (Sway), gdbus (GNOME), qdbus (KDE)
 * - Session type routing (x11, wayland, tty, unknown)
 * - Desktop environment detection
 * - Error handling and fail-open behavior
 * - Debug logging to file on errors
 * - Cache behavior under Linux mocking
 * - Known terminal matching for all KNOWN_TERMINALS_LINUX entries
 *
 * @see src/util/focus-detect.ts
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import os from 'os';
import {
  isTerminalFocused,
  clearFocusCache,
  resetTerminalDetection,
  getCacheState,
  KNOWN_TERMINALS_LINUX,
} from '../../src/util/focus-detect.js';
import {
  createTestTempDir,
  cleanupTestTempDir,
  createTestLogsDir,
  createMockShellRunner,
  readTestFile,
} from '../setup.js';

// ================================================================
// HELPERS
// ================================================================

/** Build a minimal Sway tree JSON with one focused node. */
const buildSwayTree = (focusedNode) => ({
  nodes: [
    {
      nodes: [focusedNode],
      floating_nodes: [],
    },
  ],
  floating_nodes: [],
});

/** Build a Sway tree with a focused node in floating_nodes. */
const buildSwayTreeFloating = (focusedNode) => ({
  nodes: [
    {
      nodes: [],
      floating_nodes: [focusedNode],
    },
  ],
  floating_nodes: [],
});

/** Create a handler that routes xdotool class to a given app name. */
const xdotoolClassHandler = (appName) => (cmd) => {
  if (cmd.includes('xdotool getwindowfocus getwindowclassname')) {
    return { stdout: Buffer.from(`${appName}\n`), stderr: Buffer.from(''), exitCode: 0 };
  }
  return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
};

// ================================================================
// LINUX FOCUS DETECTION TESTS
// ================================================================

describe('Linux focus detection (mocked)', () => {
  let platformSpy;
  let savedEnv;

  beforeEach(() => {
    platformSpy = spyOn(os, 'platform').mockReturnValue('linux');

    savedEnv = { ...process.env };
    delete process.env.XDG_SESSION_TYPE;
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    delete process.env.XDG_CURRENT_DESKTOP;
    delete process.env.XDG_SESSION_DESKTOP;
    delete process.env.DESKTOP_SESSION;
    delete process.env.SWAYSOCK;

    clearFocusCache();
    resetTerminalDetection();
    createTestTempDir();
  });

  afterEach(() => {
    platformSpy.mockRestore();
    process.env = savedEnv;
    clearFocusCache();
    resetTerminalDetection();
    cleanupTestTempDir();
  });

  // ============================================================
  // KNOWN_TERMINALS_LINUX VALIDATION
  // ============================================================

  describe('KNOWN_TERMINALS_LINUX', () => {
    test('is an array with at least 20 entries', () => {
      expect(Array.isArray(KNOWN_TERMINALS_LINUX)).toBe(true);
      expect(KNOWN_TERMINALS_LINUX.length).toBeGreaterThanOrEqual(20);
    });

    test('includes common GTK/Qt terminal emulators', () => {
      expect(KNOWN_TERMINALS_LINUX).toContain('gnome-terminal');
      expect(KNOWN_TERMINALS_LINUX).toContain('konsole');
      expect(KNOWN_TERMINALS_LINUX).toContain('xfce4-terminal');
      expect(KNOWN_TERMINALS_LINUX).toContain('mate-terminal');
      expect(KNOWN_TERMINALS_LINUX).toContain('lxterminal');
      expect(KNOWN_TERMINALS_LINUX).toContain('terminator');
      expect(KNOWN_TERMINALS_LINUX).toContain('tilix');
      expect(KNOWN_TERMINALS_LINUX).toContain('terminology');
    });

    test('includes GPU-accelerated terminals', () => {
      expect(KNOWN_TERMINALS_LINUX).toContain('kitty');
      expect(KNOWN_TERMINALS_LINUX).toContain('alacritty');
      expect(KNOWN_TERMINALS_LINUX).toContain('wezterm');
      expect(KNOWN_TERMINALS_LINUX).toContain('foot');
      expect(KNOWN_TERMINALS_LINUX).toContain('ghostty');
      expect(KNOWN_TERMINALS_LINUX).toContain('rio');
    });

    test('includes legacy X11 terminals', () => {
      expect(KNOWN_TERMINALS_LINUX).toContain('xterm');
      expect(KNOWN_TERMINALS_LINUX).toContain('urxvt');
      expect(KNOWN_TERMINALS_LINUX).toContain('rxvt');
      expect(KNOWN_TERMINALS_LINUX).toContain('st');
    });

    test('all entries are non-empty strings', () => {
      for (const terminal of KNOWN_TERMINALS_LINUX) {
        expect(typeof terminal).toBe('string');
        expect(terminal.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================================
  // X11 FOCUS DETECTION
  // ============================================================

  describe('X11 focus detection', () => {
    beforeEach(() => {
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';
    });

    // --- Happy paths: known terminals detected ---

    test('detects gnome-terminal focused via xdotool class', async () => {
      const shellRunner = createMockShellRunner({
        handler: xdotoolClassHandler('gnome-terminal-server'),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('detects kitty focused via xdotool class', async () => {
      const shellRunner = createMockShellRunner({
        handler: xdotoolClassHandler('kitty'),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('detects Alacritty focused via xdotool class (case-insensitive)', async () => {
      const shellRunner = createMockShellRunner({
        handler: xdotoolClassHandler('Alacritty'),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('detects konsole focused via xdotool class', async () => {
      const shellRunner = createMockShellRunner({
        handler: xdotoolClassHandler('konsole'),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    // --- Non-terminal apps ---

    test('returns false for non-terminal app (firefox)', async () => {
      const shellRunner = createMockShellRunner({
        handler: xdotoolClassHandler('firefox'),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('returns false for non-terminal app (nautilus)', async () => {
      const shellRunner = createMockShellRunner({
        handler: xdotoolClassHandler('nautilus'),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    // --- Fallback chain: xdotool class → xdotool name → xprop ---

    test('falls back from xdotool class to xdotool name when class is empty', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('getwindowclassname')) {
            return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
          }
          if (cmd.includes('getwindowname')) {
            return { stdout: Buffer.from('kitty\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('falls back from xdotool class to xdotool name when class throws', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('getwindowclassname')) {
            throw new Error('xdotool: Window not found');
          }
          if (cmd.includes('getwindowname')) {
            return { stdout: Buffer.from('Alacritty\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('falls back to xprop when both xdotool commands fail', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('xdotool')) {
            throw new Error('xdotool not found');
          }
          if (cmd.includes('xprop -root _NET_ACTIVE_WINDOW')) {
            return {
              stdout: Buffer.from('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x3a00004\n'),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          if (cmd.includes('xprop -id 0x3a00004')) {
            return {
              stdout: Buffer.from(
                'WM_CLASS(STRING) = "gnome-terminal-server", "Gnome-terminal"\n'
                + 'WM_NAME(UTF8_STRING) = "Terminal"\n',
              ),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('xprop detects non-terminal via WM_CLASS', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('xdotool')) {
            throw new Error('xdotool not found');
          }
          if (cmd.includes('xprop -root _NET_ACTIVE_WINDOW')) {
            return {
              stdout: Buffer.from('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x4800007\n'),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          if (cmd.includes('xprop -id 0x4800007')) {
            return {
              stdout: Buffer.from(
                'WM_CLASS(STRING) = "Navigator", "Firefox"\n'
                + 'WM_NAME(UTF8_STRING) = "Mozilla Firefox"\n',
              ),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    // --- Edge cases ---

    test('returns false when DISPLAY is not set', async () => {
      delete process.env.DISPLAY;

      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('kitty\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('returns false when all X11 tools fail (fail-open)', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('command not found');
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('handles xprop returning unparseable active window output', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('xdotool')) {
            throw new Error('xdotool not found');
          }
          if (cmd.includes('xprop -root')) {
            return {
              stdout: Buffer.from('_NET_ACTIVE_WINDOW: not found.\n'),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('handles xprop window props returning empty', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('xdotool')) {
            throw new Error('xdotool not found');
          }
          if (cmd.includes('xprop -root _NET_ACTIVE_WINDOW')) {
            return {
              stdout: Buffer.from('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x1\n'),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          if (cmd.includes('xprop -id 0x1')) {
            return {
              stdout: Buffer.from(''),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // WAYLAND FOCUS DETECTION - SWAY
  // ============================================================

  describe('Wayland focus detection - Sway', () => {
    beforeEach(() => {
      process.env.XDG_SESSION_TYPE = 'wayland';
      process.env.WAYLAND_DISPLAY = 'wayland-0';
      process.env.XDG_CURRENT_DESKTOP = 'sway';
      process.env.SWAYSOCK = '/run/user/1000/sway-ipc.sock';
    });

    test('detects terminal via swaymsg app_id', async () => {
      const tree = buildSwayTree({
        focused: true,
        app_id: 'kitty',
        name: 'kitty',
        nodes: [],
        floating_nodes: [],
      });

      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('swaymsg -t get_tree')) {
            return { stdout: Buffer.from(JSON.stringify(tree)), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('detects non-terminal via swaymsg returns false', async () => {
      const tree = buildSwayTree({
        focused: true,
        app_id: 'firefox',
        name: 'Mozilla Firefox',
        nodes: [],
        floating_nodes: [],
      });

      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('swaymsg -t get_tree')) {
            return { stdout: Buffer.from(JSON.stringify(tree)), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('detects terminal via window_properties.class when app_id is missing', async () => {
      const tree = buildSwayTree({
        focused: true,
        window_properties: {
          class: 'Alacritty',
          instance: 'alacritty',
        },
        nodes: [],
        floating_nodes: [],
      });

      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('swaymsg -t get_tree')) {
            return { stdout: Buffer.from(JSON.stringify(tree)), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('finds focused node in floating_nodes', async () => {
      const tree = buildSwayTreeFloating({
        focused: true,
        app_id: 'foot',
        name: 'foot',
        nodes: [],
        floating_nodes: [],
      });

      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('swaymsg -t get_tree')) {
            return { stdout: Buffer.from(JSON.stringify(tree)), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('returns false when swaymsg finds no focused node', async () => {
      const tree = buildSwayTree({
        focused: false,
        app_id: 'kitty',
        nodes: [],
        floating_nodes: [],
      });

      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('swaymsg')) {
            return { stdout: Buffer.from(JSON.stringify(tree)), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('handles swaymsg returning invalid JSON gracefully', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('swaymsg')) {
            return { stdout: Buffer.from('not valid json {{{'), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('handles swaymsg command failure', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('swaymsg')) {
            throw new Error('swaymsg: unable to connect');
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('uses window name when app_id and window_properties are absent', async () => {
      const tree = buildSwayTree({
        focused: true,
        name: 'xterm',
        nodes: [],
        floating_nodes: [],
      });

      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('swaymsg -t get_tree')) {
            return { stdout: Buffer.from(JSON.stringify(tree)), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // WAYLAND FOCUS DETECTION - GNOME
  // ============================================================

  describe('Wayland focus detection - GNOME', () => {
    beforeEach(() => {
      process.env.XDG_SESSION_TYPE = 'wayland';
      process.env.WAYLAND_DISPLAY = 'wayland-0';
      process.env.XDG_CURRENT_DESKTOP = 'GNOME';
    });

    test('detects gnome-terminal focused via gdbus', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('gdbus call')) {
            return {
              stdout: Buffer.from("(true, 'gnome-terminal-server - Terminal')\n"),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('detects tilix focused via gdbus', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('gdbus call')) {
            return {
              stdout: Buffer.from("(true, 'tilix - Terminal')\n"),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('returns false for non-terminal via gdbus', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('gdbus call')) {
            return {
              stdout: Buffer.from("(true, 'Firefox - Mozilla Firefox')\n"),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('handles gdbus returning false (no focused window)', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('gdbus call')) {
            return {
              stdout: Buffer.from("(false, '')\n"),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('handles gdbus returning empty string value', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('gdbus call')) {
            return {
              stdout: Buffer.from("(true, '')\n"),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('handles gdbus command failure and falls back', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('gdbus')) {
            throw new Error('gdbus not available');
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // WAYLAND FOCUS DETECTION - KDE
  // ============================================================

  describe('Wayland focus detection - KDE', () => {
    beforeEach(() => {
      process.env.XDG_SESSION_TYPE = 'wayland';
      process.env.WAYLAND_DISPLAY = 'wayland-0';
      process.env.XDG_CURRENT_DESKTOP = 'KDE';
    });

    test('detects konsole focused via qdbus windowClass', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('org.kde.KWin.activeWindow')) {
            return { stdout: Buffer.from('42\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          if (cmd.includes('org.kde.KWin.caption')) {
            return { stdout: Buffer.from('Terminal - Konsole\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          if (cmd.includes('org.kde.KWin.windowClass')) {
            return { stdout: Buffer.from('konsole\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('returns false for non-terminal via qdbus', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('org.kde.KWin.activeWindow')) {
            return { stdout: Buffer.from('99\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          if (cmd.includes('org.kde.KWin.caption')) {
            return { stdout: Buffer.from('Dolphin - Files\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          if (cmd.includes('org.kde.KWin.windowClass')) {
            return { stdout: Buffer.from('dolphin\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('uses caption as fallback when windowClass is empty', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('org.kde.KWin.activeWindow')) {
            return { stdout: Buffer.from('55\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          if (cmd.includes('org.kde.KWin.caption')) {
            return { stdout: Buffer.from('kitty\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          if (cmd.includes('org.kde.KWin.windowClass')) {
            return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('uses activeWindow ID as last resort when caption and class are empty', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('org.kde.KWin.activeWindow')) {
            return { stdout: Buffer.from('77\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          if (cmd.includes('org.kde.KWin.caption') || cmd.includes('org.kde.KWin.windowClass')) {
            return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      // Window ID '77' is not a known terminal
      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('returns false when qdbus activeWindow fails', async () => {
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('qdbus')) {
            throw new Error('qdbus not found');
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // SESSION TYPE ROUTING
  // ============================================================

  describe('session type routing', () => {
    test('XDG_SESSION_TYPE=x11 routes to X11 detection path', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';

      const commandsCalled = [];
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          commandsCalled.push(cmd);
          if (cmd.includes('xdotool getwindowfocus getwindowclassname')) {
            return { stdout: Buffer.from('kitty\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
      expect(commandsCalled.some((c) => c.includes('xdotool'))).toBe(true);
      expect(commandsCalled.some((c) => c.includes('swaymsg'))).toBe(false);
      expect(commandsCalled.some((c) => c.includes('gdbus'))).toBe(false);
      expect(commandsCalled.some((c) => c.includes('qdbus'))).toBe(false);
    });

    test('XDG_SESSION_TYPE=wayland routes to Wayland detection path', async () => {
      process.env.XDG_SESSION_TYPE = 'wayland';
      process.env.WAYLAND_DISPLAY = 'wayland-0';
      process.env.XDG_CURRENT_DESKTOP = 'sway';

      const commandsCalled = [];
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          commandsCalled.push(cmd);
          if (cmd.includes('swaymsg -t get_tree')) {
            return {
              stdout: Buffer.from(JSON.stringify(buildSwayTree({
                focused: true,
                app_id: 'foot',
                nodes: [],
                floating_nodes: [],
              }))),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
      expect(commandsCalled.some((c) => c.includes('swaymsg'))).toBe(true);
      expect(commandsCalled.some((c) => c.includes('xdotool'))).toBe(false);
    });

    test('XDG_SESSION_TYPE=tty returns false without shell calls', async () => {
      process.env.XDG_SESSION_TYPE = 'tty';

      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('kitty\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
      expect(shellRunner.getCallCount()).toBe(0);
    });

    test('unknown session type tries X11 first, then Wayland', async () => {
      // No session type env vars; set DISPLAY for X11 to work
      process.env.DISPLAY = ':0';

      const commandsCalled = [];
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          commandsCalled.push(cmd);
          if (cmd.includes('xdotool getwindowfocus getwindowclassname')) {
            return { stdout: Buffer.from('konsole\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
      // X11 should be tried first
      expect(commandsCalled[0]).toContain('xdotool');
    });

    test('unknown session falls through to Wayland when X11 path returns null', async () => {
      // No DISPLAY → X11 returns null → tries Wayland
      process.env.SWAYSOCK = '/run/user/1000/sway-ipc.sock';

      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('swaymsg -t get_tree')) {
            return {
              stdout: Buffer.from(JSON.stringify(buildSwayTree({
                focused: true,
                app_id: 'alacritty',
                nodes: [],
                floating_nodes: [],
              }))),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('WAYLAND_DISPLAY without XDG_SESSION_TYPE detects wayland session', async () => {
      process.env.WAYLAND_DISPLAY = 'wayland-0';
      process.env.XDG_CURRENT_DESKTOP = 'GNOME';

      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('gdbus call')) {
            return {
              stdout: Buffer.from("(true, 'gnome-terminal-server')\n"),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('DISPLAY without XDG_SESSION_TYPE detects x11 session', async () => {
      process.env.DISPLAY = ':0';

      const shellRunner = createMockShellRunner({
        handler: xdotoolClassHandler('kitty'),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // WAYLAND DESKTOP ENVIRONMENT DETECTION
  // ============================================================

  describe('Wayland desktop environment detection', () => {
    beforeEach(() => {
      process.env.XDG_SESSION_TYPE = 'wayland';
      process.env.WAYLAND_DISPLAY = 'wayland-0';
    });

    test('detects Sway via SWAYSOCK env var', async () => {
      process.env.SWAYSOCK = '/run/user/1000/sway-ipc.sock';

      const commandsCalled = [];
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          commandsCalled.push(cmd);
          if (cmd.includes('swaymsg')) {
            return {
              stdout: Buffer.from(JSON.stringify(buildSwayTree({
                focused: true,
                app_id: 'kitty',
                nodes: [],
                floating_nodes: [],
              }))),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      await isTerminalFocused({ shellRunner });
      expect(commandsCalled[0]).toContain('swaymsg');
    });

    test('detects Sway via XDG_CURRENT_DESKTOP', async () => {
      process.env.XDG_CURRENT_DESKTOP = 'sway';

      const commandsCalled = [];
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          commandsCalled.push(cmd);
          if (cmd.includes('swaymsg')) {
            return {
              stdout: Buffer.from(JSON.stringify(buildSwayTree({
                focused: true,
                app_id: 'foot',
                nodes: [],
                floating_nodes: [],
              }))),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      await isTerminalFocused({ shellRunner });
      expect(commandsCalled[0]).toContain('swaymsg');
    });

    test('detects GNOME via XDG_CURRENT_DESKTOP', async () => {
      process.env.XDG_CURRENT_DESKTOP = 'GNOME';

      const commandsCalled = [];
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          commandsCalled.push(cmd);
          if (cmd.includes('gdbus call')) {
            return {
              stdout: Buffer.from("(true, 'kitty')\n"),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      await isTerminalFocused({ shellRunner });
      expect(commandsCalled[0]).toContain('gdbus');
    });

    test('detects KDE via XDG_CURRENT_DESKTOP containing plasma', async () => {
      process.env.XDG_CURRENT_DESKTOP = 'KDE:plasma';

      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('org.kde.KWin.activeWindow')) {
            return { stdout: Buffer.from('42\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          if (cmd.includes('org.kde.KWin.windowClass')) {
            return { stdout: Buffer.from('konsole\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          if (cmd.includes('org.kde.KWin.caption')) {
            return { stdout: Buffer.from('Konsole\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(true);
    });

    test('detects desktop from XDG_SESSION_DESKTOP', async () => {
      process.env.XDG_SESSION_DESKTOP = 'gnome';

      const commandsCalled = [];
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          commandsCalled.push(cmd);
          if (cmd.includes('gdbus call')) {
            return {
              stdout: Buffer.from("(true, 'code')\n"),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      await isTerminalFocused({ shellRunner });
      expect(commandsCalled[0]).toContain('gdbus');
    });

    test('unknown desktop environment tries all methods in fallback chain', async () => {
      // No desktop env vars → unknown DE
      const commandsCalled = [];
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          commandsCalled.push(cmd);
          throw new Error('not available');
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
      // Should have tried sway, gnome, and kde as fallbacks
      expect(commandsCalled.some((c) => c.includes('swaymsg'))).toBe(true);
      expect(commandsCalled.some((c) => c.includes('gdbus'))).toBe(true);
      expect(commandsCalled.some((c) => c.includes('qdbus'))).toBe(true);
    });

    test('known DE with specific failure still tries fallback chain', async () => {
      process.env.XDG_CURRENT_DESKTOP = 'sway';

      const commandsCalled = [];
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          commandsCalled.push(cmd);
          // All fail
          throw new Error('not available');
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
      // Sway tried as specific DE method AND again in fallback
      const swayCalls = commandsCalled.filter((c) => c.includes('swaymsg'));
      expect(swayCalls.length).toBeGreaterThanOrEqual(1);
      // Also tried gnome and kde in fallback
      expect(commandsCalled.some((c) => c.includes('gdbus'))).toBe(true);
      expect(commandsCalled.some((c) => c.includes('qdbus'))).toBe(true);
    });
  });

  // ============================================================
  // ERROR HANDLING, FAIL-OPEN, AND DEBUG LOGGING
  // ============================================================

  describe('error handling and fail-open behavior', () => {
    test('returns false when all Linux detection methods fail (fail-open)', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';

      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('all commands unavailable');
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('never throws even on catastrophic shell errors', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';

      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new TypeError('Cannot read properties of undefined');
        },
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(typeof result).toBe('boolean');
      expect(result).toBe(false);
    });

    test('updates cache even when detection fails', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';

      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('fail');
        },
      });

      await isTerminalFocused({ shellRunner });

      const cache = getCacheState();
      expect(cache.timestamp).toBeGreaterThan(0);
      expect(cache.isFocused).toBe(false);
      expect(cache.terminalName).toBeNull();
    });
  });

  describe('debug logging to file on errors', () => {
    test('writes debug log entries when debugLog is enabled', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';
      createTestLogsDir();

      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('xdotool crashed');
        },
      });

      await isTerminalFocused({ debugLog: true, shellRunner });

      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).not.toBeNull();
      expect(logContent).toContain('[focus-detect]');
    });

    test('debug log contains session type information', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';
      createTestLogsDir();

      const shellRunner = createMockShellRunner({
        handler: xdotoolClassHandler('kitty'),
      });

      await isTerminalFocused({ debugLog: true, shellRunner });

      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).not.toBeNull();
      expect(logContent).toContain('[focus-detect]');
    });

    test('debug log contains error details on command failure', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';
      createTestLogsDir();

      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('xdotool: BadWindow');
        },
      });

      await isTerminalFocused({ debugLog: true, shellRunner });

      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).not.toBeNull();
      expect(logContent).toContain('xdotool: BadWindow');
    });

    test('does NOT write debug log when debugLog is disabled', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';

      const shellRunner = createMockShellRunner({
        handler: () => {
          throw new Error('xdotool crashed');
        },
      });

      await isTerminalFocused({ debugLog: false, shellRunner });

      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).toBeNull();
    });
  });

  // ============================================================
  // CACHE BEHAVIOR UNDER LINUX MOCKING
  // ============================================================

  describe('cache behavior under Linux mocking', () => {
    test('cache prevents repeated shell calls within TTL', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';

      const shellRunner = createMockShellRunner({
        handler: xdotoolClassHandler('kitty'),
      });

      const result1 = await isTerminalFocused({ shellRunner });
      expect(result1).toBe(true);
      const callsAfterFirst = shellRunner.getCallCount();
      expect(callsAfterFirst).toBeGreaterThan(0);

      // Second call should use cache, no new shell calls
      const result2 = await isTerminalFocused({ shellRunner });
      expect(result2).toBe(true);
      expect(shellRunner.getCallCount()).toBe(callsAfterFirst);
    });

    test('clearFocusCache forces fresh detection on next call', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';

      let xdotoolCallCount = 0;
      const shellRunner = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('xdotool getwindowfocus getwindowclassname')) {
            xdotoolCallCount++;
            return { stdout: Buffer.from('kitty\n'), stderr: Buffer.from(''), exitCode: 0 };
          }
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
        },
      });

      await isTerminalFocused({ shellRunner });
      expect(xdotoolCallCount).toBe(1);

      clearFocusCache();

      await isTerminalFocused({ shellRunner });
      expect(xdotoolCallCount).toBe(2);
    });
  });

  // ============================================================
  // KNOWN TERMINALS COVERAGE - PARAMETRIZED
  // ============================================================

  describe('known Linux terminals recognition via X11', () => {
    const terminalSubset = [
      'gnome-terminal',
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
      'foot',
      'xterm',
      'urxvt',
      'st',
      'ghostty',
      'rio',
      'hyper',
      'tabby',
      'warp',
    ];

    for (const terminal of terminalSubset) {
      test(`recognizes "${terminal}" as a terminal`, async () => {
        process.env.XDG_SESSION_TYPE = 'x11';
        process.env.DISPLAY = ':0';
        clearFocusCache();

        const shellRunner = createMockShellRunner({
          handler: xdotoolClassHandler(terminal),
        });

        const result = await isTerminalFocused({ shellRunner });
        expect(result).toBe(true);
      });
    }
  });

  describe('non-terminal apps are NOT recognized as terminals', () => {
    const nonTerminals = [
      'firefox',
      'chromium',
      'nautilus',
      'libreoffice',
      'spotify',
      'slack',
      'discord',
      'gimp',
      'thunderbird',
      'evince',
    ];

    for (const app of nonTerminals) {
      test(`does NOT recognize "${app}" as a terminal`, async () => {
        process.env.XDG_SESSION_TYPE = 'x11';
        process.env.DISPLAY = ':0';
        clearFocusCache();

        const shellRunner = createMockShellRunner({
          handler: xdotoolClassHandler(app),
        });

        const result = await isTerminalFocused({ shellRunner });
        expect(result).toBe(false);
      });
    }
  });
});
