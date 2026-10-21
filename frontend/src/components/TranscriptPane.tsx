import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Check,
  ChevronDown,
  ChevronUp,
  CircleStop,
  Cpu,
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

const speakerColors = [
  ['bg-[#ffe9e8]', 'text-[#d93e36]'],
  ['bg-[#e7f1ff]', 'text-[#326fca]'],
  ['bg-[#e9f7ee]', 'text-[#268354]'],
  ['bg-[#f4eaff]', 'text-[#8553bd]'],
  ['bg-[#fff1da]', 'text-[#a66a13]'],
] as const;

function colorFor(speakerId: string, speakers: TranscriptSpeaker[]) {
  const index = Math.max(0, speakers.findIndex((s) => s.id === speakerId));
  return speakerColors[index % speakerColors.length];
}

function speakerName(transcript: Transcript, id: string) {
  return transcript.speakers.find((s) => s.id === id)?.name ?? '未区分';
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
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#ff2442]/10 text-[#ff2442]">
          <AudioLines size={25} />
        </div>
        <h3 className="mt-4 text-[15px] font-semibold text-fg">分人字幕</h3>
        <p className="mt-2 max-w-[270px] text-callout leading-relaxed text-fg/45">
          优先读取节目自带文稿；没有文稿时，在本机识别音频并区分每位演讲人。
        </p>
        <button
          type="button"
          onClick={() => void generate(entry.id)}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-[#ff2442] px-5 text-callout font-semibold text-white transition-transform active:scale-95"
        >
          <Sparkles size={15} />
          获取字幕
        </button>
        <button type="button" onClick={() => setSetup((v) => !v)} className="mt-3 text-footnote text-fg/40 hover:text-fg/70">
          本机识别设置
        </button>
        {setup && <EngineSetup />}
      </div>
    );
  }

  if (job.status === 'queued' || job.status === 'running') {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center px-8 py-10 text-center">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-[#ff2442]/10 text-[#ff2442]">
          <AudioLines size={25} />
          <Loader2 size={62} className="absolute animate-spin opacity-35" strokeWidth={1.2} />
        </div>
        <h3 className="mt-4 text-[15px] font-semibold text-fg">{job.stage}</h3>
        <p className="mt-1 text-footnote tabular-nums text-fg/40">{job.progress}% · 可以继续收听</p>
        <div className="mt-4 h-1.5 w-52 overflow-hidden rounded-full bg-fill">
          <div className="h-full rounded-full bg-[#ff2442] transition-[width] duration-500" style={{ width: `${job.progress}%` }} />
        </div>
        <p className="mt-4 max-w-[260px] text-footnote leading-relaxed text-fg/35">
          首次本机识别会比较久，字幕完成后会保存在这台设备上。
        </p>
        <button type="button" onClick={() => void cancel(entry.id)} className="mt-4 inline-flex items-center gap-1.5 text-footnote text-fg/45 hover:text-fg/70">
          <CircleStop size={13} />取消
        </button>
      </div>
    );
  }

  if (job.status === 'error' || !transcript) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center px-8 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-fill text-fg/40"><Cpu size={21} /></div>
        <h3 className="mt-4 text-[15px] font-semibold text-fg">字幕没有生成</h3>
        <p className="mt-2 max-w-[300px] break-words text-callout leading-relaxed text-fg/45">{job.error}</p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => void generate(entry.id)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#ff2442] px-4 text-callout font-semibold text-white">
            <RefreshCw size={14} />重试
          </button>
          <button type="button" onClick={() => setSetup((v) => !v)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fill px-4 text-callout text-fg/65">
            <Settings2 size={14} />配置本机识别
          </button>
        </div>
        {setup && <EngineSetup />}
      </div>
    );
  }

  return (
    <div className="pb-4">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-5 py-2.5 backdrop-blur">
        <UsersRound size={14} className="text-[#ff2442]" />
        <span className="min-w-0 flex-1 truncate text-footnote text-fg/45">
          {transcript.speakers.length > 0 ? `${transcript.speakers.length} 位演讲人` : '字幕'} · {transcript.source === 'feed' ? '节目文稿' : '本机识别'}
        </span>
        <button type="button" title="重新生成本机字幕" onClick={() => void generate(entry.id, true)} className="icon-btn !h-7 !w-7 text-fg/35 hover:text-fg/65">
          <RefreshCw size={13} />
        </button>
      </div>

      {transcript.speakers.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
          {transcript.speakers.map((speaker) => {
            const [bg, fg] = colorFor(speaker.id, transcript.speakers);
            return renaming === speaker.id ? (
              <form
                key={speaker.id}
                className="flex h-8 items-center gap-1 rounded-full border border-[#ff2442]/30 bg-background pl-2 pr-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) void useTranscript.getState().renameSpeaker(entry.id, speaker.id, name.trim());
                  setRenaming(null);
                }}
              >
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="w-20 bg-transparent text-footnote outline-none" maxLength={32} />
                <button type="submit" className="flex h-6 w-6 items-center justify-center rounded-full text-[#ff2442]"><Check size={12} /></button>
              </form>
            ) : (
              <button
                key={speaker.id}
                type="button"
                title="修改演讲人名称"
                onClick={() => { setRenaming(speaker.id); setName(speaker.name); }}
                className={cn('group inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-footnote font-medium', bg, fg)}
              >
                <UserRound size={12} />{speaker.name}<Pencil size={10} className="opacity-0 transition-opacity group-hover:opacity-60" />
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
                'group flex w-full gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                isActive ? 'bg-[#ff2442]/[0.075]' : 'hover:bg-fill/60',
                showSpeaker && index > 0 && 'mt-2',
              )}
            >
              <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', segment.speaker ? `${bg} ${fg}` : 'bg-fill text-fg/35')}>
                {segment.speaker ? speakerName(transcript, segment.speaker).slice(0, 1) : '·'}
              </span>
              <span className="min-w-0 flex-1">
                {showSpeaker && <span className={cn('mb-0.5 block text-footnote font-medium', fg)}>{speakerName(transcript, segment.speaker)}</span>}
                <span className={cn('block text-callout leading-[1.65]', isActive ? 'font-medium text-fg' : 'text-fg/72')}>
                  {segment.text}
                </span>
                <span className="mt-1 flex items-center gap-1 text-[10px] tabular-nums text-fg/28 transition-colors group-hover:text-fg/45">
                  {isActive && playing && currentEntry ? <AudioLines size={10} className="text-[#ff2442]" /> : <Play size={9} />}
                  {formatClock(segment.start)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="px-5 pt-2 text-[10px] leading-relaxed text-fg/28">{transcript.engine}</p>
    </div>
  );
}

export function PlayerCaption({ entry }: { entry: Entry }) {
  const job = useTranscript((s) => s.jobs[entry.id]);
  const load = useTranscript((s) => s.load);
  const position = usePlayer((s) => s.entry?.id === entry.id ? s.position : 0);
  const current = findTranscriptSegment(job?.transcript, position);

  useEffect(() => { void load(entry.id); }, [entry.id, load]);
  if (!current || !job?.transcript) return null;

  const name = speakerName(job.transcript, current.segment.speaker);
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-3 pb-1 text-[11px] leading-tight">
      {current.segment.speaker && <span className="shrink-0 font-medium text-[#ff2442]">{name}</span>}
      <span className="truncate text-fg/60">{current.segment.text}</span>
    </div>
  );
}

function EngineSetup() {
  const engine = useTranscript((s) => s.engine);
  const loading = useTranscript((s) => s.loadingEngine);
  const loadEngine = useTranscript((s) => s.loadEngine);
  const saveEngine = useTranscript((s) => s.saveEngine);
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState<TranscribeConfig | null>(null);

  useEffect(() => { void loadEngine(); }, [loadEngine]);
  useEffect(() => { if (engine) setDraft(engine.config); }, [engine]);

  if (!engine || !draft) return <Loader2 size={17} className="mt-5 animate-spin text-fg/30" />;

  const update = (key: keyof TranscribeConfig, value: string | number) => setDraft({ ...draft, [key]: value });
  const fields: Array<[keyof TranscribeConfig, string, string]> = [
    ['ffmpeg', 'FFmpeg', 'ffmpeg.exe'],
    ['whisper', 'Whisper', 'whisper-cli.exe'],
    ['whisperModel', 'Whisper 模型', 'ggml-large-v3-turbo.bin'],
    ['diarizer', '说话人分离', 'sherpa-onnx-offline-speaker-diarization.exe'],
    ['segmentationModel', '分段模型', 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx'],
    ['embeddingModel', '声纹模型', '3dspeaker_speech_eres2net_base_sv_zh-cn/model.onnx'],
  ];

  return (
    <div className="mt-5 w-full max-w-[340px] rounded-2xl border border-border bg-fill/25 p-4 text-left">
      <div className="flex items-start gap-2.5">
        <Cpu size={17} className="mt-0.5 shrink-0 text-[#ff2442]" />
        <div className="min-w-0 flex-1">
          <p className="text-callout font-semibold text-fg">本机识别引擎</p>
          <p className="mt-1 break-all text-[10px] leading-relaxed text-fg/35">把程序和模型放入 {engine.dir}，可以保留解压后的文件夹结构。</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
        <span className={cn('rounded-full px-2 py-1', engine.ready ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>
          {engine.ready ? '语音识别已就绪' : `缺少 ${engine.missing.join('、')}`}
        </span>
        <span className={cn('rounded-full px-2 py-1', engine.canDiarize ? 'bg-emerald-500/10 text-emerald-600' : 'bg-fill text-fg/40')}>
          {engine.canDiarize ? '说话人分离已就绪' : '说话人分离未配置'}
        </span>
      </div>
      <button type="button" onClick={() => setAdvanced((v) => !v)} className="mt-3 flex w-full items-center justify-between text-footnote text-fg/50">
        手动指定路径 {advanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {advanced && (
        <div className="mt-3 space-y-2">
          {fields.map(([key, label, placeholder]) => (
            <label key={key} className="block">
              <span className="mb-1 block text-[10px] text-fg/40">{label}</span>
              <input value={String(draft[key])} placeholder={placeholder} onChange={(e) => update(key, e.target.value)} className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[11px] outline-none focus:border-[#ff2442]/50" />
            </label>
          ))}
          <div className="grid grid-cols-3 gap-2">
            <label className="block"><span className="mb-1 block text-[10px] text-fg/40">语言</span><input value={draft.language} onChange={(e) => update('language', e.target.value)} className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[11px] outline-none" /></label>
            <label className="block"><span className="mb-1 block text-[10px] text-fg/40">人数（0 自动）</span><input type="number" min={0} max={20} value={draft.speakers} onChange={(e) => update('speakers', Number(e.target.value))} className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[11px] outline-none" /></label>
            <label className="block"><span className="mb-1 block text-[10px] text-fg/40">线程</span><input type="number" min={1} max={64} value={draft.threads} onChange={(e) => update('threads', Number(e.target.value))} className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[11px] outline-none" /></label>
          </div>
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" disabled={loading} onClick={() => void loadEngine()} className="h-8 rounded-full px-3 text-footnote text-fg/50 hover:bg-fill">重新检测</button>
        {advanced && <button type="button" disabled={loading} onClick={() => void saveEngine(draft)} className="h-8 rounded-full bg-[#ff2442] px-3 text-footnote font-medium text-white disabled:opacity-50">保存</button>}
      </div>
    </div>
  );
}
