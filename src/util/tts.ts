import fs from 'fs';
import os from 'os';
import path from 'path';

import type { PluginConfig } from '../types/config.js';
import type { OpenCodeClient, ShellRunner } from '../types/opencode-sdk.js';
import type { SpeakOptions, TTSAPI, TTSFactoryParams } from '../types/tts.js';

import { loadConfig } from './config.js';

const platform = os.platform();
// Remove module-level configDir constant that caches process.env prematurely
// const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');

type ToastVariant = 'info' | 'success' | 'warning' | 'error';

interface ElevenLabsErrorLike {
  statusCode?: number;
  message?: string;
}

const getErrorMessage = (error: unknown): string => {
  const maybeError = error as { message?: unknown };
  return String(maybeError?.message ?? error);
};

const outputToString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString();
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
};

const toBufferChunk = (chunk: unknown): Buffer => {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  if (chunk instanceof ArrayBuffer) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk));
};

/**
 * Gets the current OpenCode config directory
 * @returns
 */
const getConfigDir = (): string => process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');

/**
 * Loads the TTS configuration (shared with the notification plugin)
 * @returns
 */
export const getTTSConfig = (): PluginConfig => {
  return loadConfig('smart-voice-notify', {
    ttsEngine: 'elevenlabs',
    enableTTS: true,
    elevenLabsApiKey: '',
    elevenLabsVoiceId: 'cgSgspJ2msm6clMCkdW9',
    elevenLabsModel: 'eleven_turbo_v2_5',
    elevenLabsStability: 0.5,
    elevenLabsSimilarity: 0.75,
    elevenLabsStyle: 0.5,
    edgeVoice: 'en-US-JennyNeural',
    edgePitch: '+0Hz',
    edgeRate: '+10%',

    // OpenAI-compatible TTS settings
    openaiTtsEndpoint: '',
    openaiTtsApiKey: '',
    openaiTtsModel: 'tts-1',
    openaiTtsVoice: 'alloy',
    openaiTtsFormat: 'mp3',
    openaiTtsSpeed: 1.0,

    // ============================================================
    // NOTIFICATION MODE & TTS REMINDER SETTINGS
    // ============================================================
    // 'sound-first' - Play sound immediately, TTS reminder after delay (default)
    // 'tts-first'   - Speak TTS immediately, no sound
    // 'both'        - Play sound AND speak TTS immediately
    // 'sound-only'  - Only play sound, no TTS at all
    notificationMode: 'sound-first',

    // Enable TTS reminder if user doesn't respond after sound notification
    enableTTSReminder: true,

    // Delay in seconds before TTS reminder (if user hasn't responded)
    // Can be set globally or per-notification type
    ttsReminderDelaySeconds: 30,
    idleReminderDelaySeconds: 30,
    permissionReminderDelaySeconds: 20,

    // Follow-up reminders (if user still doesn't respond after first TTS)
    enableFollowUpReminders: true,
    maxFollowUpReminders: 3,
    reminderBackoffMultiplier: 1.5, // Each follow-up waits longer (30s, 45s, 67.5s)

    // ============================================================
    // TTS MESSAGE VARIETY (Initial notifications - randomly selected)
    // ============================================================
    // Messages when agent finishes work
    idleTTSMessages: [
      'All done! Your task has been completed successfully.',
      'Hey there! I finished working on your request.',
      'Task complete! Ready for your review whenever you are.',
      'Good news! Everything is done and ready for you.',
      'Finished! Let me know if you need anything else.',
    ],
    // Messages for permission requests
    permissionTTSMessages: [
      'Attention please! I need your permission to continue.',
      'Hey! Quick approval needed to proceed with the task.',
      'Heads up! There is a permission request waiting for you.',
      'Excuse me! I need your authorization before I can continue.',
      'Permission required! Please review and approve when ready.',
    ],
    // Messages for MULTIPLE permission requests (use {count} placeholder)
    permissionTTSMessagesMultiple: [
      'Attention please! There are {count} permission requests waiting for your approval.',
      'Hey! {count} permissions need your approval to continue.',
      'Heads up! You have {count} pending permission requests.',
      'Excuse me! I need your authorization for {count} different actions.',
      '{count} permissions required! Please review and approve when ready.',
    ],

    // ============================================================
    // TTS REMINDER MESSAGES (More urgent/personalized - used after delay)
    // ============================================================
    // Reminder messages when agent finished but user hasn't responded
    idleReminderTTSMessages: [
      'Hey, are you still there? Your task has been waiting for review.',
      'Just a gentle reminder - I finished your request a while ago!',
      'Hello? I completed your task. Please take a look when you can.',
      'Still waiting for you! The work is done and ready for review.',
      'Knock knock! Your completed task is patiently waiting for you.',
    ],
    // Reminder messages when permission still needed
    permissionReminderTTSMessages: [
      'Hey! I still need your permission to continue. Please respond!',
      'Reminder: There is a pending permission request. I cannot proceed without you.',
      'Hello? I am waiting for your approval. This is getting urgent!',
      'Please check your screen! I really need your permission to move forward.',
      'Still waiting for authorization! The task is on hold until you respond.',
    ],
    // Reminder messages for MULTIPLE permissions (use {count} placeholder)
    permissionReminderTTSMessagesMultiple: [
      'Hey! I still need your approval for {count} permissions. Please respond!',
      'Reminder: There are {count} pending permission requests. I cannot proceed without you.',
      'Hello? I am waiting for your approval on {count} items. This is getting urgent!',
      'Please check your screen! {count} permissions are waiting for your response.',
      'Still waiting for authorization on {count} requests! The task is on hold.',
    ],

    // Permission batch window (ms) - how long to wait for more permissions before notifying
    permissionBatchWindowMs: 800,

    // ============================================================
    // QUESTION TOOL MESSAGES (SDK v1.1.7+ - Agent asking user questions)
    // ============================================================
    // Messages when agent asks user a question
    questionTTSMessages: [
      'Hey! I have a question for you. Please check your screen.',
      'Attention! I need your input to continue.',
      'Quick question! Please take a look when you have a moment.',
      'I need some clarification. Could you please respond?',
      'Question time! Your input is needed to proceed.',
    ],
    // Messages for MULTIPLE questions (use {count} placeholder)
    questionTTSMessagesMultiple: [
      'Hey! I have {count} questions for you. Please check your screen.',
      'Attention! I need your input on {count} items to continue.',
      '{count} questions need your attention. Please take a look!',
      'I need some clarifications. There are {count} questions waiting for you.',
      'Question time! {count} questions need your response to proceed.',
    ],
    // Reminder messages for questions
    questionReminderTTSMessages: [
      'Hey! I am still waiting for your answer. Please check the questions!',
      'Reminder: There is a question waiting for your response.',
      'Hello? I need your input to continue. Please respond when you can.',
      'Still waiting for your answer! The task is on hold.',
      'Your input is needed! Please check the pending question.',
    ],
    // Reminder messages for MULTIPLE questions (use {count} placeholder)
    questionReminderTTSMessagesMultiple: [
      'Hey! I am still waiting for answers to {count} questions. Please respond!',
      'Reminder: There are {count} questions waiting for your response.',
      'Hello? I need your input on {count} items. Please respond when you can.',
      'Still waiting for your answers on {count} questions! The task is on hold.',
      'Your input is needed! {count} questions are pending your response.',
    ],
    // Question reminder delay (seconds) - slightly less urgent than permissions
    questionReminderDelaySeconds: 25,
    // Question batch window (ms) - how long to wait for more questions before notifying
    questionBatchWindowMs: 800,

    // ============================================================
    // SOUND FILES (Used for immediate notifications)
    // ============================================================
    idleSound: 'assets/Soft-high-tech-notification-sound-effect.mp3',
    permissionSound: 'assets/Machine-alert-beep-sound-effect.mp3',
    questionSound: 'assets/Machine-alert-beep-sound-effect.mp3',

    // ============================================================
    // GENERAL SETTINGS
    // ============================================================
    wakeMonitor: true,
    forceVolume: true,
    enableSound: true,
    enableToast: true,
    volumeThreshold: 50,
    idleThresholdSeconds: 30,
    debugLog: false,
  });
};

let elevenLabsQuotaExceeded = false;

/**
 * Creates a TTS utility instance
 * @param params - { $, client }
 * @returns TTS API
 */
export const createTTS = ({ $, client }: TTSFactoryParams): TTSAPI => {
  const shell: ShellRunner | undefined = $;
  const opencodeClient: OpenCodeClient | undefined = client;
  const config = getTTSConfig();
  const configDir = getConfigDir();
  const logsDir = path.join(configDir, 'logs');

  const logFile = path.join(logsDir, 'smart-voice-notify-debug.log');

  // Ensure logs directory exists if debug logging is enabled
  if (config.debugLog && !fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
    } catch {
      // Silently fail - logging is optional
    }
  }

  // Debug logging function
  const debugLog = (message: string): void => {
    if (!config.debugLog) return;
    try {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    } catch {}
  };

  const showToast = async (message: string, variant: ToastVariant = 'info'): Promise<void> => {
    if (!config.enableToast) return;
    try {
      if (typeof opencodeClient?.tui?.showToast === 'function') {
        await opencodeClient.tui.showToast({
          body: {
            message,
            variant,
            duration: 6000,
          },
        });
      }
    } catch {}
  };

  /**
   * Play an audio file using system media player
   */
  const playAudioFile = async (filePath: string, loops = 1): Promise<void> => {
    if (!shell) {
      debugLog('playAudioFile: shell runner ($) not available');
      return;
    }
    try {
      for (let i = 0; i < loops; i++) {
        await shell`afplay ${filePath}`.quiet();
      }
    } catch (error) {
      debugLog(`playAudioFile error: ${getErrorMessage(error)}`);
    }
  };

  /**
   * ElevenLabs Engine (Online, High Quality, Anime-like voices)
   */
  const speakWithElevenLabs = async (text: string): Promise<boolean> => {
    if (elevenLabsQuotaExceeded) return false;

    if (!config.elevenLabsApiKey) {
      debugLog('speakWithElevenLabs: No API key configured');
      return false;
    }

    try {
      const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
      const elClient = new ElevenLabsClient({ apiKey: config.elevenLabsApiKey });

      const elevenLabsPayload = {
        text,
        model_id: config.elevenLabsModel || 'eleven_turbo_v2_5',
        voice_settings: {
          stability: config.elevenLabsStability ?? 0.5,
          similarity_boost: config.elevenLabsSimilarity ?? 0.75,
          style: config.elevenLabsStyle ?? 0.5,
          use_speaker_boost: true,
        },
      } as unknown as Parameters<typeof elClient.textToSpeech.convert>[1];

      const audio = await elClient.textToSpeech.convert(config.elevenLabsVoiceId || 'cgSgspJ2msm6clMCkdW9', elevenLabsPayload);

      const tempFile = path.join(os.tmpdir(), `opencode-tts-${Date.now()}.mp3`);
      const chunks: Buffer[] = [];
      for await (const chunk of audio as AsyncIterable<unknown>) {
        chunks.push(toBufferChunk(chunk));
      }
      fs.writeFileSync(tempFile, Buffer.concat(chunks));

      await playAudioFile(tempFile);
      try {
        fs.unlinkSync(tempFile);
      } catch {}
      return true;
    } catch (error) {
      debugLog(`speakWithElevenLabs error: ${getErrorMessage(error) || String(error) || 'Unknown error'}`);

      // Handle quota exceeded (401 specifically, or specific error message)
      const elevenLabsError = error as ElevenLabsErrorLike;
      const errorMessage = elevenLabsError.message ?? '';
      const isQuotaError =
        elevenLabsError.statusCode === 401 ||
        errorMessage.includes('401') ||
        errorMessage.toLowerCase().includes('quota_exceeded') ||
        errorMessage.toLowerCase().includes('quota exceeded');

      if (isQuotaError) {
        elevenLabsQuotaExceeded = true;
        await showToast('⚠️ ElevenLabs quota exceeded! Switching to Edge TTS for this session.', 'error');
      }

      return false;
    }
  };

  /**
   * Edge TTS Engine via Python CLI (Free, Neural voices)
   * Uses Python edge-tts package via command line as it's more reliable than Node.js WebSocket libraries.
   * Fallback: tries msedge-tts npm package if Python edge-tts is not available.
   */
  const speakWithEdgeTTS = async (text: string): Promise<boolean> => {
    const voice = config.edgeVoice || 'en-US-JennyNeural';
    const pitch = config.edgePitch || '+0Hz';
    const rate = config.edgeRate || '+10%';
    const volume = config.edgeVolume || '+0%';
    const tempFile = path.join(os.tmpdir(), `opencode-edge-tts-${Date.now()}.mp3`);

    // Escape text for shell (replace quotes with escaped quotes)
    const escapedText = text.replace(/"/g, '\\"');

    // Try Python edge-tts first (more reliable due to aiohttp WebSocket handling)
    if (shell) {
      try {
        // Use proper template literal syntax with individual arguments
        await shell`edge-tts --voice ${voice} --rate ${rate} --volume ${volume} --pitch ${pitch} --text ${escapedText} --write-media ${tempFile}`
          .quiet()
          .nothrow();

        if (fs.existsSync(tempFile)) {
          await playAudioFile(tempFile);
          try {
            fs.unlinkSync(tempFile);
          } catch {}
          debugLog('speakWithEdgeTTS: success via Python edge-tts CLI');
          return true;
        }
      } catch (error) {
        debugLog(`speakWithEdgeTTS: Python CLI failed: ${getErrorMessage(error) || 'unknown'}, trying npm package...`);
        // Fall through to try npm package
      }
    }

    // Fallback to msedge-tts npm package
    try {
      const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
      const tts = new MsEdgeTTS();

      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

      const { audioFilePath } = await tts.toFile(os.tmpdir(), text, { pitch, rate, volume });

      await playAudioFile(audioFilePath);
      try {
        fs.unlinkSync(audioFilePath);
      } catch {}
      debugLog('speakWithEdgeTTS: success via msedge-tts npm package');
      return true;
    } catch (error) {
      debugLog(`speakWithEdgeTTS error: ${getErrorMessage(error) || String(error) || 'Unknown error'}`);
      return false;
    }
  };

  /**
   * macOS Say Engine
   */
  const speakWithSay = async (text: string): Promise<boolean> => {
    if (platform !== 'darwin' || !shell) return false;
    try {
      const result = await shell`say ${text}`.nothrow().quiet();
      if (result.exitCode !== 0) {
        debugLog(`speakWithSay failed with code ${result.exitCode}: ${outputToString(result.stderr)}`);
        return false;
      }
      return true;
    } catch (error) {
      debugLog(`speakWithSay error: ${getErrorMessage(error) || String(error) || 'Unknown error'}`);
      return false;
    }
  };

  /**
   * OpenAI-Compatible TTS Engine (Kokoro, OpenAI, LocalAI, etc.)
   * Calls /v1/audio/speech endpoint with configurable base URL
   */
  const speakWithOpenAI = async (text: string): Promise<boolean> => {
    if (!config.openaiTtsEndpoint) {
      debugLog('speakWithOpenAI: No endpoint configured');
      return false;
    }

    try {
      const endpoint = config.openaiTtsEndpoint.replace(/\/$/, '');
      const url = `${endpoint}/v1/audio/speech`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add auth header if API key is provided
      if (config.openaiTtsApiKey) {
        headers.Authorization = `Bearer ${config.openaiTtsApiKey}`;
      }

      const body = {
        model: config.openaiTtsModel || 'tts-1',
        input: text,
        voice: config.openaiTtsVoice || 'alloy',
        response_format: config.openaiTtsFormat || 'mp3',
        speed: config.openaiTtsSpeed ?? 1.0,
      };

      debugLog(`speakWithOpenAI: Calling ${url} with voice=${body.voice}, model=${body.model}`);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        debugLog(`speakWithOpenAI: API error ${response.status}: ${errorText}`);
        return false;
      }

      const audioBuffer = await response.arrayBuffer();
      const tempFile = path.join(os.tmpdir(), `opencode-tts-openai-${Date.now()}.mp3`);
      fs.writeFileSync(tempFile, Buffer.from(audioBuffer));

      await playAudioFile(tempFile);
      try {
        fs.unlinkSync(tempFile);
      } catch {}
      return true;
    } catch (error) {
      debugLog(`speakWithOpenAI error: ${getErrorMessage(error) || String(error) || 'Unknown error'}`);
      return false;
    }
  };

  /**
   * Get the current system idle time in seconds.
   */
  const getSystemIdleSeconds = async (): Promise<number> => {
    if (platform !== 'darwin' || !shell) {
      return 999;
    }

    try {
      const result = await shell`ioreg -c IOHIDSystem`.quiet();
      const output = outputToString(result.stdout);
      const match = output.match(/"HIDIdleTime"\s*=\s*(\d+)/);
      if (!match || !match[1]) {
        return 999;
      }
      const idleNanos = Number(match[1]);
      if (!Number.isFinite(idleNanos)) {
        return 999;
      }
      return Math.floor(idleNanos / 1_000_000_000);
    } catch {
      return 999;
    }
  };

  /**
   * Get the current system volume level (0-100).
   */
  const getCurrentVolume = async (): Promise<number> => {
    if (platform !== 'darwin' || !shell) {
      return -1;
    }

    try {
      const result = await shell`osascript -e "output volume of (get volume settings)"`.quiet();
      const parsed = parseInt(outputToString(result.stdout).trim() || '-1', 10);
      return Number.isFinite(parsed) ? parsed : -1;
    } catch {
      return -1;
    }
  };

  /**
   * Wake Monitor Utility
   */
  const wakeMonitor = async (force = false): Promise<void> => {
    if (!config.wakeMonitor || !shell) return;
    try {
      const idleSeconds = await getSystemIdleSeconds();
      const threshold = config.idleThresholdSeconds || 30;

      if (!force && idleSeconds < threshold) {
        debugLog(`wakeMonitor: skipped (idle ${idleSeconds}s < ${threshold}s)`);
        return;
      }

      debugLog(`wakeMonitor: attempting to wake monitor (idle: ${idleSeconds}s, force: ${force})`);

      if (platform === 'darwin') {
        await shell`caffeinate -u -t 1`.quiet();
        debugLog('wakeMonitor: macOS wake command executed');
      }
    } catch (error) {
      debugLog(`wakeMonitor error: ${getErrorMessage(error)}`);
    }
  };

  /**
   * Force Volume Utility
   */
  const forceVolume = async (force = false): Promise<void> => {
    if (!config.forceVolume || !shell) return;
    try {
      if (!force) {
        const currentVolume = await getCurrentVolume();
        const volumeThreshold = config.volumeThreshold || 50;
        if (currentVolume >= 0 && currentVolume >= volumeThreshold) return;
      }

      if (platform === 'darwin') {
        await shell`osascript -e "set volume output volume 100"`.quiet();
      }
    } catch (error) {
      debugLog(`forceVolume error: ${getErrorMessage(error)}`);
    }
  };

  /**
   * Main Speak function with fallback chain
   * Cascade: Primary Engine -> Edge TTS -> macOS Say -> Sound File
   *
   * Fallback ensures TTS works even if:
   * - Python edge-tts not installed (falls to npm package, then say)
   * - msedge-tts npm fails (403 errors - falls to say)
   * - User is on macOS without edge-tts (falls to built-in 'say' command)
   */
  const speak = async (message: string, options: SpeakOptions = {}): Promise<boolean> => {
    const activeConfig = { ...config, ...options } as PluginConfig & SpeakOptions;
    if (!activeConfig.enableSound) return false;

    if (activeConfig.enableTTS) {
      let success = false;
      const engine = activeConfig.ttsEngine || 'elevenlabs';

      if (engine === 'openai') {
        success = await speakWithOpenAI(message);
        if (!success) success = await speakWithEdgeTTS(message);
        if (!success) success = await speakWithSay(message); // macOS fallback
      } else if (engine === 'elevenlabs') {
        success = await speakWithElevenLabs(message);
        if (!success) success = await speakWithEdgeTTS(message);
        if (!success) success = await speakWithSay(message); // macOS fallback
      } else if (engine === 'edge') {
        success = await speakWithEdgeTTS(message);
        if (!success) success = await speakWithSay(message); // macOS fallback
      } else {
        success = await speakWithSay(message);
      }

      if (success) return true;
    }

    if (activeConfig.fallbackSound) {
      const soundPath = path.isAbsolute(activeConfig.fallbackSound)
        ? activeConfig.fallbackSound
        : path.join(getConfigDir(), activeConfig.fallbackSound);

      await playAudioFile(soundPath, activeConfig.loops || 1);
    }
    return false;
  };

  return {
    speak,
    announce: async (message: string, options: SpeakOptions = {}): Promise<boolean> => {
      await wakeMonitor();
      await forceVolume();
      return speak(message, options);
    },
    wakeMonitor,
    forceVolume,
    playAudioFile,
    config,
  };
};
