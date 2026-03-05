import fs from 'fs';
import notifier from 'node-notifier';
import os from 'os';
import path from 'path';

import type { DesktopNotifyOptions, NotificationResult } from '../types/notification.js';

/**
 * Desktop Notification Module for OpenCode Smart Voice Notify
 *
 * Provides macOS native desktop notifications using node-notifier.
 * Uses terminal-notifier via Notification Center.
 *
 * @module util/desktop-notify
 * @see docs/ARCHITECT_PLAN.md - Phase 1, Task 1.2
 */

interface NotificationSupport {
  supported: boolean;
  reason?: string;
}

interface PlatformNotificationOptions {
  title: string;
  message: string;
  sound: boolean;
  wait: boolean;
  timeout?: number;
  subtitle?: string;
  urgency?: 'low' | 'normal' | 'critical';
  icon?: string;
  'app-name'?: string;
}

type NotifyArgs = Parameters<typeof notifier.notify>;
type NotifyCallback = Exclude<NotifyArgs[1], undefined>;

const getErrorMessage = (error: unknown): string => {
  const maybeError = error as { message?: unknown };
  return String(maybeError?.message);
};

/**
 * Debug logging to file.
 * Only logs when config.debugLog is enabled.
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
    fs.appendFileSync(logFile, `[${timestamp}] [desktop-notify] ${message}\n`);
  } catch {
    // Silently fail - logging should never break the plugin
  }
};

/**
 * Get the current platform identifier.
 */
export const getPlatform = (): NodeJS.Platform => os.platform();

/**
 * Check if desktop notifications are likely to work on this platform.
 *
 * @returns Support status and reason if not supported
 */
export const checkNotificationSupport = (): NotificationSupport => {
  if (getPlatform() !== 'darwin') {
    return { supported: false, reason: `Desktop notifications are macOS-only (current: ${getPlatform()})` };
  }

  return { supported: true };
};

/**
 * Build platform-specific notification options.
 * Normalizes options across different platforms while respecting their unique capabilities.
 *
 * @param title - Notification title
 * @param message - Notification body/message
 * @param options - Additional options
 * @returns Platform-normalized notification options
 */
const buildPlatformOptions = (
  title: string,
  message: string,
  options: DesktopNotifyOptions = {},
): PlatformNotificationOptions => {
  const platform = getPlatform();
  const { timeout = 5, sound = false, icon, subtitle, urgency } = options;

  // Base options common to all platforms
  const baseOptions: PlatformNotificationOptions = {
    title: title || 'OpenCode',
    message: message || '',
    sound,
    wait: false, // Don't block - fire and forget
  };

  // Add icon if provided and exists
  if (icon && fs.existsSync(icon)) {
    baseOptions.icon = icon;
  }

  if (platform === 'darwin') {
    return {
      ...baseOptions,
      timeout,
      subtitle: subtitle || undefined,
    };
  }

  return {
    ...baseOptions,
    timeout,
    urgency: urgency || 'normal',
  };
};

/**
 * Send a native desktop notification.
 *
 * This is the main function for sending desktop notifications on macOS.
 * It handles platform-specific options and gracefully fails if notifications
 * are not supported or the notifier encounters an error.
 *
 * @param title - Notification title
 * @param message - Notification body/message
 * @param options - Notification options
 * @returns Result object
 *
 * @example
 * // Simple notification
 * await sendDesktopNotification('Task Complete', 'Your code is ready for review');
 *
 * @example
 * // With options
 * await sendDesktopNotification('Permission Required', 'Agent needs approval', {
 *   timeout: 10,
 *   urgency: 'critical',
 *   sound: true
 * });
 */
export const sendDesktopNotification = async (
  title: string,
  message: string,
  options: DesktopNotifyOptions = {},
): Promise<NotificationResult> => {
  // Handle null/undefined options gracefully
  const opts = options || {};
  const debug = opts.debugLog || false;

  try {
    // Check platform support
    const support = checkNotificationSupport();
    if (!support.supported) {
      debugLog(`Notification not supported: ${support.reason}`, debug);
      return { success: false, error: support.reason };
    }

    // Build platform-specific options
    const notifyOptions = buildPlatformOptions(title, message, opts);

    debugLog(`Sending notification: "${title}" - "${message}" (platform: ${getPlatform()})`, debug);

    // Send notification using promise wrapper.
    // Some environments never invoke the notifier callback; add a safety timeout.
    return await new Promise<NotificationResult>((resolve) => {
      let settled = false;

      const settle = (result: NotificationResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimeout);
        resolve(result);
      };

      const callbackTimeoutMs = Math.min(1200, Math.max(200, (Number(opts.timeout ?? 5) || 5) * 1000 + 250));
      const safetyTimeout = setTimeout(() => {
        debugLog(`Notification callback timeout after ${callbackTimeoutMs}ms`, debug);
        settle({ success: false, error: 'Notification callback timeout' });
      }, callbackTimeoutMs);

      const callback: NotifyCallback = (error, response) => {
        if (error) {
          debugLog(`Notification error: ${error.message}`, debug);
          settle({ success: false, error: error.message });
          return;
        }

        debugLog(`Notification sent successfully (response: ${response})`, debug);
        settle({ success: true });
      };

      try {
        notifier.notify(notifyOptions as NotifyArgs[0], callback);
      } catch (notifyError) {
        settle({ success: false, error: getErrorMessage(notifyError) });
      }
    });
  } catch (error) {
    const messageText = getErrorMessage(error);
    debugLog(`Notification exception: ${messageText}`, debug);
    return { success: false, error: messageText };
  }
};

/**
 * Send a notification for session idle (task completion).
 * Pre-configured for task completion notifications.
 *
 * @param message - Notification message
 * @param options - Additional options
 * @returns Result object
 */
export const notifyTaskComplete = async (
  message: string,
  options: DesktopNotifyOptions = {},
): Promise<NotificationResult> => {
  const title = options.projectName ? `✅ ${options.projectName} - Task Complete` : '✅ OpenCode - Task Complete';

  return sendDesktopNotification(title, message, {
    timeout: 5,
    sound: false, // We handle sound separately in the main plugin
    ...options,
  });
};

/**
 * Send a notification for permission requests.
 * Pre-configured for permission request notifications (more urgent).
 *
 * @param message - Notification message
 * @param options - Additional options
 * @returns Result object
 */
export const notifyPermissionRequest = async (
  message: string,
  options: DesktopNotifyOptions = {},
): Promise<NotificationResult> => {
  const count = options.count || 1;
  const title = options.projectName
    ? `⚠️ ${options.projectName} - Permission Required`
    : count > 1
      ? `⚠️ ${count} Permissions Required`
      : '⚠️ OpenCode - Permission Required';

  return sendDesktopNotification(title, message, {
    timeout: 10, // Longer timeout for permissions
    urgency: 'critical',
    sound: false, // We handle sound separately
    ...options,
  });
};

/**
 * Send a notification for question requests (SDK v1.1.7+).
 * Pre-configured for question notifications.
 *
 * @param message - Notification message
 * @param options - Additional options
 * @returns Result object
 */
export const notifyQuestion = async (
  message: string,
  options: DesktopNotifyOptions = {},
): Promise<NotificationResult> => {
  const count = options.count || 1;
  const title = options.projectName
    ? `❓ ${options.projectName} - Question`
    : count > 1
      ? `❓ ${count} Questions Need Your Input`
      : '❓ OpenCode - Question';

  return sendDesktopNotification(title, message, {
    timeout: 8,
    urgency: 'normal',
    sound: false, // We handle sound separately
    ...options,
  });
};

/**
 * Send a notification for error events.
 * Pre-configured for error notifications (most urgent).
 *
 * @param message - Notification message
 * @param options - Additional options
 * @returns Result object
 */
export const notifyError = async (
  message: string,
  options: DesktopNotifyOptions = {},
): Promise<NotificationResult> => {
  const title = options.projectName ? `❌ ${options.projectName} - Error` : '❌ OpenCode - Error';

  return sendDesktopNotification(title, message, {
    timeout: 15, // Longer timeout for errors
    urgency: 'critical',
    sound: false, // We handle sound separately
    ...options,
  });
};

// Default export for convenience
export default {
  sendDesktopNotification,
  notifyTaskComplete,
  notifyPermissionRequest,
  notifyQuestion,
  notifyError,
  checkNotificationSupport,
  getPlatform,
};
