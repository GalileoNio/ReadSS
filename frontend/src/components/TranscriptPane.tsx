import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Check,
  ChevronDown,
  ChevronUp,
  CircleStop,
  Cpu,
  Download,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
  UserRound,
  UsersRound,
} from 'lucide-react';
import type { Entry } from '../lib/types';
import type { TranscribeConfig, Transcript, TranscriptSpeaker } from '../lib/transcriptApi';
import { formatClock } from '../lib/utils';
import { findTranscriptSegment, useTranscript } from '../store/transcript';
import { usePlayer } from '../store/player';
import { cn } from '../lib/utils';

const pill = 'inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-callout font-medium transition-colors disabled:pointer-events-none disabled:opacity-40';
const pillAccent = cn(pill, 'bg-accent text-white hover:bg-accent/90 active:bg-accent/80');
const pillFill = cn(pill, 'bg-fill text-fg/85 hover:bg-item-hover');
const pillGhost = cn(pill, 'text-fg/50 hover:bg-item-hover hover:text-fg/85');
const field = 'h-[30px] w-full rounded border border-border bg-background px-2 text-callout text-fg/85 outline-none focus:border-accent/50';

// Speaker hues distinguish voices; they are data colours, not brand colours.
const speakerColors = [
  ['bg-sky-500/10', 'text-sky-600 dark:text-sky-400'],
  ['bg-emerald-500/10', 'text-emerald-600 dark:text-emerald-400'],
  ['bg-violet-500/10', 'text-violet-600 dark:text-violet-400'],
  ['bg-amber-500/10', 'text-amber-600 dark:text-amber-400'],
  ['bg-rose-500/10', 'text-rose-600 dark:text-rose-400'],
] as const;

function colorFor(speakerId: string, speakers: TranscriptSpeaker[]) {
  const index = Math.max(0, speakers.findIndex((s) => s.id === speakerId));
  return speakerColors[index % speakerColors.length];
}

function speakerName(transcript: Transcript, id: string) {
  return transcript.speakers.find((s) => s.id === id)?.name ?? '未区分';
}

function speakerAvatar(transcript: Transcript, id: string) {
  const index = transcript.speakers.findIndex((s) => s.id === id);
  if (index < 0) return '·';
  const name = transcript.speakers[index].name;
  return /^说话人\s*\d+$/.test(name) ? String(index + 1) : name.slice(0, 1);
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-fill">
      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${value}%` }} />
    </div>
  );
}

export function TranscriptPane({ entry }: { entry: Entry }) {
  const job = useTranscript((s) => s.jobs[entry.id]);
  const load = useTranscript((s) => s.load);
  const generate = useTranscript((s) => s.generate);
  const cancel = useTranscript((s) => s.cancel);
  const position = usePlayer((s) => s.entry?.id === entry.id ? s.position : entry.audioPosition / 1000);
  const seek = usePlayer((s) => s.seek);
  const playEntry = usePlayer((s) => s.playEntry);
  const currentEntry = usePlayer((s) => s.entry?.id === entry.id);
  const playing = usePlayer((s) => s.playing);
  const [setup, setSetup] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    void load(entry.id);
  }, [entry.id, load]);

  const transcript = job?.transcript;
  const active = findTranscriptSegment(transcript, position);

  useEffect(() => {
    if (active) rowRefs.current.get(active.index)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active?.index]);

  const jump = (seconds: number) => {
    if (currentEntry) {
      seek(seconds);
    } else {
      void playEntry({ ...entry, audioPosition: Math.round(seconds * 1000) });
    }
  };

  if (!job || job.status === 'none') {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center px-8 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <AudioLines size={20} />
        </div>
        <p className="mt-3 text-headline text-fg/50">暂无字幕</p>
        <button type="button" onClick={() => void generate(entry.id)} className={cn(pillAccent, 'mt-4')}>
          <Sparkles size={14} />
          获取字幕
        </button>
        <button type="button" onClick={() => setSetup((v) => !v)} className={cn(pillGhost, 'mt-1')}>
          识别设置
        </button>
        {setup && <EngineSetup />}
      </div>
    );
  }

  if (!transcript) {
    if (job.status === 'queued' || job.status === 'running') {
      return (
        <div className="flex min-h-[360px] flex-col items-center justify-center px-8 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Loader2 size={20} className="animate-spin" />
          </div>
          <p className="mt-3 text-headline font-medium text-fg/85">{job.stage}</p>
          <p className="mt-1 text-footnote tabular-nums text-fg/50">{job.progress}%</p>
          <div className="mt-3 w-52">
            <ProgressBar value={job.progress} />
          </div>
          <button type="button" onClick={() => void cancel(entry.id)} className={cn(pillGhost, 'mt-3')}>
            <CircleStop size={14} />取消
          </button>
        </div>
      );
    }

    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center px-8 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-fill text-fg/50">
          <Cpu size={20} />
        </div>
        <p className="mt-3 text-headline text-fg/50" title={job.error}>字幕没有生成</p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => void generate(entry.id)} className={pillAccent}>
            <RefreshCw size={14} />重试
          </button>
          <button type="button" onClick={() => setSetup((v) => !v)} className={pillFill}>
            <Settings2 size={14} />识别设置
          </button>
        </div>
        {setup && <EngineSetup />}
      </div>
    );
  }

  return (
    <div className="pb-4">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-5 py-2 backdrop-blur">
        <UsersRound size={14} className="text-accent" />
        <span className="min-w-0 flex-1 truncate text-footnote text-fg/50">
          {transcript.speakers.length > 0 ? `${transcript.speakers.length} 位演讲人` : '字幕'} · {transcript.source === 'feed' ? '节目文稿' : '本机识别'}
        </span>
        <button type="button" title="重新生成" onClick={() => void generate(entry.id, true)} className="icon-btn">
          <RefreshCw size={14} />
        </button>
        <button type="button" title="识别设置" onClick={() => setSetup((v) => !v)} className={cn('icon-btn', setup && '!text-accent')}>
          <Settings2 size={14} />
        </button>
      </div>

      {setup && (
        <div className="flex justify-center border-b border-border bg-fill/25 px-5 pb-4">
          <EngineSetup />
        </div>
      )}

      {job.status === 'running' && (
        <div className="border-b border-border px-5 py-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
            <span className="min-w-0 flex-1 truncate text-footnote text-fg/50">{job.stage}</span>
            <span className="text-footnote tabular-nums text-fg/50">{job.progress}%</span>
            <button type="button" title="取消" onClick={() => void cancel(entry.id)} className="icon-btn !h-6 !w-6">
              <CircleStop size={14} />
            </button>
          </div>
          <ProgressBar value={job.progress} />
        </div>
      )}

      {job.status === 'error' && (
        <div className="flex items-center gap-2 border-b border-border bg-red-500/[0.05] px-5 py-2">
          <span className="min-w-0 flex-1 truncate text-footnote text-red-600/85 dark:text-red-400/85" title={job.error}>说话人分离没有完成</span>
          <button type="button" onClick={() => void generate(entry.id, true)} className="inline-flex shrink-0 items-center gap-1 text-footnote font-medium text-red-600/85 hover:text-red-600 dark:text-red-400/85">
            <RefreshCw size={12} />重试
          </button>
        </div>
      )}

      {transcript.speakers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-5 py-3">
          {transcript.speakers.map((speaker) => {
            const [bg, fg] = colorFor(speaker.id, transcript.speakers);
            return renaming === speaker.id ? (
              <form
                key={speaker.id}
                className="flex h-6 items-center gap-1 rounded-full border border-accent/40 bg-background pl-2 pr-0.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) void useTranscript.getState().renameSpeaker(entry.id, speaker.id, name.trim());
                  setRenaming(null);
                }}
              >
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="w-20 bg-transparent text-footnote outline-none" maxLength={32} />
                <button type="submit" className="flex h-5 w-5 items-center justify-center rounded-full text-accent"><Check size={12} /></button>
              </form>
            ) : (
              <button
                key={speaker.id}
                type="button"
                title="修改名称"
                onClick={() => { setRenaming(speaker.id); setName(speaker.name); }}
                className={cn('group inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-footnote font-medium', bg, fg)}
              >
                <UserRound size={12} />{speaker.name}<Pencil size={12} className="opacity-0 transition-opacity group-hover:opacity-60" />
              </button>
            );
          })}
        </div>
      )}

      <div className="px-3 py-2">
        {transcript.segments.map((segment, index) => {
          const isActive = active?.index === index;
          const previous = transcript.segments[index - 1];
          const showSpeaker = Boolean(segment.speaker) && previous?.speaker !== segment.speaker;
          const [bg, fg] = colorFor(segment.speaker, transcript.speakers);
          return (
            <button
              key={`${segment.start}-${index}`}
              ref={(node) => { if (node) rowRefs.current.set(index, node); else rowRefs.current.delete(index); }}
              type="button"
              onClick={() => jump(segment.start)}
              className={cn(
                'group flex w-full gap-3 rounded-card px-3 py-2.5 text-left transition-colors',
                isActive ? 'bg-accent/[0.06]' : 'hover:bg-item-hover',
                showSpeaker && index > 0 && 'mt-2',
              )}
            >
              <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-footnote font-semibold', segment.speaker ? `${bg} ${fg}` : 'bg-fill text-fg/50')}>
                {speakerAvatar(transcript, segment.speaker)}
              </span>
              <span className="min-w-0 flex-1">
                {showSpeaker && <span className={cn('mb-0.5 block text-footnote font-medium', fg)}>{speakerName(transcript, segment.speaker)}</span>}
                <span className={cn('block text-callout leading-[1.65] text-fg/85', isActive && 'font-medium')}>
                  {segment.text}
                </span>
                <span className={cn('mt-1 flex items-center gap-1 text-footnote tabular-nums transition-colors', isActive ? 'text-accent' : 'text-fg/25 group-hover:text-fg/50')}>
                  {isActive && playing && currentEntry ? <AudioLines size={12} /> : <Play size={12} />}
                  {formatClock(segment.start)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const FIELD_LABELS: Array<[keyof TranscribeConfig, string, string]> = [
  ['ffmpeg', '音频解码', 'ffmpeg.exe'],
  ['whisper', '语音识别', 'whisper-cli.exe'],
  ['whisperModel', '识别模型', 'ggml-large-v3-turbo.bin'],
  ['diarizer', '说话人分离', 'sherpa-onnx-offline-speaker-diarization.exe'],
  ['segmentationModel', '分段模型', 'model.onnx'],
  ['embeddingModel', '声纹模型', 'model.onnx'],
];

function EngineSetup() {
  const engine = useTranscript((s) => s.engine);
  const models = useTranscript((s) => s.models);
  const modelDownload = useTranscript((s) => s.modelDownload);
  const loading = useTranscript((s) => s.loadingEngine);
  const loadEngine = useTranscript((s) => s.loadEngine);
  const loadModels = useTranscript((s) => s.loadModels);
  const saveEngine = useTranscript((s) => s.saveEngine);
  const downloadModel = useTranscript((s) => s.downloadModel);
  const cancelModelDownload = useTranscript((s) => s.cancelModelDownload);
  const selectModel = useTranscript((s) => s.selectModel);
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState<TranscribeConfig | null>(null);

  useEffect(() => { void Promise.all([loadEngine(), loadModels()]); }, [loadEngine, loadModels]);
  useEffect(() => { if (engine) setDraft(engine.config); }, [engine]);

  if (!engine || !draft) return <Loader2 size={14} className="mt-5 animate-spin text-fg/25" />;

  const update = (key: keyof TranscribeConfig, value: string | number) => setDraft({ ...draft, [key]: value });

  return (
    <div className="mt-4 w-full max-w-[340px] rounded-panel border border-border bg-background p-4 text-left">
      <div className="flex items-center gap-2">
        <Cpu size={16} className="shrink-0 text-accent" />
        <p className="flex-1 text-headline font-semibold text-fg/85">本机识别</p>
        <button type="button" disabled={loading} title="重新检测" onClick={() => void loadEngine()} className="icon-btn !h-6 !w-6">
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span
          title={engine.ready ? undefined : engine.missing.join('、')}
          className={cn('chip', engine.ready ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400')}
        >
          {engine.ready ? '语音识别已就绪' : '语音识别未就绪'}
        </span>
        <span className={cn('chip', engine.canDiarize ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-fill text-fg/50')}>
          {engine.canDiarize ? '说话人分离已就绪' : '说话人分离未配置'}
        </span>
      </div>

      <p className="mb-2 mt-4 text-footnote font-medium text-fg/50">识别模型</p>
      <div className="space-y-1.5">
        {models.map((model) => {
          const downloading = modelDownload?.status === 'running' && modelDownload.modelId === model.id;
          const blocked = modelDownload?.status === 'running' && !downloading;
          const failed = modelDownload?.status === 'error' && modelDownload.modelId === model.id;
          return (
            <div key={model.id} className={cn('rounded-card border px-3 py-2.5', model.active ? 'border-accent/30 bg-accent/[0.04]' : 'border-border')}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-callout font-medium text-fg/85">{model.name}</span>
                    <span className="text-footnote tabular-nums text-fg/25">{Math.round(model.size / 1024 / 1024)} MB</span>
                  </div>
                  <p className="mt-0.5 text-footnote text-fg/50">{model.description}</p>
                </div>
                {model.active ? (
                  <span className="inline-flex h-7 items-center gap-1 px-1 text-footnote font-medium text-accent"><Check size={12} />使用中</span>
                ) : model.installed ? (
                  <button type="button" disabled={loading || blocked} onClick={() => void selectModel(model.id)} className={pillFill}>使用</button>
                ) : downloading ? (
                  <button type="button" onClick={() => void cancelModelDownload()} className={pillFill}><CircleStop size={12} />取消</button>
                ) : (
                  <button type="button" disabled={blocked} onClick={() => void downloadModel(model.id)} className={pillAccent}><Download size={12} />下载</button>
                )}
              </div>
              {downloading && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1"><ProgressBar value={modelDownload?.progress ?? 0} /></div>
                  <span className="text-footnote tabular-nums text-fg/50">{modelDownload?.progress ?? 0}%</span>
                </div>
              )}
              {failed && <p className="mt-1.5 text-footnote text-red-600/85 dark:text-red-400/85" title={modelDownload?.error}>下载没有完成</p>}
            </div>
          );
        })}
      </div>

      <button type="button" onClick={() => setAdvanced((v) => !v)} className="mt-3 flex w-full items-center justify-between py-1 text-footnote text-fg/50 hover:text-fg/85">
        高级 {advanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {advanced && (
        <div className="mt-2 space-y-2">
          {FIELD_LABELS.map(([key, label, placeholder]) => (
            <label key={key} className="block">
              <span className="mb-1 block text-footnote text-fg/50">{label}</span>
              <input value={String(draft[key])} placeholder={placeholder} onChange={(e) => update(key, e.target.value)} className={field} />
            </label>
          ))}
          <div className="grid grid-cols-3 gap-2">
            <label className="block"><span className="mb-1 block text-footnote text-fg/50">语言</span><input value={draft.language} onChange={(e) => update('language', e.target.value)} className={field} /></label>
            <label className="block"><span className="mb-1 block text-footnote text-fg/50">人数</span><input type="number" min={0} max={20} placeholder="自动" value={draft.speakers} onChange={(e) => update('speakers', Number(e.target.value))} className={field} /></label>
            <label className="block"><span className="mb-1 block text-footnote text-fg/50">线程</span><input type="number" min={1} max={64} value={draft.threads} onChange={(e) => update('threads', Number(e.target.value))} className={field} /></label>
          </div>
          <div className="flex justify-end pt-1">
            <button type="button" disabled={loading} onClick={() => void saveEngine(draft)} className={pillAccent}>保存</button>
          </div>
        </div>
      )}
    </div>
  );
}
