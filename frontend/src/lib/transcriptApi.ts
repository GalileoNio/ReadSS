import { Call } from '@wailsio/runtime';

const SERVICE = 'reads/internal/service.Service';

export type TranscriptStatus = 'none' | 'queued' | 'running' | 'done' | 'error';

export interface TranscriptSpeaker {
  id: string;
  name: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface Transcript {
  entryId: number;
  source: 'feed' | 'local';
  engine: string;
  language: string;
  speakers: TranscriptSpeaker[];
  segments: TranscriptSegment[];
  createdAt: number;
}

export interface TranscriptJob {
  entryId: number;
  status: TranscriptStatus;
  stage: string;
  progress: number;
  error: string;
  transcript: Transcript | null;
}

export interface TranscribeConfig {
  ffmpeg: string;
  whisper: string;
  whisperModel: string;
  diarizer: string;
  segmentationModel: string;
  embeddingModel: string;
  language: string;
  speakers: number;
  threads: number;
}

export interface TranscribeEngine {
  dir: string;
  config: TranscribeConfig;
  resolved: TranscribeConfig;
  ready: boolean;
  canDiarize: boolean;
  missing: string[];
}

export interface WhisperModel {
  id: string;
  name: string;
  description: string;
  filename: string;
  size: number;
  installed: boolean;
  active: boolean;
  bundled: boolean;
}

export interface WhisperModelDownload {
  modelId: string;
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  downloaded: number;
  total: number;
  error: string;
}

let bridge: Promise<boolean> | null = null;
const mockJobs = new Map<number, TranscriptJob>();
const speakerNames = new Map<string, string>();
const mockInstalledModels = new Set(['base-q5_1']);
let mockActiveModel = 'base-q5_1';
let mockModelDownload: WhisperModelDownload = { modelId: '', status: 'idle', progress: 0, downloaded: 0, total: 0, error: '' };

function hasBridge() {
  bridge ??= Call.ByName(`${SERVICE}.AppInfo`)
    .then((value) => !!value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string')
    .catch(() => false);
  return bridge;
}

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  if (await hasBridge()) return (await Call.ByName(`${SERVICE}.${method}`, ...args)) as T;
  return mock<T>(method, args);
}

function mock<T>(method: string, args: unknown[]): T {
  const entryId = Number(args[0] ?? 0);
  if (method === 'GetTranscribeEngine' || method === 'SaveTranscribeConfig' || method === 'SelectWhisperModel') {
    if (method === 'SelectWhisperModel') mockActiveModel = String(args[0]);
    const blank: TranscribeConfig = {
      ffmpeg: '', whisper: '', whisperModel: `C:\\ReadS\\asr\\models\\ggml-${mockActiveModel.replace('-', '-')}.bin`, diarizer: '', segmentationModel: '',
      embeddingModel: '', language: 'auto', speakers: 0, threads: 6,
    };
    return { dir: 'C:\\ReadS\\asr', config: blank, resolved: blank, ready: true, canDiarize: true, missing: [] } as T;
  }
  if (method === 'GetWhisperModels') {
    const catalog = [
      ['base-q5_1', '均衡 · Base', '内置推荐，低功耗设备优先', 59707625],
      ['small-q5_1', '准确 · Small', '中文准确度更高，速度适中', 190085487],
      ['medium-q5_0', '高精度 · Medium', '适合性能较强的电脑', 539212467],
      ['large-v3-turbo-q5_0', '最高精度 · Turbo', '资源占用最高，长节目更慢', 574041195],
    ];
    return catalog.map(([id, name, description, size]) => ({
      id, name, description, size, filename: `ggml-${id}.bin`,
      installed: mockInstalledModels.has(String(id)), active: id === mockActiveModel, bundled: id === 'base-q5_1',
    })) as T;
  }
  if (method === 'GetWhisperModelDownload') return mockModelDownload as T;
  if (method === 'DownloadWhisperModel') {
    const modelId = String(args[0]);
    mockInstalledModels.add(modelId);
    mockActiveModel = modelId;
    mockModelDownload = { modelId, status: 'done', progress: 100, downloaded: 1, total: 1, error: '' };
    return mockModelDownload as T;
  }
  if (method === 'CancelWhisperModelDownload') {
    mockModelDownload = { modelId: '', status: 'idle', progress: 0, downloaded: 0, total: 0, error: '' };
    return undefined as T;
  }
  if (method === 'GetTranscript') {
    return (mockJobs.get(entryId) ?? { entryId, status: 'none', stage: '', progress: 0, error: '', transcript: null }) as T;
  }
  if (method === 'GenerateTranscript') {
    const job = mockTranscript(entryId);
    mockJobs.set(entryId, job);
    return job as T;
  }
  if (method === 'CancelTranscript') {
    mockJobs.delete(entryId);
    return undefined as T;
  }
  if (method === 'RenameTranscriptSpeaker') {
    const job = mockJobs.get(entryId) ?? mockTranscript(entryId);
    const speakerId = String(args[1]);
    const name = String(args[2]);
    speakerNames.set(`${entryId}:${speakerId}`, name);
    const transcript = job.transcript!;
    transcript.speakers = transcript.speakers.map((s) => s.id === speakerId ? { ...s, name } : s);
    mockJobs.set(entryId, { ...job, transcript });
    return transcript as T;
  }
  throw new Error(`mock transcript backend has no handler for ${method}`);
}

function mockTranscript(entryId: number): TranscriptJob {
  const speakers = [
    { id: 's1', name: speakerNames.get(`${entryId}:s1`) ?? '主播' },
    { id: 's2', name: speakerNames.get(`${entryId}:s2`) ?? '嘉宾' },
  ];
  const segments: TranscriptSegment[] = [
    { start: 0, end: 7.5, speaker: 's1', text: '欢迎回来。今天想聊聊，为什么我们又重新开始使用 RSS。' },
    { start: 7.5, end: 15.2, speaker: 's2', text: '我觉得最重要的变化，是大家开始意识到注意力也需要预算。' },
    { start: 15.2, end: 24.8, speaker: 's1', text: '算法推荐确实方便，但订阅让选择权重新回到自己手里。' },
    { start: 24.8, end: 34.5, speaker: 's2', text: '而且播客很适合这个模式，你跟随的是长期信任的声音。' },
    { start: 34.5, end: 45.1, speaker: 's1', text: '没错。接下来我们从各自的阅读习惯开始聊起。' },
  ];
  return {
    entryId, status: 'done', stage: '字幕已就绪', progress: 100, error: '',
    transcript: { entryId, source: 'local', engine: 'whisper.cpp · sherpa-onnx 说话人分离', language: 'zh', speakers, segments, createdAt: Date.now() },
  };
}

export const getTranscript = (entryId: number) => call<TranscriptJob>('GetTranscript', entryId);
export const generateTranscript = (entryId: number, forceLocal = false) => call<TranscriptJob>('GenerateTranscript', entryId, forceLocal);
export const cancelTranscript = (entryId: number) => call<void>('CancelTranscript', entryId);
export const renameTranscriptSpeaker = (entryId: number, speakerId: string, name: string) =>
  call<Transcript>('RenameTranscriptSpeaker', entryId, speakerId, name);
export const getTranscribeEngine = () => call<TranscribeEngine>('GetTranscribeEngine');
export const saveTranscribeConfig = (config: TranscribeConfig) => call<TranscribeEngine>('SaveTranscribeConfig', config);
export const getWhisperModels = () => call<WhisperModel[]>('GetWhisperModels');
export const getWhisperModelDownload = () => call<WhisperModelDownload>('GetWhisperModelDownload');
export const downloadWhisperModel = (modelId: string) => call<WhisperModelDownload>('DownloadWhisperModel', modelId);
export const cancelWhisperModelDownload = () => call<void>('CancelWhisperModelDownload');
export const selectWhisperModel = (modelId: string) => call<TranscribeEngine>('SelectWhisperModel', modelId);
