// @ts-nocheck
/**
 * Unit Tests for Config Update Logic
 *
 * Verifies that the config updater:
 * 1. Preserves user values when regenerating the config file
 * 2. Updates comments without affecting stored values
 * 3. Correctly handles the focus detection configuration section
 *
 * @see src/util/config.ts - generateDefaultConfig, loadConfig, deepMerge
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  createTestTempDir,
  cleanupTestTempDir,
  createTestConfig,
  createTestAssets,
  readTestFile,
} from '../setup.js';
import fs from 'fs';
import path from 'path';

describe('config update logic', () => {
  let loadConfig;
  let parseJSONC;
  let deepMerge;
  let findNewFields;
  let getDefaultConfigObject;
  let formatJSON;

  beforeEach(async () => {
    createTestTempDir();
    createTestAssets();

    const module = await import('../../src/util/config.js');
    loadConfig = module.loadConfig;
    parseJSONC = module.parseJSONC;
    deepMerge = module.deepMerge;
    findNewFields = module.findNewFields;
    getDefaultConfigObject = module.getDefaultConfigObject;
    formatJSON = module.formatJSON;
  });

  afterEach(() => {
    cleanupTestTempDir();
  });

  // ============================================================
  // FOCUS DETECTION CONFIGURATION (suppressWhenFocused / alwaysNotify)
  // ============================================================

  describe('suppressWhenFocused config', () => {
    test('defaults to false when no config file exists', () => {
      const config = loadConfig('smart-voice-notify');
      expect(config.suppressWhenFocused).toBe(false);
    });

    test('defaults to false when config file exists without the field', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        enabled: true,
        notificationMode: 'sound-first',
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.suppressWhenFocused).toBe(false);
    });

    test('preserves user value when set to true', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        suppressWhenFocused: true,
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.suppressWhenFocused).toBe(true);
    });

    test('preserves user value when explicitly set to false', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        suppressWhenFocused: false,
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.suppressWhenFocused).toBe(false);
    });

    test('value survives config regeneration on version change', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        suppressWhenFocused: true,
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.suppressWhenFocused).toBe(true);

      // Verify the regenerated file also has the value
      const content = readTestFile('smart-voice-notify.jsonc');
      expect(content).toContain('"suppressWhenFocused": true');
    });

    test('appears in generated config file under FOCUS DETECTION section', () => {
      loadConfig('smart-voice-notify');

      const content = readTestFile('smart-voice-notify.jsonc');
      expect(content).toContain('FOCUS DETECTION SETTINGS');
      expect(content).toContain('"suppressWhenFocused"');
    });
  });

  describe('alwaysNotify config', () => {
    test('defaults to false when no config file exists', () => {
      const config = loadConfig('smart-voice-notify');
      expect(config.alwaysNotify).toBe(false);
    });

    test('defaults to false when config file exists without the field', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        enabled: true,
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.alwaysNotify).toBe(false);
    });

    test('preserves user value when set to true', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        alwaysNotify: true,
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.alwaysNotify).toBe(true);
    });

    test('preserves user value when explicitly set to false', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        alwaysNotify: false,
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.alwaysNotify).toBe(false);
    });

    test('value survives config regeneration on version change', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        alwaysNotify: true,
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.alwaysNotify).toBe(true);

      const content = readTestFile('smart-voice-notify.jsonc');
      expect(content).toContain('"alwaysNotify": true');
    });
  });

  describe('suppressWhenFocused and alwaysNotify interaction', () => {
    test('both can be set simultaneously', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        suppressWhenFocused: true,
        alwaysNotify: true,
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.suppressWhenFocused).toBe(true);
      expect(config.alwaysNotify).toBe(true);
    });

    test('both are preserved through version update', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        suppressWhenFocused: true,
        alwaysNotify: false,
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.suppressWhenFocused).toBe(true);
      expect(config.alwaysNotify).toBe(false);
    });

    test('focus detection fields present in getDefaultConfigObject', () => {
      const defaults = getDefaultConfigObject();
      expect(defaults).toHaveProperty('suppressWhenFocused');
      expect(defaults).toHaveProperty('alwaysNotify');
      expect(defaults.suppressWhenFocused).toBe(false);
      expect(defaults.alwaysNotify).toBe(false);
    });
  });

  // ============================================================
  // CONFIG REGENERATION: USER VALUE PRESERVATION
  // ============================================================

  describe('config regeneration preserves user values', () => {
    test('preserves boolean false values during version-triggered regeneration', () => {
      // User has set several booleans to non-default values
      createTestConfig({
        _configVersion: '0.0.1',
        enabled: false,
        enableTTS: false,
        enableSound: false,
        enableToast: false,
        enableDesktopNotification: false,
        suppressWhenFocused: true,
      });

      const config = loadConfig('smart-voice-notify');

      // All user-set false values must survive
      expect(config.enabled).toBe(false);
      expect(config.enableTTS).toBe(false);
      expect(config.enableSound).toBe(false);
      expect(config.enableToast).toBe(false);
      expect(config.enableDesktopNotification).toBe(false);
      expect(config.suppressWhenFocused).toBe(true);
    });

    test('preserves numeric zero values during regeneration', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        desktopNotificationTimeout: 0,
        volumeThreshold: 0,
        projectSoundSeed: 0,
        maxFollowUpReminders: 0,
      });

      const config = loadConfig('smart-voice-notify');

      expect(config.desktopNotificationTimeout).toBe(0);
      expect(config.volumeThreshold).toBe(0);
      expect(config.projectSoundSeed).toBe(0);
      expect(config.maxFollowUpReminders).toBe(0);
    });

    test('preserves empty string values during regeneration', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        webhookUrl: '',
        soundThemeDir: '',
        aiApiKey: '',
      });

      const config = loadConfig('smart-voice-notify');

      expect(config.webhookUrl).toBe('');
      expect(config.soundThemeDir).toBe('');
      expect(config.aiApiKey).toBe('');
    });

    test('preserves custom string values during regeneration', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        ttsEngine: 'edge',
        edgeVoice: 'en-US-AnaNeural',
        edgePitch: '+50Hz',
        edgeRate: '+20%',
        webhookUrl: 'https://discord.com/api/webhooks/test',
        webhookUsername: 'My Custom Bot',
      });

      const config = loadConfig('smart-voice-notify');

      expect(config.ttsEngine).toBe('edge');
      expect(config.edgeVoice).toBe('en-US-AnaNeural');
      expect(config.edgePitch).toBe('+50Hz');
      expect(config.edgeRate).toBe('+20%');
      expect(config.webhookUrl).toBe('https://discord.com/api/webhooks/test');
      expect(config.webhookUsername).toBe('My Custom Bot');
    });

    test('preserves custom numeric values during regeneration', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        ttsReminderDelaySeconds: 120,
        idleReminderDelaySeconds: 90,
        permissionReminderDelaySeconds: 45,
        reminderBackoffMultiplier: 2.5,
        elevenLabsStability: 0.8,
        elevenLabsSimilarity: 0.9,
        openaiTtsSpeed: 1.5,
      });

      const config = loadConfig('smart-voice-notify');

      expect(config.ttsReminderDelaySeconds).toBe(120);
      expect(config.idleReminderDelaySeconds).toBe(90);
      expect(config.permissionReminderDelaySeconds).toBe(45);
      expect(config.reminderBackoffMultiplier).toBe(2.5);
      expect(config.elevenLabsStability).toBe(0.8);
      expect(config.elevenLabsSimilarity).toBe(0.9);
      expect(config.openaiTtsSpeed).toBe(1.5);
    });

    test('preserves user arrays intact during regeneration (no merge)', () => {
      const customIdle = ['My custom done message.'];
      const customPermission = ['Custom perm 1', 'Custom perm 2'];

      createTestConfig({
        _configVersion: '0.0.1',
        idleTTSMessages: customIdle,
        permissionTTSMessages: customPermission,
      });

      const config = loadConfig('smart-voice-notify');

      expect(config.idleTTSMessages).toEqual(customIdle);
      expect(config.idleTTSMessages).toHaveLength(1);
      expect(config.permissionTTSMessages).toEqual(customPermission);
      expect(config.permissionTTSMessages).toHaveLength(2);
    });

    test('preserves nested aiPrompts during regeneration', () => {
      const customPrompts = {
        idle: 'Say task is done in pirate speak.',
        permission: 'Request permission urgently.',
        question: 'Default question prompt',
        error: 'Default error prompt',
        idleReminder: 'Default idle reminder',
        permissionReminder: 'Default perm reminder',
        questionReminder: 'Default question reminder',
        errorReminder: 'Default error reminder',
      };

      createTestConfig({
        _configVersion: '0.0.1',
        aiPrompts: customPrompts,
      });

      const config = loadConfig('smart-voice-notify');

      expect(config.aiPrompts.idle).toBe('Say task is done in pirate speak.');
      expect(config.aiPrompts.permission).toBe('Request permission urgently.');
    });

    test('adds new fields from defaults while preserving all user values', () => {
      // Simulate old config missing many fields
      createTestConfig({
        _configVersion: '0.0.1',
        enabled: false,
        notificationMode: 'both',
        ttsEngine: 'edge',
        ttsReminderDelaySeconds: 99,
        enableTTS: false,
      });

      const config = loadConfig('smart-voice-notify');

      // User values preserved
      expect(config.enabled).toBe(false);
      expect(config.notificationMode).toBe('both');
      expect(config.ttsEngine).toBe('edge');
      expect(config.ttsReminderDelaySeconds).toBe(99);
      expect(config.enableTTS).toBe(false);

      // New fields added with defaults
      expect(config.suppressWhenFocused).toBe(false);
      expect(config.alwaysNotify).toBe(false);
      expect(config.enableDesktopNotification).toBe(true);
      expect(config.enableWebhook).toBe(false);
      expect(config.questionReminderDelaySeconds).toBe(25);
      expect(config.errorReminderDelaySeconds).toBe(20);
    });

    test('version is updated after regeneration', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        enabled: true,
        suppressWhenFocused: true,
      });

      const config = loadConfig('smart-voice-notify');

      // Version should be updated to current package.json version
      expect(config._configVersion).not.toBe('0.0.1');
      expect(typeof config._configVersion).toBe('string');

      // Verify in the regenerated file too
      const content = readTestFile('smart-voice-notify.jsonc');
      const parsed = parseJSONC(content);
      expect(parsed._configVersion).not.toBe('0.0.1');
    });
  });

  // ============================================================
  // COMMENT UPDATES WITHOUT VALUE LOSS
  // ============================================================

  describe('comment updates without affecting values', () => {
    test('regenerated file contains documentation comments', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        enabled: false,
        suppressWhenFocused: true,
      });

      loadConfig('smart-voice-notify');

      const content = readTestFile('smart-voice-notify.jsonc');

      // Comments are present in the regenerated file
      expect(content).toContain('// ');
      expect(content).toContain('PLUGIN ENABLE/DISABLE');
      expect(content).toContain('FOCUS DETECTION SETTINGS');
      expect(content).toContain('TTS ENGINE SELECTION');
      expect(content).toContain('GENERAL SETTINGS');
      expect(content).toContain('WEBHOOK NOTIFICATION SETTINGS');
    });

    test('user values are embedded in regenerated commented file', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        enabled: false,
        notificationMode: 'tts-first',
        ttsEngine: 'edge',
        edgeVoice: 'en-US-AnaNeural',
        suppressWhenFocused: true,
        alwaysNotify: false,
        desktopNotificationTimeout: 15,
      });

      loadConfig('smart-voice-notify');

      const content = readTestFile('smart-voice-notify.jsonc');

      // User values must be in the regenerated file
      expect(content).toContain('"enabled": false');
      expect(content).toContain('"notificationMode": "tts-first"');
      expect(content).toContain('"ttsEngine": "edge"');
      expect(content).toContain('"edgeVoice": "en-US-AnaNeural"');
      expect(content).toContain('"suppressWhenFocused": true');
      expect(content).toContain('"alwaysNotify": false');
      expect(content).toContain('"desktopNotificationTimeout": 15');
    });

    test('regenerated file is valid JSONC that parses correctly', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        enabled: false,
        suppressWhenFocused: true,
        ttsReminderDelaySeconds: 42,
      });

      loadConfig('smart-voice-notify');

      const content = readTestFile('smart-voice-notify.jsonc');

      // Must parse without error
      const parsed = parseJSONC(content);
      expect(parsed).toBeDefined();
      expect(parsed.enabled).toBe(false);
      expect(parsed.suppressWhenFocused).toBe(true);
      expect(parsed.ttsReminderDelaySeconds).toBe(42);
    });

    test('re-loading regenerated config produces identical values', () => {
      // First load: creates config from user values + defaults
      createTestConfig({
        _configVersion: '0.0.1',
        enabled: false,
        notificationMode: 'both',
        suppressWhenFocused: true,
        alwaysNotify: true,
        ttsReminderDelaySeconds: 60,
      });

      const firstLoad = loadConfig('smart-voice-notify');

      // Second load: reads the regenerated file
      const secondLoad = loadConfig('smart-voice-notify');

      // All values must be identical
      expect(secondLoad.enabled).toBe(firstLoad.enabled);
      expect(secondLoad.notificationMode).toBe(firstLoad.notificationMode);
      expect(secondLoad.suppressWhenFocused).toBe(firstLoad.suppressWhenFocused);
      expect(secondLoad.alwaysNotify).toBe(firstLoad.alwaysNotify);
      expect(secondLoad.ttsReminderDelaySeconds).toBe(firstLoad.ttsReminderDelaySeconds);
      expect(secondLoad.enableDesktopNotification).toBe(firstLoad.enableDesktopNotification);
      expect(secondLoad.enableTTS).toBe(firstLoad.enableTTS);
      expect(secondLoad.enableSound).toBe(firstLoad.enableSound);
    });

    test('config file is NOT rewritten when version matches (no unnecessary writes)', () => {
      // Create a config that already matches current version
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
      const currentVersion = pkg.version;

      const defaults = getDefaultConfigObject();

      // Write a full config with current version so no update is needed
      createTestConfig({
        ...defaults,
        _configVersion: currentVersion,
      });

      const tempDir = process.env.OPENCODE_CONFIG_DIR;
      const configPath = path.join(tempDir, 'smart-voice-notify.jsonc');
      const mtimeBefore = fs.statSync(configPath).mtimeMs;

      // Small delay to ensure mtime would differ if file was written
      const startTime = Date.now();
      while (Date.now() - startTime < 50) {
        // busy-wait for timestamp granularity
      }

      loadConfig('smart-voice-notify');

      const mtimeAfter = fs.statSync(configPath).mtimeMs;

      // File should NOT have been rewritten since version matches and no new fields
      expect(mtimeAfter).toBe(mtimeBefore);
    });
  });

  // ============================================================
  // DEEP MERGE EDGE CASES FOR CONFIG UPDATE
  // ============================================================

  describe('deepMerge edge cases for config update', () => {
    test('user value of different type than default takes precedence', () => {
      // User sets a string where default is boolean (unusual but possible)
      const defaults = { enabled: true };
      const user = { enabled: 'disabled' };
      const result = deepMerge(defaults, user);
      expect(result.enabled).toBe('disabled');
    });

    test('deeply nested objects are recursively merged', () => {
      const defaults = {
        level1: {
          level2: {
            a: 1,
            b: 2,
          },
        },
      };
      const user = {
        level1: {
          level2: {
            a: 99,
          },
        },
      };

      const result = deepMerge(defaults, user);
      expect(result.level1.level2.a).toBe(99);
      expect(result.level1.level2.b).toBe(2);
    });

    test('user array completely replaces default array regardless of length', () => {
      const defaults = { messages: ['a', 'b', 'c', 'd', 'e'] };
      const user = { messages: ['only-one'] };
      const result = deepMerge(defaults, user);
      expect(result.messages).toEqual(['only-one']);
    });

    test('empty user array replaces default array', () => {
      const defaults = { messages: ['a', 'b', 'c'] };
      const user = { messages: [] };
      const result = deepMerge(defaults, user);
      expect(result.messages).toEqual([]);
    });

    test('user extra keys not in defaults are preserved', () => {
      const defaults = { a: 1 };
      const user = { a: 2, customKey: 'user-added' };
      const result = deepMerge(defaults, user);
      expect(result.a).toBe(2);
      expect(result.customKey).toBe('user-added');
    });

    test('handles empty default object', () => {
      const defaults = {};
      const user = { a: 1, b: 2 };
      const result = deepMerge(defaults, user);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    test('handles empty user object', () => {
      const defaults = { a: 1, b: 2 };
      const user = {};
      const result = deepMerge(defaults, user);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    test('primitive default with object user returns user', () => {
      const defaults = 'string-default';
      const user = { complex: true };
      const result = deepMerge(defaults, user);
      expect(result).toEqual({ complex: true });
    });
  });

  // ============================================================
  // findNewFields FOR CONFIG UPDATE DETECTION
  // ============================================================

  describe('findNewFields for config update detection', () => {
    test('detects focus detection fields missing from old config', () => {
      const defaults = getDefaultConfigObject();
      const oldConfig = {
        enabled: true,
        notificationMode: 'sound-first',
        // Missing: suppressWhenFocused, alwaysNotify, and many others
      };

      const newFields = findNewFields(defaults, oldConfig);

      expect(newFields).toContain('suppressWhenFocused');
      expect(newFields).toContain('alwaysNotify');
    });

    test('returns empty array when config has all fields', () => {
      const defaults = getDefaultConfigObject();

      // Config that has every key from defaults
      const fullConfig = { ...defaults };

      const newFields = findNewFields(defaults, fullConfig);
      expect(newFields).toEqual([]);
    });

    test('detects nested missing fields in aiPrompts', () => {
      const defaults = getDefaultConfigObject();
      const partialConfig = {
        ...defaults,
        aiPrompts: {
          idle: 'custom',
          // Missing: permission, question, error, and all reminders
        },
      };

      const newFields = findNewFields(defaults, partialConfig);

      expect(newFields).toContain('aiPrompts.permission');
      expect(newFields).toContain('aiPrompts.question');
      expect(newFields).toContain('aiPrompts.error');
      expect(newFields).toContain('aiPrompts.idleReminder');
    });

    test('does not flag array fields as having nested missing items', () => {
      const defaults = { messages: ['a', 'b', 'c'] };
      const user = { messages: ['x'] };

      const newFields = findNewFields(defaults, user);
      // Arrays are not recursed into
      expect(newFields).toEqual([]);
    });

    test('handles non-object defaults gracefully', () => {
      const result = findNewFields('not-object', { a: 1 });
      expect(result).toEqual([]);
    });

    test('throws when user is non-object (string passed to `in` operator)', () => {
      // findNewFields only guards defaults being non-object, not user.
      // Passing a primitive as user causes `key in userRecord` to throw.
      expect(() => findNewFields({ a: 1 }, 'not-object')).toThrow();
    });
  });

  // ============================================================
  // FULL CONFIG ROUNDTRIP (REGENERATION + RELOAD)
  // ============================================================

  describe('full config roundtrip', () => {
    test('comprehensive user config survives regeneration roundtrip', () => {
      // Create a heavily customized config with an old version
      const userConfig = {
        _configVersion: '0.0.1',
        enabled: false,
        notificationMode: 'tts-first',
        enableTTSReminder: false,
        enableIdleNotification: false,
        enablePermissionNotification: true,
        enableQuestionNotification: false,
        enableErrorNotification: true,
        enableIdleReminder: false,
        enablePermissionReminder: true,
        enableQuestionReminder: false,
        enableErrorReminder: true,
        ttsReminderDelaySeconds: 120,
        idleReminderDelaySeconds: 90,
        permissionReminderDelaySeconds: 45,
        questionReminderDelaySeconds: 50,
        errorReminderDelaySeconds: 35,
        enableFollowUpReminders: false,
        maxFollowUpReminders: 5,
        reminderBackoffMultiplier: 3.0,
        ttsEngine: 'edge',
        enableTTS: false,
        elevenLabsVoiceId: 'custom-voice-id',
        edgeVoice: 'en-US-AnaNeural',
        edgePitch: '+50Hz',
        edgeRate: '-10%',
        suppressWhenFocused: true,
        alwaysNotify: false,
        enableDesktopNotification: false,
        desktopNotificationTimeout: 20,
        showProjectInNotification: false,
        enableWebhook: true,
        webhookUrl: 'https://hooks.example.com/test',
        webhookUsername: 'TestBot',
        webhookEvents: ['idle', 'error'],
        webhookMentionOnPermission: true,
        enableSound: false,
        enableToast: false,
        wakeMonitor: false,
        forceVolume: true,
        volumeThreshold: 80,
        debugLog: true,
      };

      createTestConfig(userConfig);

      // Load triggers regeneration (version changed)
      const config = loadConfig('smart-voice-notify');

      // Verify every single user value survived
      expect(config.enabled).toBe(false);
      expect(config.notificationMode).toBe('tts-first');
      expect(config.enableTTSReminder).toBe(false);
      expect(config.enableIdleNotification).toBe(false);
      expect(config.enablePermissionNotification).toBe(true);
      expect(config.enableQuestionNotification).toBe(false);
      expect(config.enableErrorNotification).toBe(true);
      expect(config.enableIdleReminder).toBe(false);
      expect(config.enablePermissionReminder).toBe(true);
      expect(config.enableQuestionReminder).toBe(false);
      expect(config.enableErrorReminder).toBe(true);
      expect(config.ttsReminderDelaySeconds).toBe(120);
      expect(config.idleReminderDelaySeconds).toBe(90);
      expect(config.permissionReminderDelaySeconds).toBe(45);
      expect(config.questionReminderDelaySeconds).toBe(50);
      expect(config.errorReminderDelaySeconds).toBe(35);
      expect(config.enableFollowUpReminders).toBe(false);
      expect(config.maxFollowUpReminders).toBe(5);
      expect(config.reminderBackoffMultiplier).toBe(3.0);
      expect(config.ttsEngine).toBe('edge');
      expect(config.enableTTS).toBe(false);
      expect(config.elevenLabsVoiceId).toBe('custom-voice-id');
      expect(config.edgeVoice).toBe('en-US-AnaNeural');
      expect(config.edgePitch).toBe('+50Hz');
      expect(config.edgeRate).toBe('-10%');
      expect(config.suppressWhenFocused).toBe(true);
      expect(config.alwaysNotify).toBe(false);
      expect(config.enableDesktopNotification).toBe(false);
      expect(config.desktopNotificationTimeout).toBe(20);
      expect(config.showProjectInNotification).toBe(false);
      expect(config.enableWebhook).toBe(true);
      expect(config.webhookUrl).toBe('https://hooks.example.com/test');
      expect(config.webhookUsername).toBe('TestBot');
      expect(config.webhookEvents).toEqual(['idle', 'error']);
      expect(config.webhookMentionOnPermission).toBe(true);
      expect(config.enableSound).toBe(false);
      expect(config.enableToast).toBe(false);
      expect(config.wakeMonitor).toBe(false);
      expect(config.forceVolume).toBe(true);
      expect(config.volumeThreshold).toBe(80);
      expect(config.debugLog).toBe(true);
    });

    test('regenerated file can be parsed back and yields same config', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        enabled: false,
        suppressWhenFocused: true,
        notificationMode: 'both',
        ttsReminderDelaySeconds: 77,
        idleTTSMessages: ['Custom only message'],
      });

      const config = loadConfig('smart-voice-notify');

      // Parse the regenerated file
      const content = readTestFile('smart-voice-notify.jsonc');
      const parsed = parseJSONC(content);

      // Key values match
      expect(parsed.enabled).toBe(config.enabled);
      expect(parsed.suppressWhenFocused).toBe(config.suppressWhenFocused);
      expect(parsed.notificationMode).toBe(config.notificationMode);
      expect(parsed.ttsReminderDelaySeconds).toBe(config.ttsReminderDelaySeconds);
      expect(parsed.idleTTSMessages).toEqual(config.idleTTSMessages);
    });

    test('multiple sequential loads produce stable config', () => {
      createTestConfig({
        _configVersion: '0.0.1',
        enabled: false,
        suppressWhenFocused: true,
      });

      const first = loadConfig('smart-voice-notify');
      const second = loadConfig('smart-voice-notify');
      const third = loadConfig('smart-voice-notify');

      // All loads should produce the same values
      expect(first.enabled).toBe(second.enabled);
      expect(second.enabled).toBe(third.enabled);
      expect(first.suppressWhenFocused).toBe(second.suppressWhenFocused);
      expect(second.suppressWhenFocused).toBe(third.suppressWhenFocused);
      expect(first._configVersion).toBe(second._configVersion);
      expect(second._configVersion).toBe(third._configVersion);
    });
  });
});
