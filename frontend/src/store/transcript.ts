import { create } from 'zustand';
import * as api from '../lib/transcriptApi';
import type {
  TranscribeConfig,
  TranscribeEngine,
  Transcript,
  TranscriptJob,
  WhisperModel,
  WhisperModelDownload,
} from '../lib/transcriptApi';

interface TranscriptState {
  jobs: Record<number, TranscriptJob | undefined>;
  engine: TranscribeEngine | null;
  models: WhisperModel[];
  modelDownload: WhisperModelDownload | null;
  loadingEngine: boolean;
  load: (entryId: number) => Promise<void>;
  generate: (entryId: number, forceLocal?: boolean) => Promise<void>;
  cancel: (entryId: number) => Promise<void>;
  renameSpeaker: (entryId: number, speakerId: string, name: string) => Promise<void>;
  loadEngine: () => Promise<void>;
  saveEngine: (config: TranscribeConfig) => Promise<void>;
  loadModels: () => Promise<void>;
  downloadModel: (modelId: string) => Promise<void>;
  cancelModelDownload: () => Promise<void>;
  selectModel: (modelId: string) => Promise<void>;
}

const pollers = new Map<number, number>();
let modelPoller: number | null = null;

function active(job?: TranscriptJob) {
  return job?.status === 'queued' || job?.status === 'running';
}

function schedulePoll(entryId: number) {
  if (pollers.has(entryId)) return;
  const timer = window.setTimeout(async () => {
    pollers.delete(entryId);
    await useTranscript.getState().load(entryId);
    if (active(useTranscript.getState().jobs[entryId])) schedulePoll(entryId);
  }, 900);
  pollers.set(entryId, timer);
}

function scheduleModelPoll() {
  if (modelPoller !== null) return;
  modelPoller = window.setTimeout(async () => {
    modelPoller = null;
    try {
      const download = await api.getWhisperModelDownload();
      useTranscript.setState({ modelDownload: download });
      if (download.status === 'running') {
        scheduleModelPoll();
      } else if (download.status === 'done') {
        await Promise.all([
          useTranscript.getState().loadModels(),
          useTranscript.getState().loadEngine(),
        ]);
      }
    } catch (error) {
      useTranscript.setState({
        modelDownload: { modelId: '', status: 'error', progress: 0, downloaded: 0, total: 0, error: String(error) },
      });
    }
  }, 700);
}

export const useTranscript = create<TranscriptState>((set, get) => ({
  jobs: {},
  engine: null,
  models: [],
  modelDownload: null,
  loadingEngine: false,

  async load(entryId) {
    try {
      const job = await api.getTranscript(entryId);
      set({ jobs: { ...get().jobs, [entryId]: job } });
      if (active(job)) schedulePoll(entryId);
    } catch (error) {
      set({
        jobs: {
          ...get().jobs,
          [entryId]: { entryId, status: 'error', stage: '读取失败', progress: 0, error: String(error), transcript: null },
        },
      });
    }
  },

  async generate(entryId, forceLocal = false) {
    try {
      const job = await api.generateTranscript(entryId, forceLocal);
      set({ jobs: { ...get().jobs, [entryId]: job } });
      if (active(job)) schedulePoll(entryId);
    } catch (error) {
      set({
        jobs: {
          ...get().jobs,
          [entryId]: { entryId, status: 'error', stage: '无法开始', progress: 0, error: String(error), transcript: null },
        },
      });
    }
  },

  async cancel(entryId) {
    await api.cancelTranscript(entryId);
    const timer = pollers.get(entryId);
    if (timer) window.clearTimeout(timer);
    pollers.delete(entryId);
    set({ jobs: { ...get().jobs, [entryId]: { entryId, status: 'none', stage: '', progress: 0, error: '', transcript: null } } });
  },

  async renameSpeaker(entryId, speakerId, name) {
    const transcript = await api.renameTranscriptSpeaker(entryId, speakerId, name);
    const current = get().jobs[entryId];
    if (current) set({ jobs: { ...get().jobs, [entryId]: { ...current, transcript } } });
  },

  async loadEngine() {
    set({ loadingEngine: true });
    try {
      set({ engine: await api.getTranscribeEngine() });
    } finally {
      set({ loadingEngine: false });
    }
  },

  async saveEngine(config) {
    set({ loadingEngine: true });
    try {
      set({ engine: await api.saveTranscribeConfig(config) });
      await get().loadModels();
    } finally {
      set({ loadingEngine: false });
    }
  },

  async loadModels() {
    try {
      const [models, download] = await Promise.all([
        api.getWhisperModels(),
        api.getWhisperModelDownload(),
      ]);
      set({ models, modelDownload: download });
      if (download.status === 'running') scheduleModelPoll();
    } catch (error) {
      set({
        modelDownload: { modelId: '', status: 'error', progress: 0, downloaded: 0, total: 0, error: String(error) },
      });
    }
  },

  async downloadModel(modelId) {
    try {
      const download = await api.downloadWhisperModel(modelId);
      set({ modelDownload: download });
      if (download.status === 'running') scheduleModelPoll();
      else await Promise.all([get().loadModels(), get().loadEngine()]);
    } catch (error) {
      set({
        modelDownload: { modelId, status: 'error', progress: 0, downloaded: 0, total: 0, error: String(error) },
      });
    }
  },

  async cancelModelDownload() {
    await api.cancelWhisperModelDownload();
    if (modelPoller !== null) window.clearTimeout(modelPoller);
    modelPoller = null;
    set({ modelDownload: { modelId: '', status: 'idle', progress: 0, downloaded: 0, total: 0, error: '' } });
  },

  async selectModel(modelId) {
    set({ loadingEngine: true });
    try {
      set({ engine: await api.selectWhisperModel(modelId) });
      await get().loadModels();
    } finally {
      set({ loadingEngine: false });
    }
  },
}));

export function findTranscriptSegment(transcript: Transcript | null | undefined, seconds: number) {
  if (!transcript?.segments.length) return null;
  let lo = 0;
  let hi = transcript.segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const segment = transcript.segments[mid];
    if (seconds < segment.start) hi = mid - 1;
    else if (seconds > segment.end) lo = mid + 1;
    else return { segment, index: mid };
  }
  return null;
}
