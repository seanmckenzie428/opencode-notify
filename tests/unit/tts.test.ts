// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import os from 'os';

const mockElevenLabsConvert = mock(() =>
  Promise.resolve({
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from('audio');
    },
  }),
);

const mockEdgeTTSSetMetadata = mock(() => Promise.resolve());
const mockEdgeTTSToFile = mock(() => Promise.resolve({ audioFilePath: 'edge-tts.mp3' }));

mock.module('@elevenlabs/elevenlabs-js', () => ({
  ElevenLabsClient: class {
    constructor() {
      this.textToSpeech = {
        convert: mockElevenLabsConvert,
      };
    }
  },
}));

mock.module('msedge-tts', () => ({
  MsEdgeTTS: class {
    constructor() {
      this.setMetadata = mockEdgeTTSSetMetadata;
      this.toFile = mockEdgeTTSToFile;
    }
  },
  OUTPUT_FORMAT: {
    AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3',
  },
}));

import { createTTS, getTTSConfig } from '../../src/util/tts.js';
import {
  createMockClient,
  createMockShellRunner,
  createTestConfig,
  createTestTempDir,
  cleanupTestTempDir,
} from '../setup.js';

describe('tts.js (macOS-only)', () => {
  let platformSpy;

  beforeEach(() => {
    createTestTempDir();
    platformSpy = spyOn(os, 'platform').mockReturnValue('darwin');
    mockElevenLabsConvert.mockClear();
    mockEdgeTTSSetMetadata.mockClear();
    mockEdgeTTSToFile.mockClear();
  });

  afterEach(() => {
    if (platformSpy) {
      platformSpy.mockRestore();
    }
    cleanupTestTempDir();
  });

  it('loads default config', () => {
    const config = getTTSConfig();
    expect(config.ttsEngine).toBe('elevenlabs');
    expect(config.enableTTS).toBe(true);
  });

  it('plays audio file with afplay', async () => {
    const shell = createMockShellRunner();
    const tts = createTTS({ $: shell, client: createMockClient() });

    await tts.playAudioFile('assets/test-sound.mp3');
    expect(shell.wasCalledWith('afplay')).toBe(true);
  });

  it('falls back when OpenAI endpoint is missing', async () => {
    createTestConfig({ openaiTtsEndpoint: '', ttsEngine: 'openai', enableSound: true, enableTTS: true });
    const shell = createMockShellRunner();
    const tts = createTTS({ $: shell, client: createMockClient() });

    const success = await tts.speak('hello', { ttsEngine: 'openai' });
    expect(success).toBe(true);
  });

  it('calls OpenAI endpoint when configured', async () => {
    createTestConfig({ openaiTtsEndpoint: 'http://localhost:8880', ttsEngine: 'openai', enableSound: true, enableTTS: true });

    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      }),
    );

    const shell = createMockShellRunner();
    const tts = createTTS({ $: shell, client: createMockClient() });
    await tts.speak('hello');

    expect(global.fetch).toHaveBeenCalled();
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('http://localhost:8880/v1/audio/speech');
  });

  it('uses ElevenLabs when configured', async () => {
    createTestConfig({ elevenLabsApiKey: 'key', ttsEngine: 'elevenlabs', enableSound: true, enableTTS: true });
    const shell = createMockShellRunner();
    const tts = createTTS({ $: shell, client: createMockClient() });

    await tts.speak('hello');
    expect(mockElevenLabsConvert).toHaveBeenCalled();
  });
});
