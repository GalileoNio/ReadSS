import { create } from 'zustand';
import * as api from '../lib/api';
import type { Entry } from '../lib/types';
import { useApp } from './app';

/** Player preferences are per device and irrelevant to the feed database. */
const RATE_KEY = 'reads.podcast.rate';
const SAVE_INTERVAL_MS = 6000;

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

function storedNumber(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* storage may be unavailable */
  }
}

interface PlayerState {
  /** The episode loaded in the audio element, if any. */
  entry: Entry | null;
  playing: boolean;
  /** Current position, in seconds. */
  position: number;
  duration: number;
  rate: number;
  muted: boolean;
  buffering: boolean;
  error: string | null;

  playEntry: (entry: Entry) => Promise<void>;
  toggle: () => Promise<void>;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  setRate: (rate: number) => void;
  toggleMute: () => void;
  stop: () => void;
}

let audio: HTMLAudioElement | null = null;
let bound = false;
/** Resume point waiting for the file's metadata before it can be applied. */
let pendingSeek = 0;
/** Whether the current episode has actually started; guards early saves. */
let started = false;
let lastSavedAt = 0;

function saveProgress(completed = false) {
  const { entry, position, duration } = usePlayer.getState();
  if (!entry) return;
  if (!started && !completed) return;
  const seconds = Math.max(0, Math.round(duration || entry.audioDuration || 0));
  const millis = Math.max(0, Math.round(position * 1000));
  const nearEnd = seconds > 0 && millis >= seconds * 1000 - 2000;
  const done = completed || nearEnd;
  void api.savePlayback(entry.id, millis, seconds, done).catch(() => undefined);
  useApp.getState().applyPlayback(entry.id, millis, seconds, done);
  lastSavedAt = Date.now();
}

function attach(el: HTMLAudioElement) {
  if (bound) return;
  bound = true;

  el.addEventListener('play', () => {
    started = true;
    usePlayer.setState({ playing: true, buffering: false, error: null });
  });
  el.addEventListener('pause', () => {
    usePlayer.setState({ playing: false });
    saveProgress();
  });
  el.addEventListener('waiting', () => usePlayer.setState({ buffering: true }));
  el.addEventListener('stalled', () => usePlayer.setState({ buffering: true }));
  el.addEventListener('playing', () => usePlayer.setState({ buffering: false }));
  el.addEventListener('canplay', () => usePlayer.setState({ buffering: false }));

  el.addEventListener('loadedmetadata', () => {
    if (pendingSeek > 0) {
      try {
        el.currentTime = pendingSeek;
      } catch {
        /* the file may not be seekable yet */
      }
      pendingSeek = 0;
    }
    if (Number.isFinite(el.duration) && el.duration > 0) {
      usePlayer.setState({ duration: el.duration });
    }
  });

  el.addEventListener('timeupdate', () => {
    if (!audio) return;
    const duration =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : usePlayer.getState().duration;
    usePlayer.setState({ position: audio.currentTime, duration });
    if (Date.now() - lastSavedAt >= SAVE_INTERVAL_MS) saveProgress();
  });

  el.addEventListener('ended', () => {
    const state = usePlayer.getState();
    usePlayer.setState({ playing: false, position: state.duration, buffering: false });
    saveProgress(true);
  });

  el.addEventListener('error', () => {
    usePlayer.setState({
      playing: false,
      buffering: false,
      error: '这一集暂时无法播放，可能是音频地址失效或网络不可用',
    });
  });
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'metadata';
    audio.playbackRate = storedNumber(RATE_KEY, 1);
    attach(audio);
  }
  return audio;
}

async function tryPlay(el: HTMLAudioElement) {
  try {
    await el.play();
  } catch {
    usePlayer.setState({
      playing: false,
      buffering: false,
      error: '播放被系统阻止，请再点一次播放',
    });
  }
}

export const usePlayer = create<PlayerState>((set, get) => ({
  entry: null,
  playing: false,
  position: 0,
  duration: 0,
  rate: storedNumber(RATE_KEY, 1),
  muted: false,
  buffering: false,
  error: null,

  async playEntry(entry) {
    if (!entry.audioUrl) {
      set({ error: '这条内容没有可播放的音频' });
      return;
    }
    const current = get().entry;
    if (current?.id === entry.id) {
      await get().toggle();
      return;
    }

    // Leaving an episode: keep its position before loading the next one.
    saveProgress();

    const el = getAudio();
    const resume =
      !entry.audioPlayed && entry.audioPosition > 2000 ? entry.audioPosition / 1000 : 0;
    const duration = entry.audioDuration || 0;
    pendingSeek = resume > 0 && (duration <= 0 || resume < duration - 3) ? resume : 0;
    started = false;
    lastSavedAt = Date.now();

    set({
      entry,
      playing: false,
      position: pendingSeek,
      duration,
      buffering: true,
      error: null,
    });

    el.src = entry.audioUrl;
    el.load();
    await tryPlay(el);
  },

  async toggle() {
    const el = getAudio();
    const { entry, playing } = get();
    if (!entry) return;
    if (playing) {
      el.pause();
      return;
    }
    if (el.ended) {
      el.currentTime = 0;
      set({ position: 0 });
    }
    await tryPlay(el);
  },

  seek(seconds) {
    const el = getAudio();
    const { entry, duration } = get();
    if (!entry) return;
    const max = duration > 0 ? duration : el.duration || 0;
    const next = Math.min(Math.max(0, seconds), max || seconds);
    try {
      el.currentTime = next;
    } catch {
      return;
    }
    set({ position: next, error: null });
    if (!get().playing) saveProgress();
  },

  skip(delta) {
    get().seek(get().position + delta);
  },

  setRate(rate) {
    const next = RATES.includes(rate) ? rate : 1;
    getAudio().playbackRate = next;
    remember(RATE_KEY, next);
    set({ rate: next });
  },

  toggleMute() {
    const el = getAudio();
    el.muted = !el.muted;
    set({ muted: el.muted });
  },

  stop() {
    saveProgress();
    const el = getAudio();
    el.pause();
    el.removeAttribute('src');
    el.load();
    started = false;
    pendingSeek = 0;
    set({
      entry: null,
      playing: false,
      position: 0,
      duration: 0,
      buffering: false,
      error: null,
    });
  },
}));

/** The rates offered by the speed button, in cycle order. */
export const PLAYBACK_RATES = RATES;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => saveProgress());
}
