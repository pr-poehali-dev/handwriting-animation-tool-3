import { useState, useRef, useEffect, useCallback } from "react";
import Icon from "@/components/ui/icon";

type Tab = "font" | "draw" | "editor" | "animation" | "export" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "font", label: "Шрифт", icon: "Type" },
  { id: "draw", label: "Обрисовка", icon: "PenTool" },
  { id: "editor", label: "Текст", icon: "FileText" },
  { id: "animation", label: "Анимация", icon: "Play" },
  { id: "export", label: "Экспорт", icon: "Download" },
  { id: "settings", label: "Настройки", icon: "Settings2" },
];

const SAMPLE_CHARS = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

export default function Index() {
  const [activeTab, setActiveTab] = useState<Tab>("font");
  const [text, setText] = useState("Привет, мир!");
  const [selectedChar, setSelectedChar] = useState("А");
  const [isDrawing, setIsDrawing] = useState(false);
  const [strokes, setStrokes] = useState<{ x: number; y: number }[][]>([]);
  const [currentStroke, setCurrentStroke] = useState<{ x: number; y: number }[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [lineWidth, setLineWidth] = useState(3);
  const [lineStyle, setLineStyle] = useState<"round" | "square" | "butt">("round");
  const [bgColor, setBgColor] = useState("#0d0f14");
  const [inkColor, setInkColor] = useState("#f5c842");
  const [quality, setQuality] = useState<"720p" | "1080p" | "4K">("1080p");
  const [fps, setFps] = useState(30);
  const [uploadedFont, setUploadedFont] = useState<string | null>(null);
  const [fontName, setFontName] = useState("Caveat");
  const [animStyle, setAnimStyle] = useState<"stroke" | "fade" | "typewriter">("stroke");
  const [pressure, setPressure] = useState(true);
  const [playProgress, setPlayProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    [0.25, 0.5, 0.75].forEach(f => {
      ctx.beginPath();
      ctx.moveTo(0, canvas.height * f);
      ctx.lineTo(canvas.width, canvas.height * f);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    ctx.font = `${canvas.height * 0.7}px 'Caveat', cursive`;
    ctx.fillStyle = "rgba(245,200,66,0.07)";
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
      stroke.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    });
  }, [strokes, currentStroke, selectedChar, inkColor, lineWidth, lineStyle]);

  useEffect(() => { redrawCanvas(); }, [redrawCanvas]);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    setCurrentStroke([getPos(e)]);
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setCurrentStroke(s => [...s, getPos(e)]);
  };
  const onMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentStroke.length > 1) setStrokes(s => [...s, currentStroke]);
    setCurrentStroke([]);
  };

  const runAnimation = useCallback(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const chars = text.split("");
    const totalFrames = Math.round((chars.length * 20) / speed);
    let frame = 0;

    const step = () => {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const progress = frame / totalFrames;
      setPlayProgress(Math.min(progress, 1));

      const visibleChars = Math.floor(progress * chars.length);

      ctx.font = `bold ${canvas.height * 0.35}px '${fontName}', 'Caveat', cursive`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      const totalW = ctx.measureText(text).width;
      let x = (canvas.width - totalW) / 2;
      const y = canvas.height / 2;

      chars.forEach((ch, i) => {
        const w = ctx.measureText(ch).width;
        if (i < visibleChars) {
          if (animStyle === "fade") {
            const alpha = Math.min(1, (progress * chars.length - i) * 3);
            ctx.globalAlpha = alpha;
          } else {
            ctx.globalAlpha = 1;
          }
          ctx.fillStyle = inkColor;
          ctx.fillText(ch, x, y);
          ctx.globalAlpha = 1;
        }
        x += w;
      });

      frame++;
      if (frame <= totalFrames + 10) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        setIsPlaying(false);
        setPlayProgress(1);
      }
    };
    animFrameRef.current = requestAnimationFrame(step);
  }, [text, speed, bgColor, inkColor, fontName, animStyle]);

  useEffect(() => {
    if (isPlaying) {
      cancelAnimationFrame(animFrameRef.current);
      setPlayProgress(0);
      runAnimation();
    } else {
      cancelAnimationFrame(animFrameRef.current);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, runAnimation]);

  useEffect(() => {
    if (isPlaying) return;
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `bold ${canvas.height * 0.35}px '${fontName}', 'Caveat', cursive`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = inkColor;
    ctx.globalAlpha = 0.9;
    ctx.fillText(text || "Ваш текст", canvas.width / 2, canvas.height / 2);
    ctx.globalAlpha = 1;
  }, [text, bgColor, inkColor, fontName, isPlaying]);

  const handleFontUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, "");
    const fontFace = new FontFace(name, `url(${url})`);
    fontFace.load().then(loaded => {
      document.fonts.add(loaded);
      setUploadedFont(url);
      setFontName(name);
    });
  };

  const clearCanvas = () => {
    setStrokes([]);
    setCurrentStroke([]);
  };

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
            <span className="font-handwriting text-primary-foreground text-sm font-bold leading-none">Lf</span>
          </div>
          <span className="font-semibold text-sm tracking-tight">LetterFlow</span>
          <span className="text-muted-foreground text-xs font-mono">v0.1</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary pulse-dot" />
          <span className="text-muted-foreground text-xs">Готов к работе</span>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border px-2 shrink-0 bg-card">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors relative
              ${activeTab === tab.id
                ? "text-primary tab-active"
                : "text-muted-foreground hover:text-foreground"
              }`}
          >
            <Icon name={tab.icon} size={14} fallback="Circle" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex animate-fade-in">

        {/* === FONT TAB === */}
        {activeTab === "font" && (
          <div className="flex-1 flex flex-col gap-0 overflow-hidden">
            <div className="flex-1 grid grid-cols-2 gap-0 overflow-hidden">
              <div className="border-r border-border flex flex-col p-6 gap-4 overflow-y-auto">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Загрузить шрифт</h2>
                <input ref={fileInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={handleFontUpload} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border hover:border-primary/50 rounded-lg p-8 flex flex-col items-center gap-3 text-muted-foreground hover:text-foreground transition-colors group"
                >
                  <Icon name="Upload" size={28} fallback="Circle" />
                  <div className="text-center">
                    <div className="text-sm font-medium">{uploadedFont ? `✓ ${fontName}` : "Загрузить файл шрифта"}</div>
                    <div className="text-xs mt-1 opacity-60">TTF, OTF, WOFF, WOFF2</div>
                  </div>
                </button>

                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Встроенные шрифты</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { name: "Caveat", label: "Рукопись" },
                    { name: "IBM Plex Sans", label: "Без засечек" },
                    { name: "Pacifico", label: "Ретро" },
                    { name: "Roboto", label: "Классика" },
                  ].map(f => (
                    <button
                      key={f.name}
                      onClick={() => setFontName(f.name)}
                      className={`p-3 rounded-lg border text-left transition-all ${fontName === f.name ? "border-primary bg-primary/10" : "border-border hover:border-border/80"}`}
                    >
                      <div style={{ fontFamily: f.name }} className="text-2xl leading-tight text-foreground">Аа</div>
                      <div className="text-xs text-muted-foreground mt-1">{f.label}</div>
                      <div className="text-xs font-mono text-muted-foreground/60">{f.name}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col p-6 gap-4 overflow-y-auto">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Предпросмотр</h2>
                <div className="flex-1 rounded-xl bg-muted/40 border border-border flex items-center justify-center min-h-[180px] p-8">
                  <span style={{ fontFamily: fontName, color: inkColor }} className="text-5xl leading-relaxed text-center break-all">
                    {text || "Привет!"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {["АаБбВв", "ЖжЗзИи", "123!?"].map(s => (
                    <div key={s} className="rounded-lg bg-muted/40 border border-border p-3 text-center" style={{ fontFamily: fontName, color: inkColor }}>
                      {s}
                    </div>
                  ))}
                </div>
                <div className="rounded-lg bg-muted/20 border border-border p-4">
                  <div className="text-xs text-muted-foreground mb-2">Активный шрифт</div>
                  <div className="font-mono text-sm text-primary">{fontName}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* === DRAW TAB === */}
        {activeTab === "draw" && (
          <div className="flex-1 flex overflow-hidden">
            <div className="w-44 border-r border-border flex flex-col overflow-hidden shrink-0">
              <div className="p-3 border-b border-border">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Символы</div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <div className="grid grid-cols-5 gap-1">
                  {SAMPLE_CHARS.map(ch => (
                    <button
                      key={ch}
                      onClick={() => { setSelectedChar(ch); clearCanvas(); }}
                      className={`w-7 h-7 rounded text-xs font-mono transition-all ${selectedChar === ch ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"}`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-handwriting text-primary">{selectedChar}</span>
                  <span className="text-xs text-muted-foreground">обрисуйте символ</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setStrokes(s => s.slice(0, -1))} className="px-3 py-1.5 text-xs border border-border rounded hover:bg-muted transition-colors flex items-center gap-1">
                    <Icon name="Undo2" size={11} fallback="Circle" />Отменить
                  </button>
                  <button onClick={clearCanvas} className="px-3 py-1.5 text-xs border border-border rounded hover:bg-muted transition-colors flex items-center gap-1">
                    <Icon name="Trash2" size={11} fallback="Circle" />Очистить
                  </button>
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center p-6 bg-muted/10">
                <canvas
                  ref={canvasRef}
                  width={400}
                  height={400}
                  className="canvas-draw rounded-xl border border-border"
                  style={{ background: bgColor, maxHeight: "100%", maxWidth: "100%", aspectRatio: "1/1" }}
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                  onMouseUp={onMouseUp}
                  onMouseLeave={onMouseUp}
                />
              </div>
            </div>

            <div className="w-52 border-l border-border flex flex-col p-4 gap-5 overflow-y-auto shrink-0">
              <div>
                <div className="flex justify-between mb-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Толщина</div>
                  <span className="text-xs font-mono text-primary">{lineWidth}px</span>
                </div>
                <input type="range" min={1} max={12} value={lineWidth} onChange={e => setLineWidth(+e.target.value)}
                  className="w-full accent-amber-400" />
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Кончик</div>
                {(["round", "square", "butt"] as const).map(s => (
                  <button key={s} onClick={() => setLineStyle(s)}
                    className={`w-full text-left px-3 py-2 rounded text-xs mb-1 transition-all ${lineStyle === s ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"}`}>
                    {s === "round" ? "Круглый" : s === "square" ? "Квадратный" : "Плоский"}
                  </button>
                ))}
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Цвет</div>
                <div className="flex items-center gap-2">
                  <input type="color" value={inkColor} onChange={e => setInkColor(e.target.value)}
                    className="w-9 h-9 rounded-lg cursor-pointer border-0 bg-transparent" />
                  <span className="text-xs font-mono text-muted-foreground">{inkColor}</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Нажим</div>
                  <button onClick={() => setPressure(p => !p)}
                    className={`w-9 h-5 rounded-full transition-all relative shrink-0 ${pressure ? "bg-primary" : "bg-border"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${pressure ? "left-4" : "left-0.5"}`} />
                  </button>
                </div>
                <div className="text-xs text-muted-foreground">Имитация давления пера</div>
              </div>
              <div className="pt-2 border-t border-border">
                <div className="text-xs text-muted-foreground">
                  Штрихов: <span className="font-mono text-primary">{strokes.length}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* === EDITOR TAB === */}
        {activeTab === "editor" && (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col p-6 gap-5 border-r border-border overflow-y-auto">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Текст для анимации</h2>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Введите текст..."
                rows={5}
                style={{ fontFamily: fontName, color: inkColor }}
                className="w-full bg-muted/40 rounded-xl p-5 text-2xl resize-none border border-border focus:border-primary/50 focus:outline-none transition-colors leading-relaxed"
              />
              <div className="flex gap-2 flex-wrap">
                {["Привет, мир!", "С Новым годом!", "С днём рождения!", "Поздравляем!"].map(s => (
                  <button key={s} onClick={() => setText(s)}
                    className="px-3 py-1.5 text-xs border border-border rounded-full hover:border-primary/50 hover:text-primary transition-all text-muted-foreground">
                    {s}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg bg-muted/40 border border-border p-4">
                  <div className="text-xs text-muted-foreground mb-1">Символов</div>
                  <div className="text-3xl font-mono text-primary">{text.length}</div>
                </div>
                <div className="rounded-lg bg-muted/40 border border-border p-4">
                  <div className="text-xs text-muted-foreground mb-1">Слов</div>
                  <div className="text-3xl font-mono text-primary">{text.trim() ? text.trim().split(/\s+/).length : 0}</div>
                </div>
                <div className="rounded-lg bg-muted/40 border border-border p-4">
                  <div className="text-xs text-muted-foreground mb-1">Строк</div>
                  <div className="text-3xl font-mono text-primary">{text.split("\n").length}</div>
                </div>
              </div>
            </div>

            <div className="w-72 flex flex-col p-4 gap-3 overflow-y-auto shrink-0">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Превью</div>
              <div className="rounded-xl overflow-hidden border border-border" style={{ background: bgColor, aspectRatio: "16/9" }}>
                <canvas ref={previewRef} width={640} height={360} className="w-full h-full" />
              </div>
              <button
                onClick={() => setIsPlaying(p => !p)}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Icon name={isPlaying ? "Pause" : "Play"} size={14} fallback="Circle" />
                {isPlaying ? "Пауза" : "Воспроизвести"}
              </button>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all rounded-full" style={{ width: `${playProgress * 100}%` }} />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground font-mono">
                <span>0:00</span>
                <span>{Math.round(playProgress * 100)}%</span>
              </div>
            </div>
          </div>
        )}

        {/* === ANIMATION TAB === */}
        {activeTab === "animation" && (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col p-6 gap-6 border-r border-border overflow-y-auto">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Стиль анимации</h2>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { id: "stroke", label: "Письмо", desc: "Посимвольная прорисовка", icon: "PenLine" },
                  { id: "fade", label: "Растворение", desc: "Плавное появление", icon: "Sparkles" },
                  { id: "typewriter", label: "Машинка", desc: "Печатный стиль", icon: "Monitor" },
                ] as const).map(s => (
                  <button key={s.id} onClick={() => setAnimStyle(s.id)}
                    className={`rounded-xl p-4 border text-left transition-all ${animStyle === s.id ? "border-primary bg-primary/10" : "border-border hover:border-border/80"}`}>
                    <Icon name={s.icon} size={18} fallback="Circle" className={`mb-3 ${animStyle === s.id ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.desc}</div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex justify-between mb-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Скорость</div>
                    <div className="text-xs font-mono text-primary">{speed.toFixed(1)}×</div>
                  </div>
                  <input type="range" min={0.2} max={3} step={0.1} value={speed} onChange={e => setSpeed(+e.target.value)}
                    className="w-full accent-amber-400" />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Медленно</span><span>Быстро</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">FPS</div>
                  <div className="flex gap-2">
                    {[24, 30, 60].map(f => (
                      <button key={f} onClick={() => setFps(f)}
                        className={`flex-1 py-2 rounded-lg text-xs font-mono border transition-all ${fps === f ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted text-foreground"}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Фон</div>
                <div className="flex items-center gap-4">
                  <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border-0" />
                  <div className="flex gap-2">
                    {["#0d0f14", "#ffffff", "#1a1a2e", "#0f2027", "#2d1b00"].map(c => (
                      <button key={c} onClick={() => setBgColor(c)}
                        className={`w-8 h-8 rounded-lg border-2 transition-all ${bgColor === c ? "border-primary scale-110" : "border-transparent"}`}
                        style={{ background: c }} />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Цвет текста</div>
                <div className="flex items-center gap-4">
                  <input type="color" value={inkColor} onChange={e => setInkColor(e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border-0" />
                  <div className="flex gap-2">
                    {["#f5c842", "#ffffff", "#ff6b6b", "#74c0fc", "#69db7c"].map(c => (
                      <button key={c} onClick={() => setInkColor(c)}
                        className={`w-8 h-8 rounded-lg border-2 transition-all ${inkColor === c ? "border-primary scale-110" : "border-transparent"}`}
                        style={{ background: c }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="w-72 flex flex-col p-4 gap-3 overflow-y-auto shrink-0">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Превью</div>
              <div className="rounded-xl overflow-hidden border border-border" style={{ background: bgColor, aspectRatio: "16/9" }}>
                <canvas ref={previewRef} width={640} height={360} className="w-full h-full" />
              </div>
              <button onClick={() => setIsPlaying(p => !p)}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                <Icon name={isPlaying ? "Square" : "Play"} size={14} fallback="Circle" />
                {isPlaying ? "Стоп" : "Запустить"}
              </button>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all rounded-full" style={{ width: `${playProgress * 100}%` }} />
              </div>
            </div>
          </div>
        )}

        {/* === EXPORT TAB === */}
        {activeTab === "export" && (
          <div className="flex-1 flex flex-col p-8 gap-6 overflow-y-auto max-w-2xl mx-auto w-full">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Экспорт видео</h2>

            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Качество</div>
              <div className="grid grid-cols-3 gap-3">
                {(["720p", "1080p", "4K"] as const).map(q => (
                  <button key={q} onClick={() => setQuality(q)}
                    className={`p-4 rounded-xl border text-center transition-all ${quality === q ? "border-primary bg-primary/10" : "border-border hover:border-border/80"}`}>
                    <div className={`text-xl font-mono font-bold ${quality === q ? "text-primary" : "text-foreground"}`}>{q}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {q === "720p" ? "1280×720" : q === "1080p" ? "1920×1080" : "3840×2160"}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border p-5 bg-muted/20 space-y-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Параметры рендера</div>
              {[
                { label: "Разрешение", value: quality === "720p" ? "1280×720" : quality === "1080p" ? "1920×1080" : "3840×2160" },
                { label: "Частота кадров", value: `${fps} fps` },
                { label: "Шрифт", value: fontName },
                { label: "Стиль", value: animStyle === "stroke" ? "Письмо" : animStyle === "fade" ? "Растворение" : "Машинка" },
                { label: "Скорость", value: `${speed.toFixed(1)}×` },
                { label: "Текст", value: `"${text.slice(0, 28)}${text.length > 28 ? "…" : ""}"` },
              ].map(row => (
                <div key={row.label} className="flex justify-between text-sm border-t border-border/50 pt-3 first:border-0 first:pt-0">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-mono text-foreground">{row.value}</span>
                </div>
              ))}
            </div>

            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Формат</div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { fmt: "MP4", codec: "H.264" },
                  { fmt: "WebM", codec: "VP9" },
                  { fmt: "GIF", codec: "Анимация" },
                ].map(f => (
                  <button key={f.fmt} className="p-4 rounded-xl border border-border hover:border-primary/40 transition-all text-center">
                    <div className="text-sm font-mono font-bold text-foreground">{f.fmt}</div>
                    <div className="text-xs text-muted-foreground mt-1">{f.codec}</div>
                  </button>
                ))}
              </div>
            </div>

            <button className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-semibold text-base hover:bg-primary/90 transition-all flex items-center justify-center gap-3">
              <Icon name="Download" size={18} fallback="Circle" />
              Рендерить и скачать
            </button>
            <p className="text-xs text-muted-foreground text-center">Рендер видео будет доступен в следующей версии</p>
          </div>
        )}

        {/* === SETTINGS TAB === */}
        {activeTab === "settings" && (
          <div className="flex-1 flex flex-col p-8 gap-6 overflow-y-auto max-w-2xl mx-auto w-full">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Общие настройки</h2>

            <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
              {[
                {
                  label: "Цвет чернил",
                  desc: "Цвет рукописного текста в анимации",
                  control: <div className="flex items-center gap-2">
                    <input type="color" value={inkColor} onChange={e => setInkColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                    <span className="text-xs font-mono text-muted-foreground">{inkColor}</span>
                  </div>
                },
                {
                  label: "Цвет фона",
                  desc: "Фон итогового видео",
                  control: <div className="flex items-center gap-2">
                    <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                    <span className="text-xs font-mono text-muted-foreground">{bgColor}</span>
                  </div>
                },
                {
                  label: "Толщина линии",
                  desc: "Толщина штриха при обрисовке символов",
                  control: <div className="flex items-center gap-3">
                    <input type="range" min={1} max={12} value={lineWidth} onChange={e => setLineWidth(+e.target.value)} className="w-24 accent-amber-400" />
                    <span className="text-xs font-mono text-primary w-8">{lineWidth}px</span>
                  </div>
                },
                {
                  label: "Скорость анимации",
                  desc: "Множитель скорости появления текста",
                  control: <div className="flex items-center gap-3">
                    <input type="range" min={0.2} max={3} step={0.1} value={speed} onChange={e => setSpeed(+e.target.value)} className="w-24 accent-amber-400" />
                    <span className="text-xs font-mono text-primary w-8">{speed.toFixed(1)}×</span>
                  </div>
                },
                {
                  label: "Имитация нажима",
                  desc: "Переменная толщина штриха как у настоящего пера",
                  control: <button onClick={() => setPressure(p => !p)}
                    className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${pressure ? "bg-primary" : "bg-border"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${pressure ? "left-5" : "left-0.5"}`} />
                  </button>
                },
              ].map((row, i) => (
                <div key={i} className="flex items-center justify-between p-4">
                  <div>
                    <div className="text-sm font-medium">{row.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{row.desc}</div>
                  </div>
                  <div className="ml-6 shrink-0">{row.control}</div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-border p-5 bg-muted/20">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">О программе</div>
              <div className="space-y-1">
                <div className="text-sm text-foreground">LetterFlow — редактор рукописной анимации</div>
                <div className="text-xs font-mono text-muted-foreground">Версия 0.1 · Первая сборка</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
