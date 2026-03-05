// @ts-nocheck
import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import os from 'os';

import {
  checkNotificationSupport,
  notifyError,
  notifyPermissionRequest,
  notifyQuestion,
  notifyTaskComplete,
  sendDesktopNotification,
} from '../../src/util/desktop-notify.js';
import { createTestTempDir, cleanupTestTempDir } from '../setup.js';

describe('desktop-notify (macOS-only)', () => {
  let platformSpy;

  beforeEach(() => {
    createTestTempDir();
    platformSpy = spyOn(os, 'platform').mockReturnValue('darwin');
  });

  afterEach(() => {
    if (platformSpy) {
      platformSpy.mockRestore();
    }
    cleanupTestTempDir();
  });

  test('supports notifications on darwin', () => {
    expect(checkNotificationSupport()).toEqual({ supported: true });
  });

  test('returns unsupported on non-darwin', () => {
    platformSpy.mockRestore();
    platformSpy = spyOn(os, 'platform').mockReturnValue('freebsd');

    const support = checkNotificationSupport();
    expect(support.supported).toBe(false);
    expect(support.reason).toContain('macOS-only');
  });

  test('sends generic desktop notification', async () => {
    const result = await sendDesktopNotification('Title', 'Body', { subtitle: 'Sub', timeout: 3 });
    expect(result).toHaveProperty('success');
  });

  test('sends helper notifications', async () => {
    const idle = await notifyTaskComplete('Done', { projectName: 'Demo' });
    const permission = await notifyPermissionRequest('Approve', { count: 2 });
    const question = await notifyQuestion('Need input', { count: 1 });
    const error = await notifyError('Something failed');

    expect(idle).toHaveProperty('success');
    expect(permission).toHaveProperty('success');
    expect(question).toHaveProperty('success');
    expect(error).toHaveProperty('success');
  });
});
