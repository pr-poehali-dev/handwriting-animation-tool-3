import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Icon from "@/components/ui/icon";

type Tab = "font" | "draw" | "editor" | "animation" | "export" | "settings";
type AspectRatio = "16:9" | "9:16" | "4:3" | "1:1";
type AnimStyle = "stroke" | "fade" | "typewriter";
type LineCapStyle = "round" | "square" | "butt";
type ExportFormat = "mp4" | "webm" | "gif";

interface TextLayer {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "font", label: "Шрифт", icon: "Type" },
  { id: "draw", label: "Обрисовка", icon: "PenTool" },
  { id: "editor", label: "Редактор", icon: "Layers" },
  { id: "animation", label: "Анимация", icon: "Play" },
  { id: "export", label: "Экспорт", icon: "Download" },
  { id: "settings", label: "Настройки", icon: "Settings2" },
];

const SAMPLE_CHARS = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

const ASPECT_RATIOS: { id: AspectRatio; w: number; h: number; label: string }[] = [
  { id: "16:9", w: 1920, h: 1080, label: "Горизонтальное" },
  { id: "9:16", w: 1080, h: 1920, label: "Вертикальное" },
  { id: "4:3", w: 1440, h: 1080, label: "Классическое" },
  { id: "1:1", w: 1080, h: 1080, label: "Квадрат" },
];

const BUILTIN_FONTS = [
  { name: "Caveat", label: "Рукопись" },
  { name: "IBM Plex Sans", label: "Гротеск" },
  { name: "Pacifico", label: "Ретро" },
  { name: "Roboto", label: "Классика" },
];

function mkId() { return Math.random().toString(36).slice(2, 8); }

function getPreviewDims(ratio: AspectRatio, maxW: number, maxH: number) {
  const ar = ASPECT_RATIOS.find(r => r.id === ratio)!;
  const scale = Math.min(maxW / ar.w, maxH / ar.h);
  return { w: Math.round(ar.w * scale), h: Math.round(ar.h * scale), nativeW: ar.w, nativeH: ar.h };
}

export default function Index() {
  const [activeTab, setActiveTab] = useState<Tab>("editor");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [bgColor, setBgColor] = useState<string>("#000000");
  const [bgTransparent, setBgTransparent] = useState(false);
  const [fontName, setFontName] = useState("Caveat");
  const [uploadedFont, setUploadedFont] = useState<string | null>(null);
  const [selectedChar, setSelectedChar] = useState("А");
  const [strokes, setStrokes] = useState<{ x: number; y: number }[][]>([]);
  const [currentStroke, setCurrentStroke] = useState<{ x: number; y: number }[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lineWidth, setLineWidth] = useState(4);
  const [lineStyle, setLineStyle] = useState<LineCapStyle>("round");
  const [layers, setLayers] = useState<TextLayer[]>([
    { id: mkId(), text: "Привет, мир!", x: 50, y: 50, fontSize: 72, color: "#ffffff", fontFamily: "Caveat", bold: false, italic: false, align: "center" }
  ]);
  const [activeLayerId, setActiveLayerId] = useState<string>(layers[0].id);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [animStyle, setAnimStyle] = useState<AnimStyle>("stroke");
  const [speed, setSpeed] = useState(1.0);
  const [fps, setFps] = useState(30);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4");
  const [quality, setQuality] = useState<"720p" | "1080p" | "4K">("1080p");
  const [inkColor, setInkColor] = useState("#f5c842");
  const [pressure] = useState(true);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ w: 800, h: 450 });

  const activeLayer = layers.find(l => l.id === activeLayerId) ?? layers[0];

  // Compute preview dimensions
  useEffect(() => {
    const update = () => {
      if (!previewContainerRef.current) return;
      const rect = previewContainerRef.current.getBoundingClientRect();
      const dims = getPreviewDims(aspectRatio, rect.width - 32, rect.height - 80);
      setPreviewSize({ w: dims.w, h: dims.h });
    };
    update();
    const ro = new ResizeObserver(update);
    if (previewContainerRef.current) ro.observe(previewContainerRef.current);
    return () => ro.disconnect();
  }, [aspectRatio, activeTab]);

  // Redraw canvas
  const redrawPreview = useCallback((progressOverride?: number) => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!bgTransparent) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const progress = progressOverride ?? 1;

    layers.forEach(layer => {
      const scaleX = canvas.width / ASPECT_RATIOS.find(r => r.id === aspectRatio)!.w;
      const scaleY = canvas.height / ASPECT_RATIOS.find(r => r.id === aspectRatio)!.h;
      const px = (layer.x / 100) * canvas.width;
      const py = (layer.y / 100) * canvas.height;
      const fs = Math.round(layer.fontSize * Math.min(scaleX, scaleY));

      const weight = layer.bold ? "bold" : "normal";
      const style = layer.italic ? "italic" : "normal";
      ctx.font = `${style} ${weight} ${fs}px '${layer.fontFamily}', 'Caveat', cursive`;
      ctx.textAlign = layer.align;
      ctx.textBaseline = "middle";

      const chars = layer.text.split("");
      const visible = Math.floor(progress * chars.length);

      if (animStyle === "stroke" || progressOverride === undefined) {
        // typewriter/stroke: show chars progressively
        const fullText = progressOverride !== undefined ? layer.text.slice(0, visible) : layer.text;
        ctx.fillStyle = layer.color;
        ctx.globalAlpha = 1;
        ctx.fillText(fullText, px, py);
      } else if (animStyle === "fade") {
        chars.forEach((ch, i) => {
          if (i >= visible + 4) return;
          const alpha = Math.max(0, Math.min(1, (progress * chars.length - i) * 0.5));
          ctx.globalAlpha = alpha;
          ctx.fillStyle = layer.color;
          const measureCtx = ctx;
          const charsBefore = layer.text.slice(0, i);
          const charW = measureCtx.measureText(ch).width;
          const beforeW = measureCtx.measureText(charsBefore).width;
          const startX = layer.align === "center" ? px - measureCtx.measureText(layer.text).width / 2 : px;
          ctx.fillText(ch, startX + beforeW + charW / 2, py);
        });
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = layer.color;
        ctx.globalAlpha = 1;
        ctx.fillText(layer.text.slice(0, visible), px, py);
      }
    });
    ctx.globalAlpha = 1;
  }, [layers, bgColor, bgTransparent, aspectRatio, animStyle]);

  useEffect(() => {
    if (!isPlaying) redrawPreview();
  }, [redrawPreview, isPlaying]);

  // Animation loop
  const runAnimation = useCallback(() => {
    const maxChars = Math.max(...layers.map(l => l.text.length));
    const totalFrames = Math.round((maxChars * 18) / speed);
    let frame = 0;
    const step = () => {
      const progress = Math.min(frame / totalFrames, 1);
      setPlayProgress(progress);
      redrawPreview(progress);
      frame++;
      if (frame <= totalFrames + fps) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        setIsPlaying(false);
        setPlayProgress(1);
      }
    };
    animFrameRef.current = requestAnimationFrame(step);
  }, [layers, speed, fps, redrawPreview]);

  useEffect(() => {
    if (isPlaying) {
      cancelAnimationFrame(animFrameRef.current);
      setPlayProgress(0);
      runAnimation();
    } else {
      cancelAnimationFrame(animFrameRef.current);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying]);

  // Draw canvas redraw
  const redrawDrawCanvas = useCallback(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    [0.25, 0.5, 0.75].forEach(f => {
      ctx.beginPath(); ctx.moveTo(0, canvas.height * f); ctx.lineTo(canvas.width, canvas.height * f); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(canvas.width * f, 0); ctx.lineTo(canvas.width * f, canvas.height); ctx.stroke();
    });
    ctx.setLineDash([]);

    ctx.font = `${canvas.height * 0.65}px '${fontName}', 'Caveat', cursive`;
    ctx.fillStyle = "rgba(245,200,66,0.06)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(selectedChar, canvas.width / 2, canvas.height / 2);

    [...strokes, currentStroke].forEach(stroke => {
      if (stroke.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = inkColor;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = lineStyle;
      ctx.lineJoin = "round";
      ctx.moveTo(stroke[0].x, stroke[0].y);
      if (pressure && stroke.length > 3) {
        for (let i = 1; i < stroke.length - 1; i++) {
          const t = i / stroke.length;
          const w = lineWidth * (0.5 + Math.sin(t * Math.PI) * 0.5);
          ctx.lineWidth = w;
          ctx.lineTo(stroke[i].x, stroke[i].y);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(stroke[i].x, stroke[i].y);
        }
      } else {
        stroke.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();
      }
    });
  }, [strokes, currentStroke, selectedChar, inkColor, lineWidth, lineStyle, fontName, pressure]);

  useEffect(() => { redrawDrawCanvas(); }, [redrawDrawCanvas]);

  // Draw canvas mouse
  const getDrawPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = drawCanvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const onDrawDown = (e: React.MouseEvent<HTMLCanvasElement>) => { setIsDrawing(true); setCurrentStroke([getDrawPos(e)]); };
  const onDrawMove = (e: React.MouseEvent<HTMLCanvasElement>) => { if (!isDrawing) return; setCurrentStroke(s => [...s, getDrawPos(e)]); };
  const onDrawUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentStroke.length > 1) setStrokes(s => [...s, currentStroke]);
    setCurrentStroke([]);
  };

  // Dragging layers on preview
  const getPreviewPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = previewRef.current!;
    const r = c.getBoundingClientRect();
    return {
      px: ((e.clientX - r.left) / r.width) * 100,
      py: ((e.clientY - r.top) / r.height) * 100,
    };
  };
  const onPreviewMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTab !== "editor") return;
    const { px, py } = getPreviewPos(e);
    const hit = [...layers].reverse().find(l => {
      const dx = Math.abs(l.x - px);
      const dy = Math.abs(l.y - py);
      return dx < 15 && dy < 8;
    });
    if (hit) {
      setActiveLayerId(hit.id);
      setDraggingLayerId(hit.id);
      setDragOffset({ x: px - hit.x, y: py - hit.y });
    }
  };
  const onPreviewMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingLayerId) return;
    const { px, py } = getPreviewPos(e);
    setLayers(ls => ls.map(l => l.id === draggingLayerId ? { ...l, x: Math.max(5, Math.min(95, px - dragOffset.x)), y: Math.max(5, Math.min(95, py - dragOffset.y)) } : l));
  };
  const onPreviewMouseUp = () => setDraggingLayerId(null);

  const updateActiveLayer = (patch: Partial<TextLayer>) => {
    setLayers(ls => ls.map(l => l.id === activeLayerId ? { ...l, ...patch } : l));
  };

  const addLayer = () => {
    const newLayer: TextLayer = { id: mkId(), text: "Новый текст", x: 50, y: 60, fontSize: 64, color: "#ffffff", fontFamily: fontName, bold: false, italic: false, align: "center" };
    setLayers(ls => [...ls, newLayer]);
    setActiveLayerId(newLayer.id);
  };

  const removeLayer = (id: string) => {
    setLayers(ls => ls.filter(l => l.id !== id));
    if (activeLayerId === id) setActiveLayerId(layers.find(l => l.id !== id)?.id ?? "");
  };

  // Font upload
  const handleFontUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, "");
    new FontFace(name, `url(${url})`).load().then(loaded => {
      document.fonts.add(loaded);
      setUploadedFont(name);
      setFontName(name);
      updateActiveLayer({ fontFamily: name });
    });
  };

  // Export MP4/WebM via MediaRecorder
  const handleExport = useCallback(async () => {
    const canvas = previewRef.current;
    if (!canvas) return;
    setIsExporting(true);
    setExportProgress(0);

    const maxChars = Math.max(...layers.map(l => l.text.length));
    const totalFrames = Math.round((maxChars * 18) / speed) + fps;
    const mimeType = exportFormat === "mp4" ? "video/mp4" : exportFormat === "webm" ? "video/webm;codecs=vp9" : "video/webm";
    const actualMime = MediaRecorder.isTypeSupported(mimeType) ? mimeType : "video/webm";

    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: actualMime, videoBitsPerSecond: 8000000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: actualMime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `letterflow.${exportFormat === "mp4" ? "mp4" : "webm"}`;
      a.click();
      URL.revokeObjectURL(url);
      setIsExporting(false);
      setExportProgress(0);
    };

    recorder.start();
    let frame = 0;
    const render = () => {
      const progress = Math.min(frame / totalFrames, 1);
      setExportProgress(progress);
      redrawPreview(progress);
      frame++;
      if (frame <= totalFrames) {
        setTimeout(render, 1000 / fps);
      } else {
        recorder.stop();
      }
    };
    render();
  }, [layers, speed, fps, exportFormat, redrawPreview]);

  const previewAR = useMemo(() => {
    const ar = ASPECT_RATIOS.find(r => r.id === aspectRatio)!;
    return ar.w / ar.h;
  }, [aspectRatio]);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden select-none">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-border shrink-0 bg-card">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center shrink-0">
            <span className="font-handwriting text-primary-foreground text-xs font-bold leading-none">Lf</span>
          </div>
          <span className="font-semibold text-sm tracking-tight">LetterFlow</span>
          <span className="text-muted-foreground text-xs font-mono opacity-50">v0.2</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Aspect ratio */}
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            {ASPECT_RATIOS.map(ar => (
              <button key={ar.id} onClick={() => setAspectRatio(ar.id)}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-all ${aspectRatio === ar.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {ar.id}
              </button>
            ))}
          </div>
          <div className="w-1.5 h-1.5 rounded-full bg-primary pulse-dot" />
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border px-2 shrink-0">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium transition-colors relative
              ${activeTab === tab.id ? "text-primary tab-active" : "text-muted-foreground hover:text-foreground"}`}>
            <Icon name={tab.icon} size={13} fallback="Circle" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* =========== LEFT: PREVIEW (always visible) =========== */}
        <div ref={previewContainerRef} className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0f] overflow-hidden relative p-4">
          {/* Checkerboard for transparent bg */}
          <div className="relative" style={{ width: previewSize.w, height: previewSize.h }}>
            {bgTransparent && (
              <div className="absolute inset-0 rounded-lg overflow-hidden"
                style={{ backgroundImage: "repeating-conic-gradient(#2a2a2a 0% 25%, #1a1a1a 0% 50%) 0 0/20px 20px" }} />
            )}
            <canvas
              ref={previewRef}
              width={ASPECT_RATIOS.find(r => r.id === aspectRatio)!.w}
              height={ASPECT_RATIOS.find(r => r.id === aspectRatio)!.h}
              className={`absolute inset-0 w-full h-full rounded-lg ${activeTab === "editor" ? "cursor-move" : ""}`}
              style={{ outline: "1px solid rgba(255,255,255,0.08)" }}
              onMouseDown={onPreviewMouseDown}
              onMouseMove={onPreviewMouseMove}
              onMouseUp={onPreviewMouseUp}
              onMouseLeave={onPreviewMouseUp}
            />
          </div>

          {/* Playback bar */}
          <div className="flex items-center gap-3 mt-3 w-full max-w-[var(--preview-w,600px)]" style={{ maxWidth: previewSize.w }}>
            <button onClick={() => setIsPlaying(p => !p)}
              className="w-7 h-7 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors shrink-0">
              <Icon name={isPlaying ? "Pause" : "Play"} size={12} className="text-primary-foreground" fallback="Circle" />
            </button>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden cursor-pointer">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${playProgress * 100}%` }} />
            </div>
            <span className="text-xs font-mono text-muted-foreground w-8 text-right">{Math.round(playProgress * 100)}%</span>
            <span className="text-xs font-mono text-muted-foreground opacity-40">{aspectRatio}</span>
          </div>
        </div>

        {/* =========== RIGHT: PANELS =========== */}
        <div className="w-[340px] border-l border-border flex flex-col overflow-hidden shrink-0 bg-card">

          {/* ---- FONT TAB ---- */}
          {activeTab === "font" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Загрузить шрифт</div>
              <input ref={fileInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={handleFontUpload} />
              <button onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-6 flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <Icon name="Upload" size={24} fallback="Circle" />
                <div className="text-sm font-medium">{uploadedFont ? `✓ ${uploadedFont}` : "TTF / OTF / WOFF"}</div>
              </button>

              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Встроенные</div>
              <div className="grid grid-cols-2 gap-2">
                {BUILTIN_FONTS.map(f => (
                  <button key={f.name} onClick={() => { setFontName(f.name); updateActiveLayer({ fontFamily: f.name }); }}
                    className={`p-3 rounded-xl border text-left transition-all ${fontName === f.name && !uploadedFont ? "border-primary bg-primary/10" : "border-border"}`}>
                    <div style={{ fontFamily: f.name }} className="text-2xl text-foreground leading-none mb-1">Аа</div>
                    <div className="text-xs text-muted-foreground">{f.label}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ---- DRAW TAB ---- */}
          {activeTab === "draw" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Char grid */}
              <div className="h-40 border-b border-border overflow-y-auto p-2 shrink-0">
                <div className="grid grid-cols-8 gap-1">
                  {SAMPLE_CHARS.map(ch => (
                    <button key={ch} onClick={() => { setSelectedChar(ch); setStrokes([]); setCurrentStroke([]); }}
                      className={`w-8 h-8 rounded text-xs font-mono transition-all ${selectedChar === ch ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"}`}>
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
              {/* Drawing canvas */}
              <div className="flex-1 flex items-center justify-center p-3 bg-[#0a0a0f]">
                <canvas ref={drawCanvasRef} width={280} height={280}
                  style={{ background: "#0d0f14", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", cursor: "crosshair", width: "100%", maxWidth: 280, aspectRatio: "1/1" }}
                  onMouseDown={onDrawDown} onMouseMove={onDrawMove} onMouseUp={onDrawUp} onMouseLeave={onDrawUp} />
              </div>
              {/* Tools */}
              <div className="p-3 border-t border-border space-y-3 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-16">Толщина</span>
                  <input type="range" min={1} max={14} value={lineWidth} onChange={e => setLineWidth(+e.target.value)} className="flex-1 accent-amber-400" />
                  <span className="text-xs font-mono text-primary w-6">{lineWidth}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-16">Цвет</span>
                  <input type="color" value={inkColor} onChange={e => setInkColor(e.target.value)} className="w-8 h-8 rounded border-0 cursor-pointer" />
                  <span className="text-xs font-mono text-muted-foreground">{inkColor}</span>
                  <button onClick={() => { setStrokes([]); setCurrentStroke([]); }} className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                    <Icon name="Trash2" size={11} fallback="Circle" />Очистить
                  </button>
                </div>
                <div className="flex gap-1">
                  {(["round", "square", "butt"] as const).map(s => (
                    <button key={s} onClick={() => setLineStyle(s)}
                      className={`flex-1 py-1.5 rounded text-xs transition-all ${lineStyle === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {s === "round" ? "Круглый" : s === "square" ? "Кв." : "Плоский"}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">Штрихов: <span className="font-mono text-primary">{strokes.length}</span></div>
              </div>
            </div>
          )}

          {/* ---- EDITOR TAB ---- */}
          {activeTab === "editor" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Layers list */}
              <div className="border-b border-border shrink-0">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Слои</span>
                  <button onClick={addLayer} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors">
                    <Icon name="Plus" size={12} fallback="Circle" />Добавить
                  </button>
                </div>
                <div className="max-h-28 overflow-y-auto">
                  {layers.map(layer => (
                    <div key={layer.id} onClick={() => setActiveLayerId(layer.id)}
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${activeLayerId === layer.id ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-muted/40 border-l-2 border-transparent"}`}>
                      <Icon name="Type" size={11} fallback="Circle" className="text-muted-foreground shrink-0" />
                      <span className="text-xs flex-1 truncate text-foreground">{layer.text || "Пустой слой"}</span>
                      {layers.length > 1 && (
                        <button onClick={e => { e.stopPropagation(); removeLayer(layer.id); }}
                          className="opacity-0 group-hover:opacity-100 hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity">
                          <Icon name="X" size={11} fallback="Circle" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Active layer properties */}
              {activeLayer && (
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                  {/* Text */}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Текст</div>
                    <textarea
                      value={activeLayer.text}
                      onChange={e => updateActiveLayer({ text: e.target.value })}
                      rows={3}
                      style={{ fontFamily: activeLayer.fontFamily, color: activeLayer.color }}
                      className="w-full bg-muted/40 rounded-lg p-3 text-xl resize-none border border-border focus:border-primary/50 focus:outline-none transition-colors leading-relaxed"
                      placeholder="Введите текст..."
                    />
                  </div>

                  {/* Font */}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Шрифт</div>
                    <select value={activeLayer.fontFamily} onChange={e => updateActiveLayer({ fontFamily: e.target.value })}
                      className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50">
                      {uploadedFont && <option value={uploadedFont}>{uploadedFont} (загруженный)</option>}
                      {BUILTIN_FONTS.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                    </select>
                  </div>

                  {/* Size */}
                  <div>
                    <div className="flex justify-between mb-2">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Размер</div>
                      <span className="text-xs font-mono text-primary">{activeLayer.fontSize}px</span>
                    </div>
                    <input type="range" min={12} max={300} value={activeLayer.fontSize} onChange={e => updateActiveLayer({ fontSize: +e.target.value })}
                      className="w-full accent-amber-400" />
                  </div>

                  {/* Color */}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Цвет текста</div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <input type="color" value={activeLayer.color} onChange={e => updateActiveLayer({ color: e.target.value })}
                        className="w-9 h-9 rounded-lg cursor-pointer border-0" />
                      {["#ffffff", "#000000", "#f5c842", "#ff6b6b", "#74c0fc", "#69db7c", "#cc5de8", "#ff922b"].map(c => (
                        <button key={c} onClick={() => updateActiveLayer({ color: c })}
                          className={`w-6 h-6 rounded-full border-2 transition-all ${activeLayer.color === c ? "border-primary scale-110" : "border-transparent"}`}
                          style={{ background: c }} />
                      ))}
                    </div>
                  </div>

                  {/* Style */}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Стиль</div>
                    <div className="flex gap-2">
                      <button onClick={() => updateActiveLayer({ bold: !activeLayer.bold })}
                        className={`px-3 py-2 rounded-lg text-sm font-bold border transition-all ${activeLayer.bold ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground"}`}>
                        B
                      </button>
                      <button onClick={() => updateActiveLayer({ italic: !activeLayer.italic })}
                        className={`px-3 py-2 rounded-lg text-sm italic border transition-all ${activeLayer.italic ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground"}`}>
                        I
                      </button>
                      {(["left", "center", "right"] as const).map(a => (
                        <button key={a} onClick={() => updateActiveLayer({ align: a })}
                          className={`flex-1 py-2 rounded-lg border text-xs transition-all ${activeLayer.align === a ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>
                          <Icon name={a === "left" ? "AlignLeft" : a === "center" ? "AlignCenter" : "AlignRight"} size={13} fallback="Circle" className="mx-auto" />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Position */}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Позиция</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 flex justify-between"><span>X</span><span className="font-mono text-primary">{Math.round(activeLayer.x)}%</span></div>
                        <input type="range" min={0} max={100} value={activeLayer.x} onChange={e => updateActiveLayer({ x: +e.target.value })} className="w-full accent-amber-400" />
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 flex justify-between"><span>Y</span><span className="font-mono text-primary">{Math.round(activeLayer.y)}%</span></div>
                        <input type="range" min={0} max={100} value={activeLayer.y} onChange={e => updateActiveLayer({ y: +e.target.value })} className="w-full accent-amber-400" />
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-2 opacity-60">Или перетащите текст прямо на превью</div>
                  </div>

                  {/* Quick presets */}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Быстрые пресеты</div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: "Центр", x: 50, y: 50 },
                        { label: "Верх", x: 50, y: 15 },
                        { label: "Низ", x: 50, y: 85 },
                        { label: "Лево", x: 10, y: 50 },
                      ].map(p => (
                        <button key={p.label} onClick={() => updateActiveLayer({ x: p.x, y: p.y })}
                          className="px-2.5 py-1 text-xs border border-border rounded-full hover:border-primary/50 text-muted-foreground hover:text-primary transition-all">
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- ANIMATION TAB ---- */}
          {activeTab === "animation" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Стиль</div>
              <div className="space-y-2">
                {([
                  { id: "stroke", label: "Рукопись", desc: "Штрих за штрихом", icon: "PenLine" },
                  { id: "fade", label: "Растворение", desc: "Плавное появление", icon: "Sparkles" },
                  { id: "typewriter", label: "Машинка", desc: "Посимвольный вывод", icon: "Monitor" },
                ] as const).map(s => (
                  <button key={s.id} onClick={() => setAnimStyle(s.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${animStyle === s.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/30"}`}>
                    <Icon name={s.icon} size={16} fallback="Circle" className={animStyle === s.id ? "text-primary" : "text-muted-foreground"} />
                    <div>
                      <div className="text-sm font-medium">{s.label}</div>
                      <div className="text-xs text-muted-foreground">{s.desc}</div>
                    </div>
                    {animStyle === s.id && <Icon name="Check" size={14} className="ml-auto text-primary" fallback="Circle" />}
                  </button>
                ))}
              </div>

              <div className="flex justify-between items-center">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Скорость</div>
                <span className="text-xs font-mono text-primary">{speed.toFixed(1)}×</span>
              </div>
              <input type="range" min={0.2} max={4} step={0.1} value={speed} onChange={e => setSpeed(+e.target.value)} className="w-full accent-amber-400" />
              <div className="flex justify-between text-xs text-muted-foreground"><span>Медленно</span><span>Быстро</span></div>

              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">FPS</div>
              <div className="flex gap-2">
                {[24, 30, 60].map(f => (
                  <button key={f} onClick={() => setFps(f)}
                    className={`flex-1 py-2 rounded-lg text-xs font-mono border transition-all ${fps === f ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted text-foreground"}`}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ---- EXPORT TAB ---- */}
          {activeTab === "export" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Формат кадра</div>
              <div className="grid grid-cols-2 gap-2">
                {ASPECT_RATIOS.map(ar => (
                  <button key={ar.id} onClick={() => setAspectRatio(ar.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${aspectRatio === ar.id ? "border-primary bg-primary/10" : "border-border"}`}>
                    <div className={`text-sm font-mono font-bold ${aspectRatio === ar.id ? "text-primary" : "text-foreground"}`}>{ar.id}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{ar.label}</div>
                    <div className="text-xs font-mono text-muted-foreground/60">{ar.w}×{ar.h}</div>
                  </button>
                ))}
              </div>

              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Качество</div>
              <div className="flex gap-2">
                {(["720p", "1080p", "4K"] as const).map(q => (
                  <button key={q} onClick={() => setQuality(q)}
                    className={`flex-1 py-2 rounded-lg text-xs font-mono border transition-all ${quality === q ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground"}`}>
                    {q}
                  </button>
                ))}
              </div>

              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Формат файла</div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: "mp4", label: "MP4", desc: "H.264" },
                  { id: "webm", label: "WebM", desc: "VP9" },
                  { id: "gif", label: "GIF", desc: "Анимация" },
                ] as const).map(f => (
                  <button key={f.id} onClick={() => setExportFormat(f.id)}
                    className={`p-3 rounded-xl border text-center transition-all ${exportFormat === f.id ? "border-primary bg-primary/10" : "border-border"}`}>
                    <div className={`text-sm font-mono font-bold ${exportFormat === f.id ? "text-primary" : "text-foreground"}`}>{f.label}</div>
                    <div className="text-xs text-muted-foreground">{f.desc}</div>
                  </button>
                ))}
              </div>

              {/* Summary */}
              <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-2">
                {[
                  { l: "Кадр", v: aspectRatio },
                  { l: "Разрешение", v: `${ASPECT_RATIOS.find(r => r.id === aspectRatio)!.w}×${ASPECT_RATIOS.find(r => r.id === aspectRatio)!.h}` },
                  { l: "FPS", v: fps },
                  { l: "Скорость", v: `${speed.toFixed(1)}×` },
                  { l: "Слоёв", v: layers.length },
                ].map(row => (
                  <div key={row.l} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{row.l}</span>
                    <span className="font-mono text-foreground">{row.v}</span>
                  </div>
                ))}
              </div>

              {isExporting ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Рендеринг...</span>
                    <span className="font-mono text-primary">{Math.round(exportProgress * 100)}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${exportProgress * 100}%` }} />
                  </div>
                </div>
              ) : (
                <button onClick={handleExport}
                  className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all flex items-center justify-center gap-2">
                  <Icon name="Download" size={16} fallback="Circle" />
                  Рендерить и скачать {exportFormat.toUpperCase()}
                </button>
              )}
            </div>
          )}

          {/* ---- SETTINGS TAB ---- */}
          {activeTab === "settings" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Фон</div>
              <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                <div className="flex items-center justify-between p-3">
                  <div>
                    <div className="text-sm font-medium">Прозрачный фон</div>
                    <div className="text-xs text-muted-foreground">Экспорт с альфа-каналом</div>
                  </div>
                  <button onClick={() => setBgTransparent(p => !p)}
                    className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${bgTransparent ? "bg-primary" : "bg-border"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${bgTransparent ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
                {!bgTransparent && (
                  <div className="p-3">
                    <div className="text-xs text-muted-foreground mb-2">Цвет фона</div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                        className="w-9 h-9 rounded-lg cursor-pointer border-0" />
                      {["#000000", "#ffffff", "#0d0f14", "#1a1a2e", "#0f2027", "#1e1e2e"].map(c => (
                        <button key={c} onClick={() => setBgColor(c)}
                          className={`w-6 h-6 rounded-full border-2 transition-all ${bgColor === c ? "border-primary scale-110" : "border-border"}`}
                          style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Обрисовка</div>
              <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                <div className="p-3 flex items-center gap-3">
                  <span className="text-sm flex-1">Цвет штриха</span>
                  <input type="color" value={inkColor} onChange={e => setInkColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                  <span className="text-xs font-mono text-muted-foreground">{inkColor}</span>
                </div>
                <div className="p-3">
                  <div className="flex justify-between mb-2">
                    <span className="text-sm">Толщина линии</span>
                    <span className="text-xs font-mono text-primary">{lineWidth}px</span>
                  </div>
                  <input type="range" min={1} max={14} value={lineWidth} onChange={e => setLineWidth(+e.target.value)} className="w-full accent-amber-400" />
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 bg-muted/20">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">О программе</div>
                <div className="text-sm text-muted-foreground">LetterFlow v0.2</div>
                <div className="text-xs font-mono text-muted-foreground/50 mt-1">Рукописная анимация текста</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
