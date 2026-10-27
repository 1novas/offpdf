/**
 * The text lines of one page as real buttons in reading order (SPEC §D.5,
 * §D.6, §D.9, §D.10): one Tab stop with roving focus, arrows move through
 * `readingNeighbour`, Enter/F2/Space edit or explain, Delete restores, Esc
 * leaves. The pointer is hit-tested by the layer itself (smallest box, then
 * nearest baseline; ≥ 24 px tall hit areas), edited lines with their new
 * geometry. Only lines near the visible part of the stage are rendered, plus
 * the focused, open and edited ones.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  caretIndexAt,
  displayedSize,
  editedGeometry,
  makeMapping,
  pdfRectToViewport,
  pdfToViewport,
  problemMessage,
  readingNeighbour,
  viewportToPdf,
  type CssRect,
  type NeighbourKey,
  type SourceTextObject,
} from "@/lib/editor";
import { UI, editedRunLabel, fillCopy, reasonCopy, warningCopy } from "@/lib/editor/sourceTextCopy";
import type { TextFont, TextPreview, TextRun } from "@/lib/types";
import type { PageLayout } from "../PageSurface";

const MIN_HIT_PX = 24;
const VIEW_MARGIN_PX = 200;
const TOOLTIP_DELAY_MS = 400;
/** A click that arrives this soon after a key activation is the browser's echo of it. */
const KEY_ECHO_MS = 500;

const KEYS: Record<string, NeighbourKey> = {
  ArrowDown: "down",
  ArrowUp: "up",
  ArrowRight: "right",
  ArrowLeft: "left",
  Home: "home",
  End: "end",
  PageUp: "pageUp",
  PageDown: "pageDown",
};

interface RunView {
  run: TextRun;
  obj: SourceTextObject | null;
  css: CssRect;
  hit: CssRect;
  area: number;
  caretOffsets: number[];
  /** The line's current origin on screen. */
  origin: { x: number; y: number };
  /** The same origin in unrotated PDF user space (a moved line is not `run.origin`). */
  pdfOrigin: { x: number; y: number };
  dir: { x: number; y: number };
  label: string;
  describe: string;
  state: "editable" | "refused" | "edited";
  flagged: "warning" | "problem" | null;
}

export interface SourceTextLayerProps {
  runs: TextRun[];
  objects: SourceTextObject[];
  fonts: Map<string, TextFont>;
  layout: PageLayout;
  /** 1-based page number for the layer's label. */
  pageNumber: number;
  /** The preview answer for the page's current changes, if any. */
  preview: TextPreview | null;
  /** The page is listed twice: everything is shown refused and never edited. */
  duplicate: boolean;
  focusedId: string | null;
  /** Bumped to move DOM focus to `focusedId`. */
  focusTick: number;
  editingId: string | null;
  popoverId: string | null;
  /** Scroll container, for rendering only what is near view. */
  stage: HTMLElement | null;
  /** Space-to-pan is active: let the stage take the pointer. */
  inert: boolean;
  onFocusedChange: (id: string, moveFocus: boolean) => void;
  onEdit: (run: TextRun, caret: number | "all") => void;
  onExplain: (run: TextRun) => void;
  onRestore: (obj: SourceTextObject) => void;
  /** Add a user-space displacement to the line (one undo step per call). */
  onMove: (run: TextRun, delta: { x: number; y: number }) => void | Promise<void>;
  onLeave: () => void;
}

/** Text of the next run on the same line, for the overlap message. */
export function nextOnLine(runs: TextRun[], run: TextRun): TextRun | null {
  let best: TextRun | null = null;
  for (const r of runs) if (r.line === run.line && r.order > run.order && (!best || r.order < best.order)) best = r;
  return best;
}

function contains(r: CssRect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function intersects(a: CssRect, b: CssRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function hitTest(views: RunView[], p: { x: number; y: number }): RunView | null {
  let best: RunView | null = null;
  let bestDist = Infinity;
  for (const v of views) {
    if (!contains(v.hit, p)) continue;
    const dist = Math.abs((p.x - v.origin.x) * v.dir.y - (p.y - v.origin.y) * v.dir.x);
    if (!best || v.area < best.area - 0.5 || (Math.abs(v.area - best.area) <= 0.5 && dist < bestDist)) {
      best = v;
      bestDist = dist;
    }
  }
  return best;
}

type ViewInputs = Pick<SourceTextLayerProps, "runs" | "objects" | "fonts" | "layout" | "preview" | "duplicate">;

function buildViews({ runs, objects, fonts, layout, preview, duplicate }: ViewInputs): RunView[] {
  const mapping = makeMapping(layout.geometry, layout.cssWidth, layout.cssHeight);
  const byRun = new Map(objects.map((o) => [o.runId, o]));
  const verdicts = new Map((preview?.verdicts ?? []).map((v) => [v.runId, v]));
  const warningsByRun = new Map<string, TextPreview["warnings"]>();
  let hasOverlapWarning = false;
  for (const warning of preview?.warnings ?? []) {
    if (warning.code === "NEXT_TEXT_OVERLAP") hasOverlapWarning = true;
    const warnings = warningsByRun.get(warning.runId) ?? [];
    warnings.push(warning);
    warningsByRun.set(warning.runId, warnings);
  }
  const ordered = runs.slice().sort((a, b) => a.order - b.order);
  const nextByRun = new Map<string, TextRun>();
  if (hasOverlapWarning) {
    // A warning needs the first later run on its line. Equal-order runs share a successor.
    const lines = new Map<number, TextRun[]>();
    for (const run of ordered) {
      const line = lines.get(run.line) ?? [];
      line.push(run);
      lines.set(run.line, line);
    }
    for (const line of lines.values()) {
      for (let first = 0; first < line.length;) {
        let after = first + 1;
        while (after < line.length && line[after].order === line[first].order) after++;
        if (after < line.length) {
          for (let i = first; i < after; i++) nextByRun.set(line[i].id, line[after]);
        }
        first = after;
      }
    }
  }
  return ordered.map((run) => {
    const obj = byRun.get(run.id) ?? null;
    const verdict = verdicts.get(run.id) ?? null;
    const geom = obj
      ? editedGeometry(run, obj, verdict, fonts)
      : { rect: run.rect, caretOffsets: run.caretOffsets, origin: run.origin };
    const css = pdfRectToViewport(geom.rect, mapping);
    const h = Math.max(css.h, MIN_HIT_PX);
    const o = pdfToViewport(geom.origin, mapping);
    const o2 = pdfToViewport({ x: geom.origin.x + run.dir.x, y: geom.origin.y + run.dir.y }, mapping);
    const len = Math.hypot(o2.x - o.x, o2.y - o.y) || 1;
    const notes: string[] = [];
    let flagged: RunView["flagged"] = null;
    if (verdict && !verdict.ok && obj) {
      notes.push(problemMessage(verdict, run, fonts));
      flagged = "problem";
    }
    for (const w of warningsByRun.get(run.id) ?? []) {
      notes.push(warningCopy(w.code, nextByRun.get(run.id)?.text));
      flagged = flagged ?? "warning";
    }
    if (run.substituted) notes.push(UI.substituted);
    const refused = duplicate || !run.editable;
    if (duplicate) notes.unshift(UI.banner.duplicatePage);
    else if (!run.editable) notes.unshift(fillCopy(UI.run.refusedDescribe, { short: reasonCopy(run.reason).short }));
    else notes.push(UI.run.moveHint);
    return {
      run,
      obj,
      css,
      hit: { x: css.x, y: css.y + css.h / 2 - h / 2, w: css.w, h },
      area: css.w * css.h,
      caretOffsets: geom.caretOffsets,
      origin: o,
      pdfOrigin: { x: geom.origin.x, y: geom.origin.y },
      dir: { x: (o2.x - o.x) / len, y: (o2.y - o.y) / len },
      label: refused
        ? run.text
        : obj
          ? editedRunLabel(obj.text, obj.originalText)
          : fillCopy(UI.run.editable, { text: run.text }),
      describe: notes.join(" "),
      state: refused ? "refused" : obj ? "edited" : "editable",
      flagged,
    };
  });
}

export function SourceTextLayer(props: SourceTextLayerProps) {
  const { layout, duplicate, focusedId, focusTick, stage } = props;
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const keyEcho = useRef(0);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tipId, setTipId] = useState<string | null>(null);
  const [view, setView] = useState<CssRect | null>(null);

  const { runs, objects, fonts, preview } = props;
  const views = useMemo(
    () => buildViews({ runs, objects, fonts, layout, preview, duplicate }),
    [runs, objects, fonts, layout, preview, duplicate],
  );
  const viewById = useMemo(() => new Map(views.map((v) => [v.run.id, v])), [views]);
  const rovingId = focusedId && viewById.has(focusedId) ? focusedId : (views[0]?.run.id ?? null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!stage || !root) {
      setView(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const s = stage.getBoundingClientRect();
      const l = root.getBoundingClientRect();
      const m = VIEW_MARGIN_PX;
      setView({ x: s.left - l.left - m, y: s.top - l.top - m, w: s.width + 2 * m, h: s.height + 2 * m });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    stage.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      stage.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [stage, layout]);

  // Move DOM focus only when asked (`focusTick`), never because the roving line changed.
  const focusedRef = useRef(focusedId);
  focusedRef.current = focusedId;
  useEffect(() => {
    const id = focusedRef.current;
    if (!focusTick || !id) return;
    const el = buttons.current.get(id);
    el?.focus();
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [focusTick]);

  const tipText = (v: RunView | null): string | null => {
    if (!v || duplicate) return null;
    if (v.state === "refused") return fillCopy(UI.run.refusedDescribe, { short: reasonCopy(v.run.reason).short });
    return v.run.substituted ? UI.substituted : null;
  };
  const hovered = hoverId ? viewById.get(hoverId) ?? null : null;
  const hoveredTip = tipText(hovered);
  useEffect(() => {
    setTipId(null);
    if (!hoveredTip || !hoverId) return;
    const timer = setTimeout(() => setTipId(hoverId), TOOLTIP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hoverId, hoveredTip]);

  const shown = useMemo(() => {
    const pinned = new Set([rovingId, props.editingId, props.popoverId, ...objects.map((o) => o.runId)]);
    return views.filter((v) => pinned.has(v.run.id) || !view || intersects(v.hit, view));
  }, [views, view, rovingId, props.editingId, props.popoverId, objects]);

  const moveBusy = useRef(false);

  const activate = (v: RunView, caret: number | "all") => {
    if (moveBusy.current) return;
    props.onFocusedChange(v.run.id, false);
    if (duplicate) return;
    if (v.run.editable) props.onEdit(v.run, caret);
    else props.onExplain(v.run);
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const mapping = makeMapping(layout.geometry, layout.cssWidth, layout.cssHeight);
  const pxPerPt = layout.cssWidth / Math.max(displayedSize(layout.geometry).w, 1);
  /** A screen-space displacement as an unrotated PDF delta (works for /Rotate 0/90/180/270). */
  const screenDeltaToPdf = (dxPx: number, dyPx: number) => {
    const p0 = viewportToPdf({ x: 0, y: 0 }, mapping);
    const p1 = viewportToPdf({ x: dxPx, y: dyPx }, mapping);
    return { x: p1.x - p0.x, y: p1.y - p0.y };
  };

  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const dragRef = useRef<{
    id: string;
    run: TextRun;
    pointerId: number;
    start: { x: number; y: number };
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);

  /** Start one move, keeping its pending position until the preview commits or refuses it. */
  const applyMove = (run: TextRun, delta: { x: number; y: number }, after?: () => void) => {
    if (moveBusy.current) {
      after?.();
      return;
    }
    moveBusy.current = true;
    let result: void | Promise<void>;
    try {
      result = props.onMove(run, delta);
    } catch {
      moveBusy.current = false;
      after?.();
      return;
    }
    void Promise.resolve(result)
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        moveBusy.current = false;
        after?.();
      });
  };

  // The line buttons are pointer-events: none (the layer hit-tests the page), so the drag itself
  // lives on the layer. Keyboard activation still goes through the buttons.
  const startDrag = (e: PointerEvent<HTMLDivElement>, v: RunView) => {
    // Moving is planned with the other committed changes; an open draft is not committed yet.
    if (
      moveBusy.current ||
      props.inert ||
      duplicate ||
      props.editingId ||
      !v.run.editable ||
      e.button !== 0
    ) {
      return;
    }
    dragRef.current = {
      id: v.run.id,
      run: v.run,
      pointerId: e.pointerId,
      start: local(e),
      dx: 0,
      dy: 0,
      moved: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = local(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    d.dx = dx;
    d.dy = dy;
    setDrag({ id: d.id, dx, dy });
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(d.pointerId)) {
      e.currentTarget.releasePointerCapture(d.pointerId);
    }
    if (!d.moved) {
      setDrag(null);
      return;
    }
    // A drag is not a click, even when it is too small to be a move.
    keyEcho.current = Date.now();
    if (cancelled) {
      setDrag(null);
      return;
    }
    const p0 = viewportToPdf(d.start, mapping);
    const p1 = viewportToPdf({ x: d.start.x + d.dx, y: d.start.y + d.dy }, mapping);
    const delta = { x: p1.x - p0.x, y: p1.y - p0.y };
    if (Math.hypot(delta.x, delta.y) < 0.01) {
      setDrag(null);
      return;
    }
    applyMove(d.run, delta, () => setDrag(null));
  };

  const onRunKeyDown = (e: KeyboardEvent<HTMLButtonElement>, v: RunView) => {
    if (e.altKey && e.key.startsWith("Arrow")) {
      e.preventDefault();
      e.stopPropagation();
      if (moveBusy.current || duplicate || props.editingId || !v.run.editable || props.inert) return;
      const step = (e.shiftKey ? 10 : 1) * pxPerPt;
      const delta = screenDeltaToPdf(
        e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0,
        e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0,
      );
      if (Math.hypot(delta.x, delta.y) >= 0.01) applyMove(v.run, delta);
      return;
    }
    const move = KEYS[e.key];
    if (move) {
      e.preventDefault();
      e.stopPropagation();
      const next = readingNeighbour(runs, v.run.id, move);
      if (next) props.onFocusedChange(next, true);
    } else if (e.key === "Enter" || e.key === "F2" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      keyEcho.current = Date.now();
      activate(v, "all");
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      if (v.obj) props.onRestore(v.obj);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onLeave();
    }
  };

  // The reason dialog opens where the tooltip sits (just under the line) and says more: no tooltip under it.
  const tip = props.popoverId || !tipId ? null : viewById.get(tipId) ?? null;
  const cursor = hovered ? (hovered.state === "refused" ? " is-over-refused" : " is-over-editable") : "";

  return (
    <div
      ref={rootRef}
      className={`st-layer${props.inert ? " is-inert" : ""}${cursor}`}
      role="group"
      aria-label={fillCopy(UI.layer.label, { n: props.pageNumber })}
      data-source-text=""
      style={
        !props.inert && !duplicate && views.some((v) => v.run.editable) ? { touchAction: "none" } : undefined
      }
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        const v = hitTest(views, local(e));
        if (v) startDrag(e, v);
      }}
      onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
        moveDrag(e);
        setHoverId(hitTest(views, local(e))?.run.id ?? null);
      }}
      onPointerUp={(e: PointerEvent<HTMLDivElement>) => endDrag(e, false)}
      onPointerCancel={(e: PointerEvent<HTMLDivElement>) => endDrag(e, true)}
      onLostPointerCapture={(e: PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId === e.pointerId) {
          dragRef.current = null;
          setDrag(null);
        }
      }}
      onPointerLeave={() => setHoverId(null)}
      onClick={(e) => {
        if (e.target !== e.currentTarget || e.button !== 0) return;
        // A completed drag must not also open the line at its old position.
        if (Date.now() - keyEcho.current <= KEY_ECHO_MS) return;
        const p = local(e);
        const v = hitTest(views, p);
        if (v) {
          activate(
            v,
            v.run.editable ? caretIndexAt(v.run, viewportToPdf(p, mapping), v.caretOffsets, v.pdfOrigin) : "all",
          );
        }
      }}
    >
      {shown.map((v, i) => {
        const pending = drag?.id === v.run.id ? drag : null;
        return (
          <button
            key={v.run.id}
            ref={(el) => {
              if (el) buttons.current.set(v.run.id, el);
              else buttons.current.delete(v.run.id);
            }}
            type="button"
            className={`st-run is-${v.state}${v.flagged ? ` is-${v.flagged}` : ""}${v.run.substituted ? " is-substituted" : ""}${hoverId === v.run.id ? " is-hover" : ""}${pending ? " is-dragging" : ""}`}
            style={{
              left: v.css.x,
              top: v.css.y,
              width: Math.max(v.css.w, 1),
              height: Math.max(v.css.h, 1),
              ...(pending ? { transform: `translate(${pending.dx}px, ${pending.dy}px)` } : {}),
            }}
            tabIndex={v.run.id === rovingId ? 0 : -1}
            aria-label={v.label}
            aria-disabled={v.state === "refused" ? true : undefined}
            aria-describedby={v.describe ? `${uid}-d${i}` : undefined}
            aria-keyshortcuts={v.run.editable ? "Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown" : undefined}
            onFocus={() => v.run.id !== focusedId && props.onFocusedChange(v.run.id, false)}
            onKeyDown={(e) => onRunKeyDown(e, v)}
            onKeyUp={(e) => e.key === " " && e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              if (Date.now() - keyEcho.current > KEY_ECHO_MS) activate(v, "all");
            }}
          >
            {v.flagged && <Icon name="alertTriangle" size={12} className="st-run__flag" />}
            {v.run.substituted && v.state !== "refused" && <span className="st-run__badge" aria-hidden>i</span>}
            {v.state === "edited" && <span className="st-run__dot" aria-hidden />}
          </button>
        );
      })}
      <div hidden>
        {shown.map((v, i) => (v.describe ? <span key={v.run.id} id={`${uid}-d${i}`}>{v.describe}</span> : null))}
      </div>
      {tip && tipText(tip) && (
        <div className="st-tooltip" role="tooltip" style={{ left: tip.css.x, top: tip.css.y + tip.css.h + 4 }}>
          {tipText(tip)}
        </div>
      )}
    </div>
  );
}
