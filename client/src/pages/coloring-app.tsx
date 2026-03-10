import { useState, useRef, useEffect, useCallback } from 'react';
import { computeEdgeMagnitudes, magnitudesToLineArt, type LineArtOptions } from '@/lib/image-processor';
import { floodFill, hexToRgb } from '@/lib/flood-fill';
import {
  Paintbrush, Droplets, Upload, Download, RotateCcw,
  Undo2, Redo2, Trash2, Palette, ImagePlus, Loader2,
  Lock, Unlock, ZoomIn, ZoomOut, Maximize, Eraser,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

const PALETTE_COLORS = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
  '#00C7BE', '#007AFF', '#5856D6', '#AF52DE',
  '#FF2D55', '#FF6B8A', '#A2845E', '#8E8E93',
  '#48DBFB', '#1DD1A1', '#000000', '#FFFFFF',
];

const BRUSH_SIZES = [
  { label: 'S', value: 8 },
  { label: 'M', value: 18 },
  { label: 'L', value: 34 },
  { label: 'XL', value: 50 },
  { label: 'XXL', value: 70 },
];

type Tool = 'brush' | 'bucket' | 'eraser';
type AgePreset = 'simple' | 'medium' | 'detailed';

const AGE_PRESETS: Record<AgePreset, { label: string; ages: string; threshold: number; options: LineArtOptions }> = {
  simple:   { label: 'Simple',   ages: '4–5', threshold: 70, options: { closingRadius: 1, minRegionArea: 100, lineThickness: 1 } },
  medium:   { label: 'Medium',   ages: '6–7', threshold: 50, options: { closingRadius: 1, minRegionArea: 60, lineThickness: 1 } },
  detailed: { label: 'Detailed', ages: '8–10', threshold: 30, options: { closingRadius: 1, minRegionArea: 30, lineThickness: 0 } },
};

export default function ColoringApp() {
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState(PALETTE_COLORS[0]);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [boundaryOn, setBoundaryOn] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasLineArt, setHasLineArtState] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [threshold, setThreshold] = useState(50);
  const [agePreset, setAgePreset] = useState<AgePreset>('medium');
  const [lineArtOpts, setLineArtOpts] = useState<LineArtOptions>(AGE_PRESETS.medium.options);
  const [edgeData, setEdgeData] = useState<{ magnitudes: Float32Array; width: number; height: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [originalImageData, setOriginalImageData] = useState<{ imageData: ImageData; width: number; height: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawBufRef = useRef<HTMLCanvasElement | null>(null);
  const lineArtBufRef = useRef<HTMLCanvasElement | null>(null);
  const bgImageBufRef = useRef<HTMLCanvasElement | null>(null);
  const hasBgImageRef = useRef(false);
  const [hasBgImage, setHasBgImageState] = useState(false);
  const boundaryMaskRef = useRef<Uint8Array | null>(null);
  const isDrawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const historyIdxRef = useRef(-1);
  const hasLineArtRef = useRef(false);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const isPinchingRef = useRef(false);
  const pinchStartDistRef = useRef(0);
  const pinchStartZoomRef = useRef(1);
  const pinchStartPanRef = useRef({ x: 0, y: 0 });
  const pinchStartMidRef = useRef({ x: 0, y: 0 });

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 5;

  const { toast } = useToast();
  const brushSize = BRUSH_SIZES[sizeIdx].value;

  const setHasLineArt = (v: boolean) => {
    hasLineArtRef.current = v;
    setHasLineArtState(v);
  };

  const setHasBgImage = (v: boolean) => {
    hasBgImageRef.current = v;
    setHasBgImageState(v);
  };

  const composite = useCallback(() => {
    const canvas = canvasRef.current;
    const drawBuf = drawBufRef.current;
    const lineArtBuf = lineArtBufRef.current;
    const bgImageBuf = bgImageBufRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const { w, h } = canvasSizeRef.current;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    if (bgImageBuf && hasBgImageRef.current) ctx.drawImage(bgImageBuf, 0, 0);
    if (drawBuf) ctx.drawImage(drawBuf, 0, 0);
    if (lineArtBuf && hasLineArtRef.current) ctx.drawImage(lineArtBuf, 0, 0);
  }, []);

  const applyTransform = useCallback(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;
    const z = zoomRef.current;
    const p = panRef.current;
    wrapper.style.transform = `translate(${p.x}px, ${p.y}px) scale(${z})`;
  }, []);

  const clampPan = useCallback((pan: { x: number; y: number }, zoom: number) => {
    if (zoom <= 1) return { x: 0, y: 0 };
    const wrapper = canvasWrapperRef.current;
    const container = containerRef.current;
    if (!wrapper || !container) return pan;
    const cRect = container.getBoundingClientRect();
    const ww = wrapper.offsetWidth * zoom;
    const wh = wrapper.offsetHeight * zoom;
    const maxPanX = Math.max(0, (ww - cRect.width) / 2);
    const maxPanY = Math.max(0, (wh - cRect.height) / 2);
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, pan.x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, pan.y)),
    };
  }, []);

  const handleZoom = useCallback((newZoom: number) => {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    zoomRef.current = z;
    panRef.current = clampPan(panRef.current, z);
    applyTransform();
    setZoomLevel(z);
  }, [clampPan, applyTransform]);

  const handleZoomIn = useCallback(() => handleZoom(zoomRef.current + 0.5), [handleZoom]);
  const handleZoomOut = useCallback(() => handleZoom(zoomRef.current - 0.5), [handleZoom]);
  const handleZoomReset = useCallback(() => handleZoom(1), [handleZoom]);

  useEffect(() => {
    document.title = 'ColorPal - Coloring App for Kids';
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const init = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.floor(rect.width - 24);
      const h = Math.floor(rect.height - 24);
      if (w <= 0 || h <= 0) return;

      canvas.width = w;
      canvas.height = h;
      canvasSizeRef.current = { w, h };

      const drawBuf = document.createElement('canvas');
      drawBuf.width = w;
      drawBuf.height = h;
      const drawCtx = drawBuf.getContext('2d')!;
      drawCtx.fillStyle = '#FFFFFF';
      drawCtx.fillRect(0, 0, w, h);
      drawBufRef.current = drawBuf;

      const lineArtBuf = document.createElement('canvas');
      lineArtBuf.width = w;
      lineArtBuf.height = h;
      lineArtBufRef.current = lineArtBuf;

      const bgImageBuf = document.createElement('canvas');
      bgImageBuf.width = w;
      bgImageBuf.height = h;
      bgImageBufRef.current = bgImageBuf;

      composite();

      historyRef.current = [drawCtx.getImageData(0, 0, w, h)];
      historyIdxRef.current = 0;
      setCanvasReady(true);
    };

    requestAnimationFrame(() => requestAnimationFrame(init));

    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = '';
      document.body.style.overscrollBehavior = '';
    };
  }, [composite]);

  const saveHistory = () => {
    const drawBuf = drawBufRef.current;
    if (!drawBuf) return;
    const { w, h } = canvasSizeRef.current;
    const data = drawBuf.getContext('2d')!.getImageData(0, 0, w, h);
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(data);
    if (historyRef.current.length > 20) historyRef.current.shift();
    historyIdxRef.current = historyRef.current.length - 1;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(false);
  };

  const undo = () => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    const data = historyRef.current[historyIdxRef.current];
    const drawBuf = drawBufRef.current;
    if (!drawBuf || !data) return;
    drawBuf.getContext('2d')!.putImageData(data, 0, 0);
    composite();
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
  };

  const redo = () => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    const data = historyRef.current[historyIdxRef.current];
    const drawBuf = drawBufRef.current;
    if (!drawBuf || !data) return;
    drawBuf.getContext('2d')!.putImageData(data, 0, 0);
    composite();
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
  };

  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const saveRef = useRef<() => void>(() => {});

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoRef.current(); }
        if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redoRef.current(); }
        if (e.key === 's') { e.preventDefault(); saveRef.current(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current + delta));
      zoomRef.current = newZ;
      panRef.current = clampPan(panRef.current, newZ);
      applyTransform();
      setZoomLevel(newZ);
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [clampPan, applyTransform]);

  const getCanvasCoords = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const isOnBoundary = (x: number, y: number): boolean => {
    if (!boundaryOn || !boundaryMaskRef.current) return false;
    const { w, h } = canvasSizeRef.current;
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= w || py >= h) return false;
    return boundaryMaskRef.current[py * w + px] === 1;
  };

  const findSafeEndpoint = (x1: number, y1: number, x2: number, y2: number): { x: number; y: number; blocked: boolean } => {
    if (!boundaryOn || !boundaryMaskRef.current) return { x: x2, y: y2, blocked: false };
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(Math.ceil(dist), 1);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cx = x1 + dx * t;
      const cy = y1 + dy * t;
      if (isOnBoundary(cx, cy)) {
        const safet = Math.max(0, (i - 1) / steps);
        return { x: x1 + dx * safet, y: y1 + dy * safet, blocked: true };
      }
    }
    return { x: x2, y: y2, blocked: false };
  };

  const drawSegment = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    if (isOnBoundary(from.x, from.y)) return to;

    const safe = findSafeEndpoint(from.x, from.y, to.x, to.y);

    if (safe.x !== from.x || safe.y !== from.y) {
      const drawBuf = drawBufRef.current;
      if (drawBuf) {
        const ctx = drawBuf.getContext('2d')!;
        if (tool === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = color;
        }
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(safe.x, safe.y);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    return safe.blocked ? { x: safe.x, y: safe.y } : to;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 2) {
      if (isDrawingRef.current) {
        isDrawingRef.current = false;
        lastPtRef.current = null;
      }
      isPinchingRef.current = true;
      const pts = [...activePointersRef.current.values()];
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      pinchStartDistRef.current = Math.sqrt(dx * dx + dy * dy) || 1;
      pinchStartZoomRef.current = zoomRef.current;
      pinchStartPanRef.current = { ...panRef.current };
      pinchStartMidRef.current = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      return;
    }

    if (activePointersRef.current.size > 2 || isPinchingRef.current) return;

    const { x, y } = getCanvasCoords(e);

    if (tool === 'bucket') {
      handleBucketFill(x, y);
      return;
    }

    canvasRef.current?.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    lastPtRef.current = { x, y };

    if (!isOnBoundary(x, y)) {
      const drawBuf = drawBufRef.current;
      if (!drawBuf) return;
      const ctx = drawBuf.getContext('2d')!;
      if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = color;
      }
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      composite();
      if (!hasDrawn) setHasDrawn(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (isPinchingRef.current && activePointersRef.current.size >= 2) {
      e.preventDefault();
      const pts = [...activePointersRef.current.values()];
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scale = dist / pinchStartDistRef.current;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartZoomRef.current * scale));
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const panDelta = {
        x: mid.x - pinchStartMidRef.current.x,
        y: mid.y - pinchStartMidRef.current.y,
      };
      zoomRef.current = newZoom;
      panRef.current = clampPan({
        x: pinchStartPanRef.current.x + panDelta.x,
        y: pinchStartPanRef.current.y + panDelta.y,
      }, newZoom);
      applyTransform();
      setZoomLevel(newZoom);
      return;
    }

    if (!isDrawingRef.current || (tool !== 'brush' && tool !== 'eraser')) return;
    e.preventDefault();

    const coalesced = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [];
    const events = coalesced.length > 0 ? coalesced : [e.nativeEvent as PointerEvent];

    let didDraw = false;
    for (const evt of events) {
      const { x, y } = getCanvasCoords(evt);
      if (lastPtRef.current) {
        const from = lastPtRef.current;
        if (isOnBoundary(from.x, from.y)) {
          if (!isOnBoundary(x, y)) {
            lastPtRef.current = { x, y };
          }
          continue;
        }
        const endPt = drawSegment(from, { x, y });
        lastPtRef.current = endPt;
        didDraw = true;
      } else {
        lastPtRef.current = { x, y };
      }
    }

    if (didDraw) {
      composite();
      if (!hasDrawn) setHasDrawn(true);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);

    if (isPinchingRef.current) {
      if (activePointersRef.current.size < 2) {
        isPinchingRef.current = false;
      }
      return;
    }

    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPtRef.current = null;
    saveHistory();
  };

  const handleBucketFill = (x: number, y: number) => {
    const drawBuf = drawBufRef.current;
    if (!drawBuf) return;
    const ctx = drawBuf.getContext('2d')!;
    const { w, h } = canvasSizeRef.current;
    const imageData = ctx.getImageData(0, 0, w, h);
    const fillRgb = hexToRgb(color);
    const result = floodFill(imageData, Math.round(x), Math.round(y), fillRgb, boundaryOn ? boundaryMaskRef.current : null, 32);
    ctx.putImageData(result, 0, 0);
    composite();
    saveHistory();
    if (!hasDrawn) setHasDrawn(true);
  };

  const handleFileSelected = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file', description: 'Please upload a JPG or PNG image.', variant: 'destructive' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Please upload an image under 10MB.', variant: 'destructive' });
      return;
    }

    setEdgeData(null);
    setPreviewUrl(null);

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      toast({ title: 'Failed to load image', description: 'The file may be corrupted or unsupported.', variant: 'destructive' });
    };
    img.onload = () => {
      const maxDim = 1024;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w;
      tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.drawImage(img, 0, 0, w, h);
      const imageData = tempCtx.getImageData(0, 0, w, h);

      setOriginalImageUrl(tempCanvas.toDataURL());
      setOriginalImageData({ imageData, width: w, height: h });
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  };

  const handleConvertLineArt = () => {
    if (!originalImageData) return;
    setProcessing(true);
    setTimeout(() => {
      try {
        const { imageData, width, height } = originalImageData;
        const edges = computeEdgeMagnitudes(imageData);
        setEdgeData(edges);

        const internalThreshold = 255 * (1 - threshold / 100);
        const lineArt = magnitudesToLineArt(edges.magnitudes, width, height, internalThreshold, lineArtOpts);
        const prevCanvas = document.createElement('canvas');
        prevCanvas.width = width;
        prevCanvas.height = height;
        prevCanvas.getContext('2d')!.putImageData(lineArt, 0, 0);
        setPreviewUrl(prevCanvas.toDataURL());
      } catch {
        toast({ title: 'Processing failed', description: 'Could not convert this image.', variant: 'destructive' });
      }
      setProcessing(false);
    }, 100);
  };

  useEffect(() => {
    if (!edgeData) return;
    const { magnitudes, width, height } = edgeData;
    const internalThreshold = 255 * (1 - threshold / 100);
    const lineArt = magnitudesToLineArt(magnitudes, width, height, internalThreshold, lineArtOpts);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.putImageData(lineArt, 0, 0);
    setPreviewUrl(canvas.toDataURL());
  }, [threshold, edgeData, lineArtOpts]);

  const applyLineArt = () => {
    if (!edgeData) return;
    const { magnitudes, width, height } = edgeData;
    const { w: cw, h: ch } = canvasSizeRef.current;
    const internalThreshold = 255 * (1 - threshold / 100);
    const lineArt = magnitudesToLineArt(magnitudes, width, height, internalThreshold, lineArtOpts);

    const scale = Math.min(cw / width, ch / height);
    const sw = Math.round(width * scale);
    const sh = Math.round(height * scale);
    const ox = Math.round((cw - sw) / 2);
    const oy = Math.round((ch - sh) / 2);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    tempCanvas.getContext('2d')!.putImageData(lineArt, 0, 0);

    const lineArtBuf = lineArtBufRef.current;
    if (!lineArtBuf) return;
    const lineArtCtx = lineArtBuf.getContext('2d')!;
    lineArtCtx.clearRect(0, 0, cw, ch);
    lineArtCtx.drawImage(tempCanvas, ox, oy, sw, sh);

    const imgData = lineArtCtx.getImageData(0, 0, cw, ch);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const brightness = (imgData.data[i] + imgData.data[i + 1] + imgData.data[i + 2]) / 3;
      imgData.data[i] = 0;
      imgData.data[i + 1] = 0;
      imgData.data[i + 2] = 0;
      imgData.data[i + 3] = Math.round(Math.max(0, 255 - brightness));
    }
    lineArtCtx.putImageData(imgData, 0, 0);

    const mask = new Uint8Array(cw * ch);
    for (let i = 0; i < cw * ch; i++) {
      mask[i] = imgData.data[i * 4 + 3] > 80 ? 1 : 0;
    }
    boundaryMaskRef.current = mask;

    const drawBuf = drawBufRef.current;
    if (drawBuf) {
      const drawCtx = drawBuf.getContext('2d')!;
      drawCtx.fillStyle = '#FFFFFF';
      drawCtx.fillRect(0, 0, cw, ch);
    }

    setHasLineArt(true);
    setBoundaryOn(true);
    setHasDrawn(false);
    composite();

    if (drawBuf) {
      historyRef.current = [drawBuf.getContext('2d')!.getImageData(0, 0, cw, ch)];
      historyIdxRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
    }

    setUploadOpen(false);
    setEdgeData(null);
    setPreviewUrl(null);
    setOriginalImageUrl(null);
    setOriginalImageData(null);
    toast({ title: 'Coloring page ready!', description: 'Start coloring inside the lines.' });
  };

  const applyAsIs = () => {
    if (!originalImageData) return;
    const { imageData, width, height } = originalImageData;
    const { w: cw, h: ch } = canvasSizeRef.current;

    const scale = Math.min(cw / width, ch / height);
    const sw = Math.round(width * scale);
    const sh = Math.round(height * scale);
    const ox = Math.round((cw - sw) / 2);
    const oy = Math.round((ch - sh) / 2);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    tempCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

    const bgImageBuf = bgImageBufRef.current;
    if (!bgImageBuf) return;
    const bgCtx = bgImageBuf.getContext('2d')!;
    bgCtx.clearRect(0, 0, cw, ch);
    bgCtx.drawImage(tempCanvas, ox, oy, sw, sh);

    const drawBuf = drawBufRef.current;
    if (!drawBuf) return;
    const drawCtx = drawBuf.getContext('2d')!;
    drawCtx.clearRect(0, 0, cw, ch);

    const lineArtBuf = lineArtBufRef.current;
    if (lineArtBuf) {
      lineArtBuf.getContext('2d')!.clearRect(0, 0, cw, ch);
    }

    const bgData = bgCtx.getImageData(0, 0, cw, ch);
    const mask = new Uint8Array(cw * ch);
    for (let i = 0; i < cw * ch; i++) {
      const r = bgData.data[i * 4];
      const g = bgData.data[i * 4 + 1];
      const b = bgData.data[i * 4 + 2];
      const a = bgData.data[i * 4 + 3];
      mask[i] = a > 0 && (r + g + b) / 3 < 128 ? 1 : 0;
    }
    boundaryMaskRef.current = mask;

    setHasBgImage(true);
    setHasLineArt(false);
    setBoundaryOn(true);
    setHasDrawn(false);
    composite();

    historyRef.current = [drawCtx.getImageData(0, 0, cw, ch)];
    historyIdxRef.current = 0;
    setCanUndo(false);
    setCanRedo(false);

    setUploadOpen(false);
    setEdgeData(null);
    setPreviewUrl(null);
    setOriginalImageUrl(null);
    setOriginalImageData(null);
    toast({ title: 'Image loaded!', description: 'Paint between the lines. Stay in Lines mode is on.' });
  };

  const handleClear = () => {
    const drawBuf = drawBufRef.current;
    if (!drawBuf) return;
    const { w, h } = canvasSizeRef.current;
    const drawCtx = drawBuf.getContext('2d')!;
    if (hasBgImageRef.current) {
      drawCtx.clearRect(0, 0, w, h);
    } else {
      drawCtx.fillStyle = '#FFFFFF';
      drawCtx.fillRect(0, 0, w, h);
    }
    composite();
    saveHistory();
    setHasDrawn(false);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `coloring-${Date.now()}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Saved!', description: 'Your artwork has been downloaded.' });
    }, 'image/png');
  };

  const handleReset = () => {
    const { w, h } = canvasSizeRef.current;
    const drawBuf = drawBufRef.current;
    const lineArtBuf = lineArtBufRef.current;
    const bgImageBuf = bgImageBufRef.current;

    if (drawBuf) {
      const ctx = drawBuf.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
    }
    if (lineArtBuf) {
      lineArtBuf.getContext('2d')!.clearRect(0, 0, w, h);
    }
    if (bgImageBuf) {
      bgImageBuf.getContext('2d')!.clearRect(0, 0, w, h);
    }

    boundaryMaskRef.current = null;
    setHasLineArt(false);
    setHasBgImage(false);
    setBoundaryOn(false);
    setHasDrawn(false);
    handleZoom(1);
    composite();

    if (drawBuf) {
      historyRef.current = [drawBuf.getContext('2d')!.getImageData(0, 0, w, h)];
      historyIdxRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
    }
  };

  const toolBtnClass = (active: boolean) =>
    cn(
      'w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-150',
      'border-2 shadow-sm active:scale-95',
      active
        ? 'bg-violet-100 border-violet-400 text-violet-600 shadow-violet-200/50'
        : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
    );

  const mobileBtnClass = (active: boolean) =>
    cn(
      'w-11 h-11 rounded-xl flex items-center justify-center transition-all border-2 active:scale-95',
      active
        ? 'bg-violet-100 border-violet-400 text-violet-600'
        : 'bg-white border-gray-200 text-gray-500'
    );

  undoRef.current = undo;
  redoRef.current = redo;
  saveRef.current = handleSave;

  return (
    <div
      className="h-screen flex flex-col overflow-hidden select-none"
      style={{ background: 'linear-gradient(135deg, #f5f0ff 0%, #fff0f5 50%, #fffaf0 100%)' }}
    >
      <header className="shrink-0 flex items-center justify-between px-4 py-3 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 shadow-lg z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
            <Palette className="text-white" size={22} />
          </div>
          <h1
            className="text-white text-xl font-bold tracking-wide"
            style={{ fontFamily: "'Architects Daughter', cursive" }}
          >
            ColorPal
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            data-testid="button-upload"
            onClick={() => setUploadOpen(true)}
            className="w-10 h-10 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors active:scale-95"
            title="Upload Image"
          >
            <Upload size={18} />
          </button>
          <button
            data-testid="button-save"
            onClick={handleSave}
            className="w-10 h-10 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors active:scale-95"
            title="Save"
          >
            <Download size={18} />
          </button>
          <button
            data-testid="button-reset"
            onClick={handleReset}
            className="w-10 h-10 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors active:scale-95"
            title="Start Over"
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="hidden md:flex flex-col w-[88px] bg-white/80 backdrop-blur-sm border-r border-gray-100 py-3 px-2 gap-3 items-center overflow-y-auto shrink-0">
          <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Tools</span>
          <div className="flex flex-col gap-2">
            <button data-testid="tool-brush" onClick={() => setTool('brush')} className={toolBtnClass(tool === 'brush')} title="Brush">
              <Paintbrush size={22} />
            </button>
            <button data-testid="tool-bucket" onClick={() => setTool('bucket')} className={toolBtnClass(tool === 'bucket')} title="Fill Bucket">
              <Droplets size={22} />
            </button>
            <button data-testid="tool-eraser" onClick={() => setTool('eraser')} className={toolBtnClass(tool === 'eraser')} title="Eraser">
              <Eraser size={22} />
            </button>
          </div>

          <div className="w-12 h-px bg-gray-200" />

          <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Size</span>
          <div className="flex flex-col gap-1.5">
            {BRUSH_SIZES.map((s, i) => (
              <button
                key={s.label}
                data-testid={`size-${s.label}`}
                onClick={() => setSizeIdx(i)}
                className={cn(
                  'w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-150 border-2 active:scale-95',
                  sizeIdx === i
                    ? 'bg-violet-100 border-violet-400 text-violet-600'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                )}
                title={`Size ${s.label}`}
              >
                <div className="rounded-full bg-current" style={{ width: Math.max(s.value, 6), height: Math.max(s.value, 6) }} />
              </button>
            ))}
          </div>

          <div className="w-12 h-px bg-gray-200" />

          <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Color</span>
          <div className="grid grid-cols-2 gap-1.5">
            {PALETTE_COLORS.map((c) => (
              <button
                key={c}
                data-testid={`color-${c.replace('#', '')}`}
                onClick={() => setColor(c)}
                className={cn(
                  'w-8 h-8 rounded-full border-2 transition-all duration-150 active:scale-90',
                  color === c ? 'ring-2 ring-offset-1 ring-violet-400 scale-110' : 'hover:scale-105',
                  c === '#FFFFFF' ? 'border-gray-300' : 'border-transparent'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          <div className="w-12 h-px bg-gray-200" />

          {(hasLineArt || hasBgImage) && (
            <>
              <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Lines</span>
              <button
                data-testid="toggle-boundary"
                onClick={() => setBoundaryOn(!boundaryOn)}
                className={cn(
                  'w-14 h-14 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all duration-150 border-2 active:scale-95',
                  boundaryOn
                    ? 'bg-emerald-100 border-emerald-400 text-emerald-600'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                )}
                title={boundaryOn ? 'Stay in Lines: ON' : 'Stay in Lines: OFF'}
              >
                {boundaryOn ? <Lock size={18} /> : <Unlock size={18} />}
                <span className="text-[8px] font-bold">{boundaryOn ? 'ON' : 'OFF'}</span>
              </button>
              <div className="w-12 h-px bg-gray-200" />
            </>
          )}

          <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Zoom</span>
          <div className="flex flex-col gap-1.5">
            <button
              data-testid="button-zoom-in"
              onClick={handleZoomIn}
              disabled={zoomLevel >= MAX_ZOOM}
              className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-150 border-2 active:scale-95',
                zoomLevel < MAX_ZOOM
                  ? 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'
              )}
              title="Zoom In"
            >
              <ZoomIn size={18} />
            </button>
            <button
              data-testid="button-zoom-out"
              onClick={handleZoomOut}
              disabled={zoomLevel <= MIN_ZOOM}
              className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-150 border-2 active:scale-95',
                zoomLevel > MIN_ZOOM
                  ? 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'
              )}
              title="Zoom Out"
            >
              <ZoomOut size={18} />
            </button>
            {zoomLevel > 1 && (
              <button
                data-testid="button-zoom-reset"
                onClick={handleZoomReset}
                className="w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-150 border-2 bg-white border-gray-200 text-gray-600 hover:border-gray-300 active:scale-95"
                title="Reset Zoom"
              >
                <Maximize size={18} />
              </button>
            )}
          </div>
          {zoomLevel > 1 && (
            <span className="text-[10px] text-gray-400 font-mono">{Math.round(zoomLevel * 100)}%</span>
          )}

          <div className="w-12 h-px bg-gray-200" />

          <div className="flex flex-col gap-1.5 mt-auto">
            <button
              data-testid="button-undo"
              onClick={undo}
              disabled={!canUndo}
              className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-150 border-2 active:scale-95',
                canUndo
                  ? 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'
              )}
              title="Undo"
            >
              <Undo2 size={18} />
            </button>
            <button
              data-testid="button-redo"
              onClick={redo}
              disabled={!canRedo}
              className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-150 border-2 active:scale-95',
                canRedo
                  ? 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'
              )}
              title="Redo"
            >
              <Redo2 size={18} />
            </button>
            <button
              data-testid="button-clear"
              onClick={handleClear}
              className="w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-150 border-2 bg-white border-gray-200 text-red-400 hover:border-red-300 hover:bg-red-50 active:scale-95"
              title="Clear Drawing"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </aside>

        <main
          ref={containerRef}
          className="flex-1 flex items-center justify-center p-3 min-h-0 min-w-0 overflow-hidden"
        >
          <div ref={canvasWrapperRef} className="relative rounded-2xl shadow-2xl overflow-hidden bg-white" style={{ lineHeight: 0, touchAction: 'none', transformOrigin: 'center center', willChange: 'transform' }}>
            <canvas
              ref={canvasRef}
              data-testid="canvas-drawing"
              className="block"
              style={{
                touchAction: 'none',
                cursor: 'crosshair',
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onContextMenu={(e) => e.preventDefault()}
            />
            {!hasDrawn && !hasLineArt && !hasBgImage && canvasReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
                <div className="w-20 h-20 rounded-3xl bg-violet-100 flex items-center justify-center mb-4">
                  <Palette size={40} className="text-violet-300" />
                </div>
                <p
                  className="text-xl font-bold text-violet-300"
                  style={{ fontFamily: "'Architects Daughter', cursive" }}
                >
                  Start drawing!
                </p>
                <p className="text-sm text-violet-200 mt-1">
                  Or upload an image to color
                </p>
              </div>
            )}
          </div>
        </main>
      </div>

      <div className="md:hidden shrink-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 px-2 py-2 z-10">
        <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <button data-testid="mobile-brush" onClick={() => setTool('brush')} className={mobileBtnClass(tool === 'brush')}>
            <Paintbrush size={18} />
          </button>
          <button data-testid="mobile-bucket" onClick={() => setTool('bucket')} className={mobileBtnClass(tool === 'bucket')}>
            <Droplets size={18} />
          </button>
          <button data-testid="mobile-eraser" onClick={() => setTool('eraser')} className={mobileBtnClass(tool === 'eraser')}>
            <Eraser size={18} />
          </button>

          <div className="w-px h-6 bg-gray-200 shrink-0" />

          {BRUSH_SIZES.map((s, i) => (
            <button
              key={s.label}
              data-testid={`mobile-size-${s.label}`}
              onClick={() => setSizeIdx(i)}
              className={cn(
                'w-9 h-9 rounded-lg flex items-center justify-center transition-all border-2 shrink-0',
                sizeIdx === i
                  ? 'bg-violet-100 border-violet-400 text-violet-600'
                  : 'bg-white border-gray-200 text-gray-500'
              )}
            >
              <div className="rounded-full bg-current" style={{ width: Math.min(s.value, 14) + 2, height: Math.min(s.value, 14) + 2 }} />
            </button>
          ))}

          {(hasLineArt || hasBgImage) && (
            <>
              <div className="w-px h-6 bg-gray-200 shrink-0" />
              <button
                data-testid="mobile-boundary"
                onClick={() => setBoundaryOn(!boundaryOn)}
                className={cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center transition-all border-2 shrink-0',
                  boundaryOn
                    ? 'bg-emerald-100 border-emerald-400 text-emerald-600'
                    : 'bg-white border-gray-200 text-gray-500'
                )}
              >
                {boundaryOn ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
            </>
          )}

          <div className="w-px h-6 bg-gray-200 shrink-0" />

          <button
            data-testid="mobile-zoom-in"
            onClick={handleZoomIn}
            disabled={zoomLevel >= MAX_ZOOM}
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center border-2 shrink-0',
              zoomLevel < MAX_ZOOM ? 'bg-white border-gray-200 text-gray-600' : 'bg-gray-50 border-gray-100 text-gray-300'
            )}
          >
            <ZoomIn size={14} />
          </button>
          <button
            data-testid="mobile-zoom-out"
            onClick={handleZoomOut}
            disabled={zoomLevel <= MIN_ZOOM}
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center border-2 shrink-0',
              zoomLevel > MIN_ZOOM ? 'bg-white border-gray-200 text-gray-600' : 'bg-gray-50 border-gray-100 text-gray-300'
            )}
          >
            <ZoomOut size={14} />
          </button>
          {zoomLevel > 1 && (
            <button
              data-testid="mobile-zoom-reset"
              onClick={handleZoomReset}
              className="w-9 h-9 rounded-lg flex items-center justify-center border-2 bg-white border-gray-200 text-gray-600 shrink-0"
            >
              <Maximize size={14} />
            </button>
          )}

          <div className="w-px h-6 bg-gray-200 shrink-0" />

          <button
            data-testid="mobile-undo"
            onClick={undo}
            disabled={!canUndo}
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center border-2 shrink-0',
              canUndo ? 'bg-white border-gray-200 text-gray-600' : 'bg-gray-50 border-gray-100 text-gray-300'
            )}
          >
            <Undo2 size={14} />
          </button>
          <button
            data-testid="mobile-redo"
            onClick={redo}
            disabled={!canRedo}
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center border-2 shrink-0',
              canRedo ? 'bg-white border-gray-200 text-gray-600' : 'bg-gray-50 border-gray-100 text-gray-300'
            )}
          >
            <Redo2 size={14} />
          </button>
          <button
            data-testid="mobile-clear"
            onClick={handleClear}
            className="w-9 h-9 rounded-lg flex items-center justify-center border-2 bg-white border-gray-200 text-red-400 shrink-0"
          >
            <Trash2 size={14} />
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 px-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {PALETTE_COLORS.map((c) => (
            <button
              key={c}
              data-testid={`mobile-color-${c.replace('#', '')}`}
              onClick={() => setColor(c)}
              className={cn(
                'w-9 h-9 rounded-full border-2 transition-all duration-150 shrink-0 active:scale-90',
                color === c ? 'ring-2 ring-offset-1 ring-violet-400 scale-110' : '',
                c === '#FFFFFF' ? 'border-gray-300' : 'border-transparent'
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) {
            setEdgeData(null);
            setPreviewUrl(null);
            setOriginalImageUrl(null);
            setOriginalImageData(null);
            setProcessing(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImagePlus size={20} className="text-violet-500" />
              Upload an Image
            </DialogTitle>
            <DialogDescription>
              Upload a photo to convert it into a coloring page
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!originalImageUrl && !processing && (
              <div
                className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center cursor-pointer hover:border-violet-400 hover:bg-violet-50/50 transition-all"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleFileSelected(f);
                }}
              >
                <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-violet-100 flex items-center justify-center">
                  <ImagePlus className="text-violet-400" size={32} />
                </div>
                <p className="text-sm font-medium text-gray-600">Click or drag an image here</p>
                <p className="text-xs text-gray-400 mt-1">JPG or PNG, max 10MB</p>
                <input
                  ref={fileInputRef}
                  data-testid="input-file-upload"
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelected(f);
                    e.target.value = '';
                  }}
                />
              </div>
            )}

            {originalImageUrl && !edgeData && !processing && (
              <>
                <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                  <img
                    src={originalImageUrl}
                    alt="Original image"
                    className="w-full h-auto max-h-64 object-contain"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    data-testid="button-convert-line-art"
                    className="flex-1 bg-violet-500 hover:bg-violet-600 text-white"
                    onClick={handleConvertLineArt}
                  >
                    Convert
                  </Button>
                  <Button
                    data-testid="button-load-as-is"
                    className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white"
                    onClick={applyAsIs}
                  >
                    Use as is
                  </Button>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setOriginalImageUrl(null);
                    setOriginalImageData(null);
                  }}
                >
                  Choose Different Image
                </Button>
              </>
            )}

            {processing && (
              <div className="flex flex-col items-center py-12">
                <Loader2 className="animate-spin text-violet-500 mb-3" size={48} />
                <p className="text-sm text-gray-500 font-medium">Converting to coloring page...</p>
                <p className="text-xs text-gray-400 mt-1">This may take a moment</p>
              </div>
            )}

            {previewUrl && !processing && (
              <>
                <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                  <img
                    src={previewUrl}
                    alt="Line art preview"
                    className="w-full h-auto max-h-64 object-contain"
                    data-testid="img-preview"
                  />
                </div>

                <div className="space-y-3 px-1">
                  <div>
                    <span className="text-sm font-medium text-gray-700">Line Style</span>
                    <div className="flex gap-2 mt-2">
                      {(Object.entries(AGE_PRESETS) as [AgePreset, typeof AGE_PRESETS[AgePreset]][]).map(([key, preset]) => (
                        <button
                          key={key}
                          data-testid={`preset-${key}`}
                          onClick={() => {
                            setAgePreset(key);
                            setThreshold(preset.threshold);
                            setLineArtOpts(preset.options);
                          }}
                          className={cn(
                            'flex-1 py-2 px-3 rounded-xl border-2 transition-all text-center active:scale-95',
                            agePreset === key
                              ? 'bg-violet-100 border-violet-400 text-violet-700'
                              : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                          )}
                        >
                          <div className="text-sm font-semibold">{preset.label}</div>
                          <div className="text-[10px] text-gray-400">Ages {preset.ages}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-500">Fine-tune</span>
                      <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{threshold}%</span>
                    </div>
                    <Slider
                      data-testid="slider-threshold"
                      value={[threshold]}
                      onValueChange={(v) => setThreshold(v[0])}
                      min={10}
                      max={90}
                      step={1}
                    />
                    <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                      <span>Fewer lines</span>
                      <span>More lines</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    data-testid="button-try-another"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setEdgeData(null);
                      setPreviewUrl(null);
                    }}
                  >
                    Try Another
                  </Button>
                  <Button
                    data-testid="button-apply"
                    className="flex-1 bg-violet-500 hover:bg-violet-600 text-white"
                    onClick={applyLineArt}
                  >
                    Use This
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
