import { useEffect, useRef, useState } from "react";
import { RotateCcw, RotateCw, RefreshCw, X, ZoomIn, ZoomOut, Maximize2, Crop } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface RegionRect { x: number; y: number; w: number; h: number }

export function ImageLightbox({
  src,
  onClose,
  onRegionScan,
}: {
  src: string;
  onClose: () => void;
  /** Called with rectangle in natural image coordinates */
  onRegionScan?: (rect: RegionRect) => void;
}) {
  const { t } = useTranslation();
  const [rot, setRot] = useState(0);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [mode, setMode] = useState<"view" | "crop">("view");
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [clickStart, setClickStart] = useState<{ x: number; y: number } | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setRot(0); setScale(1); setTx(0); setTy(0); setMode("view"); setDrag(null); setClickStart(null); setHoverPos(null); }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setRot((r) => r - 90);
      else if (e.key === "ArrowRight") setRot((r) => r + 90);
      else if (e.key === "0") { setRot(0); setScale(1); setTx(0); setTy(0); }
      else if (e.key === "+" || e.key === "=") setScale((s) => Math.min(8, s * 1.2));
      else if (e.key === "-") setScale((s) => Math.max(0.2, s / 1.2));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Pinch zoom (mobile)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastDist = 0;
    const dist = (t: TouchList) => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.hypot(dx, dy);
    };
    const onStart = (e: TouchEvent) => { if (e.touches.length === 2) lastDist = dist(e.touches); };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const d = dist(e.touches);
        if (lastDist) setScale((s) => Math.max(0.2, Math.min(8, s * (d / lastDist))));
        lastDist = d;
      }
    };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
    };
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setScale((s) => Math.max(0.2, Math.min(8, s * k)));
  };

  // Mouse pan in view mode
  const panState = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    if (mode === "crop") {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      setDrag({ x0: x, y0: y, x1: x, y1: y });
    } else {
      panState.current = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (mode === "crop") {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (drag) setDrag({ ...drag, x1: x, y1: y });
      else if (clickStart) setHoverPos({ x, y });
    } else if (panState.current) {
      const dx = e.clientX - panState.current.x;
      const dy = e.clientY - panState.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) panState.current.moved = true;
      setTx(panState.current.tx + dx);
      setTy(panState.current.ty + dy);
    }
  };
  const onMouseUp = (e?: React.MouseEvent) => {
    panState.current = null;
    if (mode === "crop" && drag) {
      const dragged = Math.abs(drag.x1 - drag.x0) >= 8 || Math.abs(drag.y1 - drag.y0) >= 8;
      if (dragged) { runCrop(drag); return; }
      // Treat as a click → desktop click-click selection
      if (e) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        handleCropClick(e.clientX - rect.left, e.clientY - rect.top);
      }
      setDrag(null);
    }
  };
  const handleCropClick = (x: number, y: number) => {
    if (!clickStart) {
      setClickStart({ x, y });
      setHoverPos({ x, y });
    } else {
      runCrop({ x0: clickStart.x, y0: clickStart.y, x1: x, y1: y });
      setClickStart(null);
      setHoverPos(null);
    }
  };
  const onContainerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === "crop") return;
    if (panState.current?.moved) return;
    if (e.target === e.currentTarget) onClose();
  };


  const runCrop = (d: { x0: number; y0: number; x1: number; y1: number }) => {
    if (!imgRef.current) return;
    const img = imgRef.current;
    const rect = img.getBoundingClientRect();
    const cont = containerRef.current!.getBoundingClientRect();
    const dx0 = Math.min(d.x0, d.x1) + cont.left - rect.left;
    const dy0 = Math.min(d.y0, d.y1) + cont.top - rect.top;
    const dw = Math.abs(d.x1 - d.x0);
    const dh = Math.abs(d.y1 - d.y0);
    if (dw < 8 || dh < 8) { setDrag(null); return; }
    const sx = img.naturalWidth / rect.width;
    const sy = img.naturalHeight / rect.height;
    onRegionScan?.({
      x: Math.max(0, dx0 * sx),
      y: Math.max(0, dy0 * sy),
      w: Math.min(img.naturalWidth, dw * sx),
      h: Math.min(img.naturalHeight, dh * sy),
    });
    setDrag(null);
    setMode("view");
  };
  const confirmCrop = () => { if (drag) runCrop(drag); };


  const Btn = ({ onClick, title, active, children }: any) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={`rounded-full p-2 transition text-white ${active ? "bg-primary" : "bg-white/10 hover:bg-white/20"}`}
    >{children}</button>
  );

  const previewBox = drag
    ? { x0: drag.x0, y0: drag.y0, x1: drag.x1, y1: drag.y1 }
    : (clickStart && hoverPos ? { x0: clickStart.x, y0: clickStart.y, x1: hoverPos.x, y1: hoverPos.y } : null);
  const drawRect = previewBox && {
    left: Math.min(previewBox.x0, previewBox.x1),
    top: Math.min(previewBox.y0, previewBox.y1),
    width: Math.abs(previewBox.x1 - previewBox.x0),
    height: Math.abs(previewBox.y1 - previewBox.y0),
  };

  return (
    <div
      className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div className="absolute top-3 right-3 flex flex-wrap gap-2 z-10" onClick={(e) => e.stopPropagation()}>
        <Btn onClick={() => setScale((s) => Math.min(8, s * 1.2))} title={t("lightbox.zoomIn")}><ZoomIn className="h-4 w-4" /></Btn>
        <Btn onClick={() => setScale((s) => Math.max(0.2, s / 1.2))} title={t("lightbox.zoomOut")}><ZoomOut className="h-4 w-4" /></Btn>
        <Btn onClick={() => { setScale(1); setTx(0); setTy(0); }} title={t("lightbox.fit")}><Maximize2 className="h-4 w-4" /></Btn>
        <Btn onClick={() => setRot((r) => r - 90)} title={t("lightbox.rotateLeft")}><RotateCcw className="h-4 w-4" /></Btn>
        <Btn onClick={() => setRot((r) => r + 90)} title={t("lightbox.rotateRight")}><RotateCw className="h-4 w-4" /></Btn>
        <Btn onClick={() => { setRot(0); setScale(1); setTx(0); setTy(0); }} title={t("lightbox.reset")}><RefreshCw className="h-4 w-4" /></Btn>
        {onRegionScan && (
          <Btn onClick={() => setMode(mode === "crop" ? "view" : "crop")} active={mode === "crop"} title={t("lightbox.scanRegion")}>
            <Crop className="h-4 w-4" />
          </Btn>
        )}
        {mode === "crop" && (drag || clickStart) && (
          <Btn onClick={() => { setDrag(null); setClickStart(null); setHoverPos(null); }} title={t("lightbox.close")}><X className="h-4 w-4" /></Btn>
        )}
        <Btn onClick={onClose} title={t("lightbox.close")}><X className="h-4 w-4" /></Btn>
      </div>

      {mode === "crop" && (
        <div className="absolute top-3 left-3 text-white text-xs bg-black/50 px-2 py-1 rounded z-10">
          {t("lightbox.cropHint")}
        </div>
      )}

      <div
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center overflow-hidden"
        onClick={onContainerClick}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{ cursor: mode === "crop" ? "crosshair" : (panState.current ? "grabbing" : "grab") }}
      >
        <img
          ref={imgRef}
          src={src}
          draggable={false}
          style={{
            transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${scale})`,
            transition: panState.current ? "none" : "transform 150ms ease",
            transformOrigin: "center center",
          }}
          className="max-h-[90vh] max-w-[95vw] object-contain select-none pointer-events-none"
        />
        {drawRect && (
          <div
            className="absolute border-2 border-primary bg-primary/10 pointer-events-none"
            style={drawRect}
          />
        )}
      </div>
    </div>
  );
}
