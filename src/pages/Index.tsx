import { useState, useRef, useEffect, useCallback } from "react";
import Icon from "@/components/ui/icon";

type Tab = "font" | "draw" | "editor" | "animation" | "export" | "settings";
type AspectRatio = "16:9" | "9:16" | "4:3" | "1:1";
type AnimStyle = "handwrite" | "fade" | "typewriter";
type LineCapStyle = "round" | "square" | "butt";
type ExportFormat = "mp4" | "webm";

interface TextLayer {
  id: string;
  text: string;
  x: number; // % of canvas
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
  return { w: Math.round(ar.w * scale), h: Math.round(ar.h * scale) };
}

// ─── Кеши для handwrite анимации ──────────────────────────────────────────────
// Ключ: `${char}|${fontStr}`
// Значение: массив «штрихов» — каждый штрих это непрерывная полилиния точек
const strokeCache = new Map<string, Array<Array<{ x: number; y: number }>>>();
// Offscreen canvas с символом (для clip-рендера)
const offscreenCache = new Map<string, { canvas: HTMLCanvasElement; padX: number; midY: number }>();

/**
 * Строим скелет буквы через медиальную ось (thinning).
 *
 * Алгоритм:
 * 1. Рендерим символ в offscreen canvas.
 * 2. Получаем бинарную маску заполненных пикселей.
 * 3. Итеративно убираем граничные пиксели (Zhang-Suen thinning) — получаем 1px-скелет.
 * 4. Из скелета извлекаем связные штрихи (DFS по 8-связности).
 * 5. Штрихи упорядочиваются слева направо, как при реальном письме.
 *
 * Результат: массив штрихов, каждый штрих — полилиния центральной оси буквы.
 * Шрифт при анимации НЕ меняется — используется только для clip-маски.
 */
function buildStrokes(ch: string, fontStr: string, fs: number): Array<Array<{ x: number; y: number }>> {
  const key = `${ch}|${fontStr}`;
  if (strokeCache.has(key)) return strokeCache.get(key)!;

  const PAD = Math.ceil(fs * 0.2);
  const W = Math.ceil(fs * 1.8) + PAD * 2;
  const H = Math.ceil(fs * 1.6) + PAD * 2;

  const off = document.createElement("canvas");
  off.width = W; off.height = H;
  const oc = off.getContext("2d", { willReadFrequently: true })!;
  oc.clearRect(0, 0, W, H);
  oc.font = fontStr;
  oc.textBaseline = "middle";
  oc.textAlign = "left";
  oc.fillStyle = "#fff";
  oc.fillText(ch, PAD, H / 2);

  const raw = oc.getImageData(0, 0, W, H).data;
  // Бинарная маска: true = заполнен
  const grid: Uint8Array = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) grid[i] = raw[i * 4 + 3] > 48 ? 1 : 0;

  const idx = (x: number, y: number) => y * W + x;
  const g = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H) ? grid[idx(x, y)] : 0;

  // ── Zhang-Suen thinning ──────────────────────────────────────────
  // Упрощённая версия: итеративно снимаем граничные пиксели пока скелет не стабилизируется
  let changed = true;
  const toRemove: number[] = [];

  const neighbors8 = (x: number, y: number) => [
    g(x,y-1), g(x+1,y-1), g(x+1,y), g(x+1,y+1),
    g(x,y+1), g(x-1,y+1), g(x-1,y), g(x-1,y-1),
  ];

  const transitions = (ns: number[]) => {
    let t = 0;
    for (let i = 0; i < 8; i++) if (ns[i] === 0 && ns[(i+1)%8] === 1) t++;
    return t;
  };

  for (let iter = 0; iter < 40 && changed; iter++) {
    changed = false;
    // Проход 1
    toRemove.length = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!grid[idx(x,y)]) continue;
        const ns = neighbors8(x, y);
        const sum = ns.reduce((a, b) => a + b, 0);
        if (sum < 2 || sum > 6) continue;
        if (transitions(ns) !== 1) continue;
        if (ns[0] * ns[2] * ns[4] !== 0) continue;
        if (ns[2] * ns[4] * ns[6] !== 0) continue;
        toRemove.push(idx(x, y));
      }
    }
    for (const i of toRemove) { grid[i] = 0; changed = true; }

    // Проход 2
    toRemove.length = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!grid[idx(x,y)]) continue;
        const ns = neighbors8(x, y);
        const sum = ns.reduce((a, b) => a + b, 0);
        if (sum < 2 || sum > 6) continue;
        if (transitions(ns) !== 1) continue;
        if (ns[0] * ns[2] * ns[6] !== 0) continue;
        if (ns[0] * ns[4] * ns[6] !== 0) continue;
        toRemove.push(idx(x, y));
      }
    }
    for (const i of toRemove) { grid[i] = 0; changed = true; }
  }

  // ── Извлекаем штрихи из скелета (DFS по 8-связности) ──────────────
  const visited = new Uint8Array(W * H);
  const dirs8 = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];

  // Находим концевые точки скелета (соседей ровно 1) — начинаем DFS оттуда
  const endpoints: Array<{ x: number; y: number }> = [];
  const skeletonPts: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!grid[idx(x, y)]) continue;
      skeletonPts.push({ x, y });
      let cnt = 0;
      for (const [dx, dy] of dirs8) if (g(x+dx, y+dy)) cnt++;
      if (cnt === 1) endpoints.push({ x, y });
    }
  }

  if (skeletonPts.length === 0) {
    strokeCache.set(key, []);
    offscreenCache.set(key, { canvas: off, padX: PAD, midY: H / 2 });
    return [];
  }

  // Если нет концевых точек (замкнутые кривые типа «о»), берём любую точку скелета
  const starts = endpoints.length > 0 ? endpoints : [skeletonPts[0]];

  const strokes: Array<Array<{ x: number; y: number }>> = [];

  const traceFrom = (sx: number, sy: number) => {
    if (visited[idx(sx, sy)]) return;
    const stroke: Array<{ x: number; y: number }> = [];
    const stack: Array<{ x: number; y: number }> = [{ x: sx, y: sy }];

    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      if (visited[idx(x, y)] || !grid[idx(x, y)]) continue;
      visited[idx(x, y)] = 1;
      stroke.push({ x, y });

      // Добавляем не посещённых соседей — предпочитаем «прямое» направление
      const unvisited = dirs8
        .map(([dx, dy]) => ({ x: x+dx, y: y+dy }))
        .filter(p => p.x >= 0 && p.y >= 0 && p.x < W && p.y < H && grid[idx(p.x,p.y)] && !visited[idx(p.x,p.y)]);

      // Сортируем: продолжаем в направлении предыдущего движения (меньше зигзагов)
      if (stroke.length >= 2 && unvisited.length > 1) {
        const prev = stroke[stroke.length - 2];
        const cur = stroke[stroke.length - 1];
        const vx = cur.x - prev.x, vy = cur.y - prev.y;
        unvisited.sort((a, b) => {
          const da = Math.abs((a.x - cur.x) - vx) + Math.abs((a.y - cur.y) - vy);
          const db = Math.abs((b.x - cur.x) - vx) + Math.abs((b.y - cur.y) - vy);
          return da - db;
        });
      }

      // Push в обратном порядке (DFS — первый будет обработан первым)
      for (let i = unvisited.length - 1; i >= 0; i--) stack.push(unvisited[i]);
    }

    if (stroke.length >= 2) strokes.push(stroke);
  };

  // Обходим от всех концевых точек
  for (const s of starts) traceFrom(s.x, s.y);
  // Не забываем несвязные части (внутренние петли)
  for (const p of skeletonPts) traceFrom(p.x, p.y);

  // ── Упорядочиваем штрихи как при реальном письме ──────────────────
  // Соединяем штрихи в порядке: greedy nearest-end, слева направо
  const ordered: Array<Array<{ x: number; y: number }>> = [];
  const usedSet = new Set<number>();
  let curX = 0, curY = H / 2;

  while (ordered.length < strokes.length) {
    let bestI = -1, bestDist = Infinity, bestReverse = false;
    for (let i = 0; i < strokes.length; i++) {
      if (usedSet.has(i)) continue;
      const s = strokes[i];
      const d1 = Math.hypot(s[0].x - curX, s[0].y - curY);
      const d2 = Math.hypot(s[s.length-1].x - curX, s[s.length-1].y - curY);
      if (d1 < bestDist) { bestDist = d1; bestI = i; bestReverse = false; }
      if (d2 < bestDist) { bestDist = d2; bestI = i; bestReverse = true; }
    }
    if (bestI < 0) break;
    usedSet.add(bestI);
    const st = bestReverse ? [...strokes[bestI]].reverse() : strokes[bestI];
    ordered.push(st);
    curX = st[st.length-1].x;
    curY = st[st.length-1].y;
  }

  // ── Сглаживание каждого штриха (скользящее среднее) ──────────────
  const smooth = (pts: Array<{ x: number; y: number }>, passes = 2) => {
    let arr = pts;
    for (let p = 0; p < passes; p++) {
      const out = [arr[0]];
      for (let i = 1; i < arr.length - 1; i++) {
        out.push({ x: (arr[i-1].x + arr[i].x * 2 + arr[i+1].x) / 4, y: (arr[i-1].y + arr[i].y * 2 + arr[i+1].y) / 4 });
      }
      out.push(arr[arr.length-1]);
      arr = out;
    }
    return arr;
  };

  const final = ordered.map(s => smooth(s, 3));

  // Сохраняем offscreen для clip-рендера
  // Перерисовываем с правильным цветом (белый, для compositing)
  offscreenCache.set(key, { canvas: off, padX: PAD, midY: H / 2 });
  strokeCache.set(key, final);
  return final;
}

// ─── drawLayer ─────────────────────────────────────────────────────────────────
function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  canvasW: number,
  canvasH: number,
  nativeW: number,
  nativeH: number,
  progress: number,
  animStyle: AnimStyle,
  isStatic: boolean,
) {
  const scale = Math.min(canvasW / nativeW, canvasH / nativeH);
  const fs = Math.round(layer.fontSize * scale);
  const px = (layer.x / 100) * canvasW;
  const py = (layer.y / 100) * canvasH;

  const weight = layer.bold ? "bold" : "normal";
  const styleStr = layer.italic ? "italic" : "normal";
  const fontStr = `${styleStr} ${weight} ${fs}px '${layer.fontFamily}', 'Caveat', cursive`;

  ctx.save();
  ctx.font = fontStr;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const chars = layer.text.split("");
  const n = chars.length;

  // Фиксированная начальная X — текст никогда не сдвигается
  const fullW = ctx.measureText(layer.text).width;
  let startX = px;
  if (layer.align === "center") startX = px - fullW / 2;
  if (layer.align === "right") startX = px - fullW;

  // ── Статик (без анимации) ──
  if (isStatic || n === 0) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = layer.color;
    ctx.fillText(layer.text, startX, py);
    ctx.restore();
    return;
  }

  // ── TYPEWRITER ──
  if (animStyle === "typewriter") {
    const visible = Math.floor(progress * n);
    ctx.globalAlpha = 1;
    ctx.fillStyle = layer.color;
    let x = startX;
    for (let i = 0; i < n; i++) {
      if (i < visible) ctx.fillText(chars[i], x, py);
      x += ctx.measureText(chars[i]).width;
    }
    ctx.restore();
    return;
  }

  // ── FADE ──
  if (animStyle === "fade") {
    let x = startX;
    for (let i = 0; i < n; i++) {
      const cs = i / n, ce = (i + 1.8) / n;
      const alpha = Math.max(0, Math.min(1, (progress - cs) / (ce - cs)));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = layer.color;
      ctx.fillText(chars[i], x, py);
      x += ctx.measureText(chars[i]).width;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }

  // ── HANDWRITE ──────────────────────────────────────────────────────────
  //
  // Принцип:
  //  • Уже написанные символы → чистый fillText (шрифт идентичен финалу)
  //  • Текущий символ → рисуем его скелетные штрихи пером (ctx.stroke),
  //    а поверх по мере завершения проявляем финальный fillText через alpha-blend.
  //
  // Скелет строится через Zhang-Suen thinning → 1px центральная ось буквы.
  // Штрихи упорядочены как при реальном письме (greedy nearest-end).
  // Каждый штрих рисуется как ОДНА непрерывная линия — не параллельно!
  // Между штрихами — «перелёт» пера (невидимый переход).
  //
  // Финальный переход: при curP > 0.85 плавно подмешиваем fillText
  // чтобы убрать артефакты скелета и получить идеальное финальное изображение.

  // Глобальный прогресс по всем символам
  const charProgress = progress * n;
  const doneCount = Math.floor(charProgress);       // полностью написанных
  const curIdx = Math.min(doneCount, n - 1);        // индекс текущего символа
  const curP = Math.max(0, charProgress - doneCount); // 0..1 внутри текущего символа

  // 1. Готовые символы — чистый fillText
  ctx.globalAlpha = 1;
  ctx.fillStyle = layer.color;
  let cx = startX;
  for (let i = 0; i < doneCount && i < n; i++) {
    ctx.fillText(chars[i], cx, py);
    cx += ctx.measureText(chars[i]).width;
  }

  // 2. Текущий символ
  if (curIdx < n) {
    let charStartX = startX;
    for (let i = 0; i < curIdx; i++) charStartX += ctx.measureText(chars[i]).width;

    const ch = chars[curIdx];

    // Пробел — молча пропускаем
    if (ch.trim() === "") { ctx.restore(); return; }

    const strokes = buildStrokes(ch, fontStr, fs);
    const offInfo = offscreenCache.get(`${ch}|${fontStr}`);

    // Нет скелета (редкие символы) — плавный fade
    if (strokes.length === 0 || !offInfo) {
      ctx.globalAlpha = Math.min(1, curP * 2);
      ctx.fillStyle = layer.color;
      ctx.fillText(ch, charStartX, py);
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }

    // Суммарная длина всех штрихов в точках
    const totalPts = strokes.reduce((s, st) => s + st.length, 0);
    // Дробное количество пройденных точек с высокой точностью
    const drawnF = curP * totalPts;

    // Толщина пера — немного уже буквы, чтобы не выходить за контур
    const penW = Math.max(1.2, fs * 0.07);
    // Перо раскрывает букву — для clip используем радиус чуть больше пера
    const revealR = penW * 1.6;

    // Offscreen координаты → canvas координаты
    const toCanvas = (pt: { x: number; y: number }) => ({
      cx: charStartX + (pt.x - offInfo.padX),
      cy: py + (pt.y - offInfo.midY),
    });

    // ── Рисуем штрихи пера (скелет) ──
    // Используем clip от offscreen чтобы рисовать ТОЛЬКО внутри буквы
    // и при этом не менять сам шрифт
    ctx.save();

    // Clip: пятно вдоль пройденного пути пера раскрывает символ
    ctx.beginPath();
    let ptsLeft = drawnF;
    for (const stroke of strokes) {
      if (ptsLeft <= 0) break;
      const visible = Math.min(stroke.length, Math.ceil(ptsLeft));
      for (let pi = 0; pi < visible; pi++) {
        const { cx: sx, cy: sy } = toCanvas(stroke[pi]);
        ctx.moveTo(sx + revealR, sy);
        ctx.arc(sx, sy, revealR, 0, Math.PI * 2);
      }
      ptsLeft -= stroke.length;
    }
    ctx.clip();

    // Рисуем финальный fillText внутри clip — шрифт НЕ МЕНЯЕТСЯ
    ctx.globalAlpha = 1;
    ctx.fillStyle = layer.color;
    ctx.fillText(ch, charStartX, py);

    ctx.restore(); // снимаем clip

    // ── Поверх рисуем линию пера для эффекта «чернила текут» ──
    // Это тонкая линия по скелету, которая бежит впереди раскрытия
    ctx.save();
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = penW * 0.55;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.85;

    let pts2Left = drawnF;
    for (const stroke of strokes) {
      if (pts2Left <= 0) break;
      const visibleF = Math.min(stroke.length, pts2Left);
      const visibleI = Math.floor(visibleF);
      const frac = visibleF - visibleI; // дробная часть — для субпиксельной плавности

      if (visibleI < 1) { pts2Left -= stroke.length; continue; }

      ctx.beginPath();
      const p0 = toCanvas(stroke[0]);
      ctx.moveTo(p0.cx, p0.cy);
      for (let pi = 1; pi <= visibleI && pi < stroke.length; pi++) {
        const p = toCanvas(stroke[pi]);
        ctx.lineTo(p.cx, p.cy);
      }

      // Субпиксельная интерполяция последней точки
      if (frac > 0 && visibleI < stroke.length - 1) {
        const pA = toCanvas(stroke[visibleI]);
        const pB = toCanvas(stroke[Math.min(visibleI + 1, stroke.length - 1)]);
        ctx.lineTo(pA.cx + (pB.cx - pA.cx) * frac, pA.cy + (pB.cy - pA.cy) * frac);
      }
      ctx.stroke();

      pts2Left -= stroke.length;
    }
    ctx.restore();

    // ── Кончик пера (точка) ──
    {
      let ptsT = drawnF;
      let tipPt: { x: number; y: number } | null = null;
      let tipFrac = 0;
      for (const stroke of strokes) {
        if (ptsT <= 0) break;
        if (ptsT < stroke.length) {
          const i = Math.floor(ptsT);
          tipFrac = ptsT - i;
          const pA = stroke[Math.min(i, stroke.length-1)];
          const pB = stroke[Math.min(i+1, stroke.length-1)];
          tipPt = { x: pA.x + (pB.x - pA.x) * tipFrac, y: pA.y + (pB.y - pA.y) * tipFrac };
          break;
        }
        ptsT -= stroke.length;
      }
      if (tipPt) {
        const { cx: tx, cy: ty } = toCanvas(tipPt);
        ctx.beginPath();
        ctx.arc(tx, ty, penW * 0.65, 0, Math.PI * 2);
        ctx.fillStyle = layer.color;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // ── Финальный blend: при curP > 0.88 подмешиваем чистый fillText ──
    // Это сглаживает возможные артефакты скелета в конце
    if (curP > 0.88) {
      const blend = (curP - 0.88) / 0.12;
      ctx.globalAlpha = blend;
      ctx.fillStyle = layer.color;
      ctx.fillText(ch, charStartX, py);
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
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
  const [activeLayerId, setActiveLayerId] = useState<string>(() => layers[0].id);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [animStyle, setAnimStyle] = useState<AnimStyle>("handwrite");
  const [speed, setSpeed] = useState(1.0);
  const [fps, setFps] = useState(30);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4");
  const [quality, setQuality] = useState<"720p" | "1080p" | "4K">("1080p");
  const [inkColor, setInkColor] = useState("#f5c842");

  const previewRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ w: 800, h: 450 });

  // Refs for stable access inside animation loops
  const layersRef = useRef(layers);
  const bgColorRef = useRef(bgColor);
  const bgTransparentRef = useRef(bgTransparent);
  const animStyleRef = useRef(animStyle);
  const aspectRatioRef = useRef(aspectRatio);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { bgColorRef.current = bgColor; }, [bgColor]);
  useEffect(() => { bgTransparentRef.current = bgTransparent; }, [bgTransparent]);
  useEffect(() => { animStyleRef.current = animStyle; }, [animStyle]);
  useEffect(() => { aspectRatioRef.current = aspectRatio; }, [aspectRatio]);

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

  // Core render function — stable via refs
  const renderFrame = useCallback((progress: number | null) => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ar = ASPECT_RATIOS.find(r => r.id === aspectRatioRef.current)!;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!bgTransparentRef.current) {
      ctx.fillStyle = bgColorRef.current;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const isStatic = progress === null;
    const p = progress ?? 1;

    layersRef.current.forEach(layer => {
      drawLayer(ctx, layer, canvas.width, canvas.height, ar.w, ar.h, p, animStyleRef.current, isStatic);
    });
  }, []);

  // Redraw static preview when not playing
  useEffect(() => {
    if (!isPlaying) renderFrame(null);
  }, [layers, bgColor, bgTransparent, aspectRatio, animStyle, isPlaying, renderFrame]);

  // Animation loop
  const runAnimation = useCallback(() => {
    const maxChars = Math.max(...layersRef.current.map(l => l.text.length), 1);
    // handwrite: больше кадров для плавной прорисовки скелета
    const baseFrames = animStyleRef.current === "handwrite" ? 45 : 18;
    const framesPerChar = Math.round(baseFrames / speed);
    const totalFrames = maxChars * framesPerChar;
    let frame = 0;

    const step = () => {
      const progress = Math.min(frame / totalFrames, 1);
      setPlayProgress(progress);
      renderFrame(progress);
      frame++;
      if (frame <= totalFrames + fps) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        setIsPlaying(false);
        setPlayProgress(1);
        renderFrame(null);
      }
    };
    animFrameRef.current = requestAnimationFrame(step);
  }, [speed, fps, renderFrame]);

  useEffect(() => {
    if (isPlaying) {
      cancelAnimationFrame(animFrameRef.current);
      setPlayProgress(0);
      runAnimation();
    } else {
      cancelAnimationFrame(animFrameRef.current);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying]); // eslint-disable-line

  // Draw canvas
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
    ctx.fillStyle = "rgba(245,200,66,0.07)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(selectedChar, canvas.width / 2, canvas.height / 2);

    [...strokes, currentStroke].forEach((stroke, si) => {
      if (stroke.length < 2) return;
      const total = strokes.length + (currentStroke.length > 1 ? 1 : 0);
      // Simulate pressure: thicker in middle, thinner at ends
      for (let i = 1; i < stroke.length; i++) {
        const t = i / stroke.length;
        const pressure = Math.sin(t * Math.PI); // 0→1→0
        ctx.beginPath();
        ctx.strokeStyle = inkColor;
        ctx.lineWidth = lineWidth * (0.4 + 0.6 * pressure);
        ctx.lineCap = lineStyle;
        ctx.lineJoin = "round";
        ctx.moveTo(stroke[i - 1].x, stroke[i - 1].y);
        ctx.lineTo(stroke[i].x, stroke[i].y);
        ctx.stroke();
        void si; void total;
      }
    });
  }, [strokes, currentStroke, selectedChar, inkColor, lineWidth, lineStyle, fontName]);

  useEffect(() => { redrawDrawCanvas(); }, [redrawDrawCanvas]);

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

  // Drag layers on preview
  const getPreviewPct = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = previewRef.current!;
    const r = c.getBoundingClientRect();
    return { px: ((e.clientX - r.left) / r.width) * 100, py: ((e.clientY - r.top) / r.height) * 100 };
  };
  const onPreviewMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTab !== "editor") return;
    const { px, py } = getPreviewPct(e);
    const hit = [...layers].reverse().find(l => Math.abs(l.x - px) < 15 && Math.abs(l.y - py) < 8);
    if (hit) {
      setActiveLayerId(hit.id);
      setDraggingLayerId(hit.id);
      setDragOffset({ x: px - hit.x, y: py - hit.y });
    }
  };
  const onPreviewMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingLayerId) return;
    const { px, py } = getPreviewPct(e);
    setLayers(ls => ls.map(l => l.id === draggingLayerId
      ? { ...l, x: Math.max(2, Math.min(98, px - dragOffset.x)), y: Math.max(2, Math.min(98, py - dragOffset.y)) }
      : l));
  };
  const onPreviewMouseUp = () => setDraggingLayerId(null);

  const updateActiveLayer = (patch: Partial<TextLayer>) => {
    setLayers(ls => ls.map(l => l.id === activeLayerId ? { ...l, ...patch } : l));
  };

  const addLayer = () => {
    const nl: TextLayer = { id: mkId(), text: "Новый текст", x: 50, y: 65, fontSize: 64, color: "#ffffff", fontFamily: fontName, bold: false, italic: false, align: "center" };
    setLayers(ls => [...ls, nl]);
    setActiveLayerId(nl.id);
  };

  const removeLayer = (id: string) => {
    const next = layers.find(l => l.id !== id);
    setLayers(ls => ls.filter(l => l.id !== id));
    if (activeLayerId === id && next) setActiveLayerId(next.id);
  };

  const handleFontUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, "");
    new FontFace(name, `url(${url})`).load().then(loaded => {
      document.fonts.add(loaded);
      // Сбрасываем кеши — пересчитаются под новый шрифт
      strokeCache.clear();
      offscreenCache.clear();
      setUploadedFont(name);
      setFontName(name);
      updateActiveLayer({ fontFamily: name });
      setSelectedChar("А");
      setStrokes([]);
      setCurrentStroke([]);
    });
  };

  // Export via MediaRecorder
  const handleExport = useCallback(async () => {
    const canvas = previewRef.current;
    if (!canvas) return;
    setIsExporting(true);
    setExportProgress(0);

    const maxChars = Math.max(...layersRef.current.map(l => l.text.length), 1);
    const framesPerChar = Math.round(18 / speed);
    const totalFrames = maxChars * framesPerChar + fps;
    const mimeType = exportFormat === "mp4"
      ? (MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm;codecs=h264")
      : "video/webm;codecs=vp9";
    const actualMime = MediaRecorder.isTypeSupported(mimeType) ? mimeType : "video/webm";

    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: actualMime, videoBitsPerSecond: 10_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = ev => { if (ev.data.size > 0) chunks.push(ev.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: actualMime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `letterflow.${exportFormat === "mp4" ? "mp4" : "webm"}`;
      a.click(); URL.revokeObjectURL(url);
      setIsExporting(false); setExportProgress(0);
    };

    recorder.start();
    let frame = 0;
    const renderExport = () => {
      const p = Math.min(frame / (totalFrames - fps), 1);
      setExportProgress(frame / totalFrames);
      renderFrame(p >= 1 ? null : p);
      frame++;
      if (frame <= totalFrames) setTimeout(renderExport, 1000 / fps);
      else recorder.stop();
    };
    renderExport();
  }, [speed, fps, exportFormat, renderFrame]);

  const nativeAR = ASPECT_RATIOS.find(r => r.id === aspectRatio)!;

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden select-none">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-border shrink-0 bg-card">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center shrink-0">
            <span className="font-handwriting text-primary-foreground text-xs font-bold leading-none">Lf</span>
          </div>
          <span className="font-semibold text-sm tracking-tight">LetterFlow</span>
          <span className="text-muted-foreground text-xs font-mono opacity-40">v0.3</span>
        </div>
        <div className="flex items-center gap-3">
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

        {/* LEFT: Preview (always visible) */}
        <div ref={previewContainerRef} className="flex-1 flex flex-col items-center justify-center bg-[#07070c] overflow-hidden p-4 gap-3">
          <div className="relative" style={{ width: previewSize.w, height: previewSize.h }}>
            {bgTransparent && (
              <div className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none"
                style={{ backgroundImage: "repeating-conic-gradient(#222 0% 25%, #111 0% 50%) 0 0/20px 20px" }} />
            )}
            <canvas
              ref={previewRef}
              width={nativeAR.w}
              height={nativeAR.h}
              className={`absolute inset-0 w-full h-full rounded-lg ${activeTab === "editor" && !isPlaying ? "cursor-move" : "cursor-default"}`}
              style={{ outline: "1px solid rgba(255,255,255,0.07)" }}
              onMouseDown={onPreviewMouseDown}
              onMouseMove={onPreviewMouseMove}
              onMouseUp={onPreviewMouseUp}
              onMouseLeave={onPreviewMouseUp}
            />
          </div>

          {/* Playback bar */}
          <div className="flex items-center gap-3" style={{ width: previewSize.w }}>
            <button onClick={() => setIsPlaying(p => !p)}
              className="w-7 h-7 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors shrink-0">
              <Icon name={isPlaying ? "Pause" : "Play"} size={12} className="text-primary-foreground" fallback="Circle" />
            </button>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${playProgress * 100}%` }} />
            </div>
            <span className="text-xs font-mono text-muted-foreground w-8 text-right">{Math.round(playProgress * 100)}%</span>
            <span className="text-xs font-mono text-muted-foreground/30">{aspectRatio}</span>
          </div>

          {/* Style indicator */}
          <div className="flex gap-2">
            {([
              { id: "handwrite", label: "Рукопись" },
              { id: "fade", label: "Растворение" },
              { id: "typewriter", label: "Машинка" },
            ] as const).map(s => (
              <button key={s.id} onClick={() => setAnimStyle(s.id)}
                className={`px-3 py-1 rounded-full text-xs transition-all ${animStyle === s.id ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:text-foreground"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT: Panels */}
        <div className="w-[340px] border-l border-border flex flex-col overflow-hidden shrink-0 bg-card">

          {/* FONT TAB */}
          {activeTab === "font" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Загрузить шрифт</div>
              <input ref={fileInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={handleFontUpload} />
              <button onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-6 flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <Icon name="Upload" size={24} fallback="Circle" />
                <div className="text-sm font-medium">{uploadedFont ? `✓ ${uploadedFont}` : "TTF / OTF / WOFF"}</div>
                <div className="text-xs opacity-50">Шрифт сохраняется в сессии</div>
              </button>

              {uploadedFont && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <div className="text-xs text-muted-foreground mb-2">Загруженный шрифт</div>
                  <div style={{ fontFamily: uploadedFont }} className="text-3xl text-primary">Аа Бб Вв</div>
                  <div className="text-xs font-mono text-muted-foreground mt-2">{uploadedFont}</div>
                </div>
              )}

              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Встроенные</div>
              <div className="grid grid-cols-2 gap-2">
                {BUILTIN_FONTS.map(f => (
                  <button key={f.name} onClick={() => { setFontName(f.name); updateActiveLayer({ fontFamily: f.name }); }}
                    className={`p-3 rounded-xl border text-left transition-all ${fontName === f.name && !uploadedFont ? "border-primary bg-primary/10" : "border-border hover:bg-muted/30"}`}>
                    <div style={{ fontFamily: f.name }} className="text-2xl text-foreground leading-none mb-1">Аа</div>
                    <div className="text-xs text-muted-foreground">{f.label}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* DRAW TAB */}
          {activeTab === "draw" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="h-36 border-b border-border overflow-y-auto p-2 shrink-0">
                <div className="grid grid-cols-8 gap-0.5">
                  {SAMPLE_CHARS.map(ch => (
                    <button key={ch} onClick={() => { setSelectedChar(ch); setStrokes([]); setCurrentStroke([]); }}
                      className={`w-7 h-7 rounded text-xs font-mono transition-all ${selectedChar === ch ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"}`}>
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center p-3 bg-[#07070c]">
                <canvas ref={drawCanvasRef} width={280} height={280}
                  style={{ background: "#0d0f14", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", cursor: "crosshair", width: "100%", maxWidth: 280, aspectRatio: "1/1" }}
                  onMouseDown={onDrawDown} onMouseMove={onDrawMove} onMouseUp={onDrawUp} onMouseLeave={onDrawUp} />
              </div>
              <div className="p-3 border-t border-border space-y-3 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-16">Толщина</span>
                  <input type="range" min={1} max={14} value={lineWidth} onChange={e => setLineWidth(+e.target.value)} className="flex-1 accent-amber-400" />
                  <span className="text-xs font-mono text-primary w-5">{lineWidth}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-16">Цвет</span>
                  <input type="color" value={inkColor} onChange={e => setInkColor(e.target.value)} className="w-8 h-8 rounded border-0 cursor-pointer" />
                  <span className="text-xs font-mono text-muted-foreground flex-1">{inkColor}</span>
                  <button onClick={() => { setStrokes([]); setCurrentStroke([]); }}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
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

          {/* EDITOR TAB */}
          {activeTab === "editor" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Layers */}
              <div className="border-b border-border shrink-0">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Слои</span>
                  <button onClick={addLayer} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
                    <Icon name="Plus" size={12} fallback="Circle" />Добавить
                  </button>
                </div>
                <div className="max-h-24 overflow-y-auto">
                  {layers.map(layer => (
                    <div key={layer.id} onClick={() => setActiveLayerId(layer.id)}
                      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${activeLayerId === layer.id ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-muted/30 border-l-2 border-transparent"}`}>
                      <Icon name="Type" size={11} fallback="Circle" className="text-muted-foreground shrink-0" />
                      <span className="text-xs flex-1 truncate">{layer.text || "—"}</span>
                      {layers.length > 1 && (
                        <button onClick={e => { e.stopPropagation(); removeLayer(layer.id); }}
                          className="text-muted-foreground hover:text-destructive">
                          <Icon name="X" size={11} fallback="Circle" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {activeLayer && (
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                  {/* Text */}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Текст</div>
                    <textarea value={activeLayer.text}
                      onChange={e => updateActiveLayer({ text: e.target.value })}
                      rows={3}
                      style={{ fontFamily: activeLayer.fontFamily, color: activeLayer.color, background: "rgba(255,255,255,0.04)" }}
                      className="w-full rounded-lg p-3 text-xl resize-none border border-border focus:border-primary/50 focus:outline-none transition-colors leading-relaxed"
                      placeholder="Введите текст..." />
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {["Привет, мир!", "С Новым годом!", "С днём рождения!"].map(s => (
                        <button key={s} onClick={() => updateActiveLayer({ text: s })}
                          className="px-2 py-1 text-xs border border-border rounded-full text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font */}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Шрифт</div>
                    <select value={activeLayer.fontFamily} onChange={e => updateActiveLayer({ fontFamily: e.target.value })}
                      className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50">
                      {uploadedFont && <option value={uploadedFont}>{uploadedFont} ★</option>}
                      {BUILTIN_FONTS.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                    </select>
                  </div>

                  {/* Size */}
                  <div>
                    <div className="flex justify-between mb-2">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Размер</div>
                      <span className="text-xs font-mono text-primary">{activeLayer.fontSize}px</span>
                    </div>
                    <input type="range" min={12} max={300} value={activeLayer.fontSize}
                      onChange={e => updateActiveLayer({ fontSize: +e.target.value })} className="w-full accent-amber-400" />
                  </div>

                  {/* Color */}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Цвет текста</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input type="color" value={activeLayer.color} onChange={e => updateActiveLayer({ color: e.target.value })}
                        className="w-9 h-9 rounded-lg cursor-pointer border-0" />
                      {["#ffffff", "#000000", "#f5c842", "#ff6b6b", "#74c0fc", "#69db7c", "#cc5de8", "#ff922b"].map(c => (
                        <button key={c} onClick={() => updateActiveLayer({ color: c })}
                          className={`w-6 h-6 rounded-full border-2 transition-all ${activeLayer.color === c ? "border-primary scale-110" : "border-border"}`}
                          style={{ background: c }} />
                      ))}
                    </div>
                  </div>

                  {/* Style + Align */}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Начертание</div>
                    <div className="flex gap-2">
                      <button onClick={() => updateActiveLayer({ bold: !activeLayer.bold })}
                        className={`w-9 h-9 rounded-lg text-sm font-bold border transition-all ${activeLayer.bold ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground"}`}>B</button>
                      <button onClick={() => updateActiveLayer({ italic: !activeLayer.italic })}
                        className={`w-9 h-9 rounded-lg text-sm italic border transition-all ${activeLayer.italic ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground"}`}>I</button>
                      <div className="w-px bg-border mx-1" />
                      {(["left", "center", "right"] as const).map(a => (
                        <button key={a} onClick={() => updateActiveLayer({ align: a })}
                          className={`flex-1 h-9 rounded-lg border transition-all ${activeLayer.align === a ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>
                          <Icon name={a === "left" ? "AlignLeft" : a === "center" ? "AlignCenter" : "AlignRight"} size={13} fallback="Circle" className="mx-auto" />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Position */}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Позиция</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>X</span><span className="font-mono text-primary">{Math.round(activeLayer.x)}%</span></div>
                        <input type="range" min={0} max={100} value={activeLayer.x} onChange={e => updateActiveLayer({ x: +e.target.value })} className="w-full accent-amber-400" />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>Y</span><span className="font-mono text-primary">{Math.round(activeLayer.y)}%</span></div>
                        <input type="range" min={0} max={100} value={activeLayer.y} onChange={e => updateActiveLayer({ y: +e.target.value })} className="w-full accent-amber-400" />
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {[{ l: "Центр", x: 50, y: 50 }, { l: "Верх", x: 50, y: 15 }, { l: "Низ", x: 50, y: 85 }].map(p => (
                        <button key={p.l} onClick={() => updateActiveLayer({ x: p.x, y: p.y })}
                          className="px-2.5 py-1 text-xs border border-border rounded-full text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
                          {p.l}
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1.5 opacity-50">Или перетащите текст на превью</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ANIMATION TAB */}
          {activeTab === "animation" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Стиль появления</div>
              <div className="space-y-2">
                {([
                  {
                    id: "handwrite", label: "Рукопись", icon: "PenLine",
                    desc: "Каждый символ прорисовывается постепенно — обводка → заливка. Как пишет человек."
                  },
                  {
                    id: "fade", label: "Растворение", icon: "Sparkles",
                    desc: "Символы плавно появляются из прозрачности. Текст стоит на месте."
                  },
                  {
                    id: "typewriter", label: "Машинка", icon: "Monitor",
                    desc: "Символы появляются мгновенно один за другим. Как печатный текст."
                  },
                ] as const).map(s => (
                  <button key={s.id} onClick={() => setAnimStyle(s.id)}
                    className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${animStyle === s.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/20"}`}>
                    <Icon name={s.icon} size={16} fallback="Circle" className={`mt-0.5 shrink-0 ${animStyle === s.id ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{s.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.desc}</div>
                    </div>
                    {animStyle === s.id && <Icon name="Check" size={14} className="text-primary mt-0.5 shrink-0" fallback="Circle" />}
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
                    className={`flex-1 py-2 rounded-lg text-xs font-mono border transition-all ${fps === f ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground"}`}>
                    {f}
                  </button>
                ))}
              </div>

              <button onClick={() => setIsPlaying(p => !p)}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors">
                <Icon name={isPlaying ? "Pause" : "Play"} size={14} fallback="Circle" />
                {isPlaying ? "Пауза" : "Воспроизвести"}
              </button>
            </div>
          )}

          {/* EXPORT TAB */}
          {activeTab === "export" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Формат кадра</div>
              <div className="grid grid-cols-2 gap-2">
                {ASPECT_RATIOS.map(ar => (
                  <button key={ar.id} onClick={() => setAspectRatio(ar.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${aspectRatio === ar.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/20"}`}>
                    <div className={`text-sm font-mono font-bold ${aspectRatio === ar.id ? "text-primary" : "text-foreground"}`}>{ar.id}</div>
                    <div className="text-xs text-muted-foreground">{ar.label}</div>
                    <div className="text-xs font-mono text-muted-foreground/50">{ar.w}×{ar.h}</div>
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
              <div className="flex gap-2">
                {([
                  { id: "mp4", label: "MP4", desc: "Универсальный" },
                  { id: "webm", label: "WebM", desc: "Веб / VP9" },
                ] as const).map(f => (
                  <button key={f.id} onClick={() => setExportFormat(f.id)}
                    className={`flex-1 p-3 rounded-xl border text-center transition-all ${exportFormat === f.id ? "border-primary bg-primary/10" : "border-border"}`}>
                    <div className={`text-sm font-mono font-bold ${exportFormat === f.id ? "text-primary" : "text-foreground"}`}>{f.label}</div>
                    <div className="text-xs text-muted-foreground">{f.desc}</div>
                  </button>
                ))}
              </div>

              {/* Summary */}
              <div className="rounded-xl border border-border p-3 bg-muted/10 space-y-1.5">
                {[
                  { l: "Кадр", v: `${aspectRatio} · ${nativeAR.w}×${nativeAR.h}` },
                  { l: "FPS", v: String(fps) },
                  { l: "Стиль", v: animStyle === "handwrite" ? "Рукопись" : animStyle === "fade" ? "Растворение" : "Машинка" },
                  { l: "Скорость", v: `${speed.toFixed(1)}×` },
                  { l: "Слоёв", v: String(layers.length) },
                ].map(row => (
                  <div key={row.l} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{row.l}</span>
                    <span className="font-mono text-foreground">{row.v}</span>
                  </div>
                ))}
              </div>

              {isExporting ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Рендеринг...</span>
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
                  Скачать {exportFormat.toUpperCase()}
                </button>
              )}
            </div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === "settings" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Фон</div>
              <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                <div className="flex items-center justify-between p-3">
                  <div>
                    <div className="text-sm font-medium">Прозрачный фон</div>
                    <div className="text-xs text-muted-foreground">Альфа-канал в экспорте</div>
                  </div>
                  <button onClick={() => setBgTransparent(p => !p)}
                    className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${bgTransparent ? "bg-primary" : "bg-border"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${bgTransparent ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
                {!bgTransparent && (
                  <div className="p-3">
                    <div className="text-xs text-muted-foreground mb-2">Цвет фона</div>
                    <div className="flex items-center gap-2 flex-wrap">
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

              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Инструмент обрисовки</div>
              <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                <div className="p-3 flex items-center gap-3">
                  <span className="text-sm flex-1">Цвет штриха</span>
                  <input type="color" value={inkColor} onChange={e => setInkColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                </div>
                <div className="p-3">
                  <div className="flex justify-between mb-2">
                    <span className="text-sm">Толщина</span>
                    <span className="text-xs font-mono text-primary">{lineWidth}px</span>
                  </div>
                  <input type="range" min={1} max={14} value={lineWidth} onChange={e => setLineWidth(+e.target.value)} className="w-full accent-amber-400" />
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 bg-muted/10">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">О программе</div>
                <div className="text-sm text-muted-foreground">LetterFlow v0.3</div>
                <div className="text-xs font-mono text-muted-foreground/40 mt-1">Рукописная анимация текста</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}