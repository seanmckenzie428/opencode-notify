// @ts-nocheck
import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import os from 'os';

import {
  clearFocusCache,
  clearPresenceCache,
  getCacheState,
  getPresenceCacheState,
  getUserPresenceState,
  isFocusDetectionSupported,
  isOpenCodeClientFocused,
  isTerminalFocused,
  KNOWN_OPENCODE_DESKTOP_APPS,
  OPENCODE_BROWSER_TITLE_KEYWORDS,
  OPENCODE_BROWSER_URL_KEYWORDS,
} from '../../src/util/focus-detect.js';
import { createMockShellRunner, createTestTempDir, cleanupTestTempDir } from '../setup.js';

describe('focus-detect (macOS-only)', () => {
  let platformSpy;

  beforeEach(() => {
    createTestTempDir();
    platformSpy = spyOn(os, 'platform').mockReturnValue('darwin');
    clearFocusCache();
    clearPresenceCache();
  });

  afterEach(() => {
    clearFocusCache();
    clearPresenceCache();
    if (platformSpy) {
      platformSpy.mockRestore();
    }
    cleanupTestTempDir();
  });

  test('reports focus detection support on darwin', () => {
    expect(isFocusDetectionSupported()).toEqual({ supported: true });
  });

  test('identifies terminal focus via frontmost app', async () => {
    const shell = createMockShellRunner({
      handler: () => ({ stdout: Buffer.from('Terminal|||com.apple.Terminal|||zsh|||\n') }),
    });

    const focused = await isTerminalFocused({ shellRunner: shell });
    expect(focused).toBe(true);

    const cache = getCacheState();
    expect(cache.isFocused).toBe(true);
    expect(cache.terminalName).toBe('Terminal');
  });

  test('detects OpenCode desktop app focus', async () => {
    const shell = createMockShellRunner({
      handler: () => ({ stdout: Buffer.from('OpenCode|||ai.opencode.desktop|||Session|||\n') }),
    });

    expect(await isOpenCodeClientFocused({ shellRunner: shell })).toBe(true);
  });

  test('detects OpenCode browser focus by URL keyword', async () => {
    const shell = createMockShellRunner({
      handler: () => ({ stdout: Buffer.from('Google Chrome|||com.google.Chrome|||Dashboard|||https://opencode.local:4096\n') }),
    });

    expect(await isOpenCodeClientFocused({ shellRunner: shell })).toBe(true);
  });

  test('returns false for unrelated browser tab', async () => {
    const shell = createMockShellRunner({
      handler: () => ({ stdout: Buffer.from('Google Chrome|||com.google.Chrome|||Inbox|||https://mail.google.com\n') }),
    });

    expect(await isOpenCodeClientFocused({ shellRunner: shell })).toBe(false);
  });

  test('reports away when lock state is yes', async () => {
    const shell = createMockShellRunner({
      handler: (command) => {
        if (command.includes('IOPMrootDomain')) {
          return { stdout: Buffer.from('"IOConsoleLocked" = Yes\n') };
        }
        if (command.includes('swift -e')) {
          return { stdout: Buffer.from('0\n') };
        }
        if (command.includes('IOHIDSystem')) {
          return { stdout: Buffer.from('"HIDIdleTime" = 1000000000\n') };
        }
        if (command.includes('pmset -g')) {
          return { stdout: Buffer.from(' displaysleep 10\n') };
        }
        return { stdout: Buffer.from('') };
      },
    });

    const state = await getUserPresenceState({ shellRunner: shell });
    expect(state.isLocked).toBe(true);
    expect(state.isAway).toBe(true);

    const cached = getPresenceCacheState();
    expect(cached.isAway).toBe(true);
  });

  test('exports browser matching constants', () => {
    expect(KNOWN_OPENCODE_DESKTOP_APPS).toContain('OpenCode');
    expect(OPENCODE_BROWSER_TITLE_KEYWORDS).toContain('opencode');
    expect(OPENCODE_BROWSER_URL_KEYWORDS).toContain('localhost:4096');
  });

  test('returns unsupported state on non-darwin platforms', async () => {
    platformSpy.mockRestore();
    platformSpy = spyOn(os, 'platform').mockReturnValue('freebsd');

    expect(isFocusDetectionSupported().supported).toBe(false);

    const state = await getUserPresenceState();
    expect(state.supported).toBe(false);
    expect(state.isAway).toBe(false);
  });
});
