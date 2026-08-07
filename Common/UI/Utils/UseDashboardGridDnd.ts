import GridLayoutUtil, { GridRect } from "../../Utils/Dashboard/GridLayout";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Drag-and-drop + resize controller for the dashboard grid.
 *
 * Design notes, because the split of responsibilities is what makes this
 * feel smooth:
 *
 * - The ACTIVE widget's DOM element is driven imperatively (transform /
 *   width / height updated in a requestAnimationFrame loop). React never
 *   repositions it mid-gesture, so charts and tables inside it are not
 *   re-rendered 60 times a second.
 * - Everything else — the snapped drop placeholder and neighbours being
 *   pushed out of the way — renders through React state, but that state
 *   only changes when the SNAPPED grid cell changes (a few times per
 *   gesture), never per pointer event.
 * - The preview layout is always recomputed from the layout as it was when
 *   the gesture started (`moveRect`/`resizeRect` are pure), so wiggling the
 *   pointer back and forth can never accumulate stray pushes.
 * - On drop or cancel the element is "settled" imperatively to its final
 *   rect with transitions enabled, giving a snap-into-place animation, and
 *   React then renders the exact same values so there is nothing to fight
 *   over.
 */

export type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type GridDndMode = "move" | "resize";

export interface GridDndMetrics {
  /** Width (= height) of one dashboard unit, in px. */
  unitSizeInPx: number;
  /** Gap between units, in px. */
  gapInPx: number;
  columns: number;
}

export interface DashboardGridDndProps {
  /** Committed layout, one rect per widget. */
  items: Array<GridRect>;
  metrics: GridDndMetrics;
  isEnabled: boolean;
  /** The positioning container widgets are absolutely placed in. */
  canvasRef: React.RefObject<HTMLElement>;
  onCommit: (rects: Array<GridRect>) => void;
  /** Pointer went down and came up without dragging — treat as a click. */
  onItemClick?: ((id: string) => void) | undefined;
}

export interface DashboardGridDndResult {
  /**
   * Rects to render each widget at. While a gesture is active the active
   * widget stays pinned at its origin (its DOM node is moved imperatively)
   * and neighbours reflect the live push-preview.
   */
  rects: Array<GridRect>;
  /** Snapped destination of the active widget — render the drop ghost here. */
  placeholderRect: GridRect | null;
  /** Rows needed to contain the live layout (including the placeholder). */
  totalRows: number;
  activeId: string | null;
  activeMode: GridDndMode | null;
  /** True once the pointer has actually moved past the drag threshold. */
  isGestureActive: boolean;
  registerItemElement: (id: string, element: HTMLElement | null) => void;
  startMove: (id: string, event: React.PointerEvent) => void;
  startResize: (
    id: string,
    direction: ResizeDirection,
    event: React.PointerEvent,
  ) => void;
}

/** Pointer must travel this many px before a press becomes a drag. */
const DRAG_THRESHOLD_IN_PX: number = 5;

/** Distance from the scroll-viewport edge where auto-scroll kicks in. */
const AUTO_SCROLL_EDGE_IN_PX: number = 72;

/** Fastest auto-scroll speed, px per frame. */
const AUTO_SCROLL_MAX_SPEED_IN_PX: number = 28;

/**
 * How many rows past the current board bottom a single gesture may reach.
 * Without a cap, dragging against the bottom edge auto-scrolls forever:
 * the container grows to fit the candidate, which mints fresh scroll room,
 * which moves the candidate further down. Committing near the cap raises
 * the board bottom, so taller boards remain reachable across gestures.
 */
const AUTO_GROW_SLACK_ROWS: number = 6;

/**
 * Transition the canvas should put on every idle widget wrapper. The hook
 * writes the exact same string when settling a dropped widget, so React's
 * subsequent render is guaranteed to be a no-op style-wise.
 */
export const GRID_ITEM_TRANSITION: string =
  "transform 0.22s cubic-bezier(0.2, 0, 0, 1), width 0.22s cubic-bezier(0.2, 0, 0, 1), height 0.22s cubic-bezier(0.2, 0, 0, 1)";

interface PxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GestureSession {
  id: string;
  mode: GridDndMode;
  direction: ResizeDirection | null;
  pointerId: number;
  /** Normalized snapshot of the layout when the gesture began. */
  originRects: Array<GridRect>;
  originRect: GridRect;
  /** Pointer position, canvas-relative, at gesture start. */
  startCanvasX: number;
  startCanvasY: number;
  /** Pointer position, client coords, at gesture start (for threshold). */
  startClientX: number;
  startClientY: number;
  latestClientX: number;
  latestClientY: number;
  /**
   * Where inside the widget the pointer grabbed it, as a FRACTION of the
   * widget's size — fractions survive mid-drag zoom/resize of the canvas,
   * frozen pixel offsets do not.
   */
  grabFracX: number;
  grabFracY: number;
  /** Lowest row edge this gesture is allowed to reach. */
  maxBottomUnits: number;
  started: boolean;
  /** Snapped candidate rect currently previewed. */
  candidate: GridRect;
  rafId: number | null;
  /**
   * Removes exactly the window listeners this session added. Stored on the
   * session because later renders create new handler instances — any
   * endGesture closure must detach the ORIGINAL ones.
   */
  detach: (() => void) | null;
}

interface PreviewState {
  rects: Array<GridRect>;
  activeRect: GridRect;
}

interface GestureState {
  id: string;
  mode: GridDndMode;
  started: boolean;
}

type UseDashboardGridDndFunction = (
  props: DashboardGridDndProps,
) => DashboardGridDndResult;

const useDashboardGridDnd: UseDashboardGridDndFunction = (
  props: DashboardGridDndProps,
): DashboardGridDndResult => {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [gesture, setGesture] = useState<GestureState | null>(null);

  const sessionRef: React.MutableRefObject<GestureSession | null> =
    useRef<GestureSession | null>(null);
  const elementsRef: React.MutableRefObject<Map<string, HTMLElement>> = useRef<
    Map<string, HTMLElement>
  >(new Map<string, HTMLElement>());

  // Live mirrors so the imperative handlers never see stale props.
  const propsRef: React.MutableRefObject<DashboardGridDndProps> =
    useRef<DashboardGridDndProps>(props);
  propsRef.current = props;

  const registerItemElement: (id: string, element: HTMLElement | null) => void =
    useCallback((id: string, element: HTMLElement | null): void => {
      if (element) {
        elementsRef.current.set(id, element);
      } else {
        elementsRef.current.delete(id);
      }
    }, []);

  // ── px helpers ────────────────────────────────────────────────────────

  type CellSizeFunction = () => number;
  const getCellSize: CellSizeFunction = (): number => {
    const m: GridDndMetrics = propsRef.current.metrics;
    return m.unitSizeInPx + m.gapInPx;
  };

  type UnitsToPxFunction = (units: number) => number;
  const unitsToPositionPx: UnitsToPxFunction = (units: number): number => {
    return units * getCellSize();
  };
  const unitsToSizePx: UnitsToPxFunction = (units: number): number => {
    const m: GridDndMetrics = propsRef.current.metrics;
    return units * m.unitSizeInPx + (units - 1) * m.gapInPx;
  };

  type RectToPxFunction = (rect: GridRect) => PxRect;
  const rectToPx: RectToPxFunction = (rect: GridRect): PxRect => {
    return {
      x: unitsToPositionPx(rect.left),
      y: unitsToPositionPx(rect.top),
      width: unitsToSizePx(rect.width),
      height: unitsToSizePx(rect.height),
    };
  };

  // ── element styling ───────────────────────────────────────────────────

  type ApplyPxFunction = (element: HTMLElement, px: PxRect) => void;
  const applyPxRect: ApplyPxFunction = (
    element: HTMLElement,
    px: PxRect,
  ): void => {
    element.style.transform = `translate(${px.x}px, ${px.y}px)`;
    element.style.width = `${px.width}px`;
    element.style.height = `${px.height}px`;
  };

  type SettleFunction = (id: string, rect: GridRect) => void;
  const settleElement: SettleFunction = (id: string, rect: GridRect): void => {
    const element: HTMLElement | undefined = elementsRef.current.get(id);
    if (!element) {
      return;
    }
    element.style.transition = GRID_ITEM_TRANSITION;
    element.style.willChange = "";
    applyPxRect(element, rectToPx(rect));
    /*
     * Keep the card elevated while it glides into place; dropping the
     * z-index immediately would paint it underneath the neighbours it is
     * still crossing. Clear only after the settle transition, and only if
     * no new gesture grabbed the same card in the meantime.
     */
    window.setTimeout(() => {
      const settled: HTMLElement | undefined = elementsRef.current.get(id);
      if (settled && sessionRef.current?.id !== id) {
        settled.style.zIndex = "";
      }
    }, 260);
  };

  // ── auto-scroll ───────────────────────────────────────────────────────

  type FindScrollParentFunction = (
    element: HTMLElement | null,
  ) => HTMLElement | null;
  const findScrollParent: FindScrollParentFunction = (
    element: HTMLElement | null,
  ): HTMLElement | null => {
    let current: HTMLElement | null = element?.parentElement || null;
    while (current) {
      const style: CSSStyleDeclaration = window.getComputedStyle(current);
      const overflowY: string = style.overflowY;
      const isScrollable: boolean =
        (overflowY === "auto" || overflowY === "scroll") &&
        current.scrollHeight > current.clientHeight;
      if (isScrollable) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };

  type AutoScrollFunction = (clientY: number) => void;
  const autoScrollIfNearEdge: AutoScrollFunction = (clientY: number): void => {
    const canvas: HTMLElement | null = propsRef.current.canvasRef.current;
    const scrollParent: HTMLElement | null = findScrollParent(canvas);

    let viewportTop: number = 0;
    let viewportBottom: number = window.innerHeight;

    if (scrollParent) {
      const rect: DOMRect = scrollParent.getBoundingClientRect();
      viewportTop = Math.max(rect.top, 0);
      viewportBottom = Math.min(rect.bottom, window.innerHeight);
    }

    let speed: number = 0;

    const distanceFromTop: number = clientY - viewportTop;
    const distanceFromBottom: number = viewportBottom - clientY;

    if (distanceFromTop < AUTO_SCROLL_EDGE_IN_PX) {
      const intensity: number =
        1 - Math.max(distanceFromTop, 0) / AUTO_SCROLL_EDGE_IN_PX;
      speed = -Math.ceil(intensity * AUTO_SCROLL_MAX_SPEED_IN_PX);
    } else if (distanceFromBottom < AUTO_SCROLL_EDGE_IN_PX) {
      const intensity: number =
        1 - Math.max(distanceFromBottom, 0) / AUTO_SCROLL_EDGE_IN_PX;
      speed = Math.ceil(intensity * AUTO_SCROLL_MAX_SPEED_IN_PX);
    }

    if (speed === 0) {
      return;
    }

    if (scrollParent) {
      scrollParent.scrollTop += speed;
    } else {
      window.scrollBy(0, speed);
    }
  };

  // ── candidate computation ─────────────────────────────────────────────

  /**
   * Raw (unsnapped) px rect for the active widget, following the pointer.
   * This is what the element visually tracks; the snapped candidate is
   * derived from it.
   */
  type ComputeRawRectFunction = (session: GestureSession) => PxRect;
  const computeRawRect: ComputeRawRectFunction = (
    session: GestureSession,
  ): PxRect => {
    const canvas: HTMLElement | null = propsRef.current.canvasRef.current;
    const metrics: GridDndMetrics = propsRef.current.metrics;
    const canvasRect: DOMRect | null = canvas
      ? canvas.getBoundingClientRect()
      : null;

    const pointerCanvasX: number = canvasRect
      ? session.latestClientX - canvasRect.left
      : session.latestClientX;
    const pointerCanvasY: number = canvasRect
      ? session.latestClientY - canvasRect.top
      : session.latestClientY;

    const origin: PxRect = rectToPx(session.originRect);
    const boardWidth: number = unitsToSizePx(metrics.columns);

    if (session.mode === "move") {
      const grabOffsetX: number = session.grabFracX * origin.width;
      const grabOffsetY: number = session.grabFracY * origin.height;
      const maxTopUnits: number = Math.max(
        session.maxBottomUnits - session.originRect.height,
        0,
      );
      let x: number = pointerCanvasX - grabOffsetX;
      let y: number = pointerCanvasY - grabOffsetY;
      x = Math.min(Math.max(x, 0), Math.max(boardWidth - origin.width, 0));
      y = Math.min(Math.max(y, 0), unitsToPositionPx(maxTopUnits));
      return { x, y, width: origin.width, height: origin.height };
    }

    // Resize: apply the pointer delta to the grabbed edge(s).
    const dx: number = pointerCanvasX - session.startCanvasX;
    const dy: number = pointerCanvasY - session.startCanvasY;

    const direction: ResizeDirection = session.direction || "se";

    const minWidthPx: number = unitsToSizePx(
      Math.min(session.originRect.minWidth, metrics.columns),
    );
    const minHeightPx: number = unitsToSizePx(session.originRect.minHeight);

    let x: number = origin.x;
    let y: number = origin.y;
    let width: number = origin.width;
    let height: number = origin.height;

    const right: number = origin.x + origin.width;
    const bottom: number = origin.y + origin.height;

    if (direction.includes("e")) {
      width = Math.min(Math.max(origin.width + dx, minWidthPx), boardWidth - x);
    }
    if (direction.includes("s")) {
      const maxHeightPx: number = unitsToSizePx(
        Math.max(
          session.maxBottomUnits - session.originRect.top,
          session.originRect.minHeight,
        ),
      );
      height = Math.min(Math.max(origin.height + dy, minHeightPx), maxHeightPx);
    }
    if (direction.includes("w")) {
      x = Math.min(Math.max(origin.x + dx, 0), right - minWidthPx);
      width = right - x;
    }
    if (direction.includes("n")) {
      y = Math.min(Math.max(origin.y + dy, 0), bottom - minHeightPx);
      height = bottom - y;
    }

    return { x, y, width, height };
  };

  /** Snap a raw px rect onto the grid, clamped into bounds. */
  type SnapFunction = (session: GestureSession, raw: PxRect) => GridRect;
  const snapToGrid: SnapFunction = (
    session: GestureSession,
    raw: PxRect,
  ): GridRect => {
    const metrics: GridDndMetrics = propsRef.current.metrics;
    const cell: number = getCellSize();

    const sizeToUnits: (px: number) => number = (px: number): number => {
      return Math.max(1, Math.round((px + metrics.gapInPx) / cell));
    };

    if (session.mode === "move") {
      const maxTopUnits: number = Math.max(
        session.maxBottomUnits - session.originRect.height,
        0,
      );
      return GridLayoutUtil.clampRect(
        {
          ...session.originRect,
          left: Math.round(raw.x / cell),
          top: Math.min(Math.round(raw.y / cell), maxTopUnits),
        },
        metrics.columns,
      );
    }

    const direction: ResizeDirection = session.direction || "se";

    let left: number = session.originRect.left;
    let top: number = session.originRect.top;
    let width: number = session.originRect.width;
    let height: number = session.originRect.height;

    const rightEdge: number =
      session.originRect.left + session.originRect.width;
    const bottomEdge: number =
      session.originRect.top + session.originRect.height;

    if (direction.includes("e")) {
      width = sizeToUnits(raw.width);
    }
    if (direction.includes("s")) {
      height = sizeToUnits(raw.height);
    }
    if (direction.includes("w")) {
      width = sizeToUnits(raw.width);
      left = rightEdge - width;
    }
    if (direction.includes("n")) {
      height = sizeToUnits(raw.height);
      top = bottomEdge - height;
    }

    return GridLayoutUtil.clampRect(
      { ...session.originRect, left, top, width, height },
      metrics.columns,
    );
  };

  // ── preview recompute (only when the snapped cell changes) ────────────

  type RefreshPreviewFunction = (session: GestureSession) => void;
  const refreshPreview: RefreshPreviewFunction = (
    session: GestureSession,
  ): void => {
    const raw: PxRect = computeRawRect(session);
    const candidate: GridRect = snapToGrid(session, raw);

    if (GridLayoutUtil.areRectsAtSamePlace(candidate, session.candidate)) {
      return;
    }

    session.candidate = candidate;

    let nextRects: Array<GridRect>;

    if (session.mode === "move") {
      nextRects = GridLayoutUtil.moveRect({
        rects: session.originRects,
        id: session.id,
        left: candidate.left,
        top: candidate.top,
        columns: propsRef.current.metrics.columns,
      });
    } else {
      nextRects = GridLayoutUtil.resizeRect({
        rects: session.originRects,
        id: session.id,
        left: candidate.left,
        top: candidate.top,
        width: candidate.width,
        height: candidate.height,
        columns: propsRef.current.metrics.columns,
      });
    }

    setPreview({ rects: nextRects, activeRect: candidate });
  };

  // ── frame loop ────────────────────────────────────────────────────────

  type FrameFunction = () => void;
  const onFrame: FrameFunction = (): void => {
    const session: GestureSession | null = sessionRef.current;
    if (!session) {
      return;
    }

    if (session.started) {
      autoScrollIfNearEdge(session.latestClientY);

      const raw: PxRect = computeRawRect(session);
      const element: HTMLElement | undefined = elementsRef.current.get(
        session.id,
      );
      if (element) {
        applyPxRect(element, raw);
      }

      refreshPreview(session);
    }

    session.rafId = window.requestAnimationFrame(onFrame);
  };

  // ── gesture lifecycle ─────────────────────────────────────────────────

  type ActivateFunction = (session: GestureSession) => void;
  const activateGesture: ActivateFunction = (session: GestureSession): void => {
    session.started = true;

    const element: HTMLElement | undefined = elementsRef.current.get(
      session.id,
    );
    if (element) {
      element.style.transition = "none";
      element.style.willChange = "transform, width, height";
      element.style.zIndex = "60";
    }

    document.body.style.userSelect = "none";
    document.body.style.cursor =
      session.mode === "move"
        ? "grabbing"
        : getResizeCursor(session.direction || "se");

    setGesture({ id: session.id, mode: session.mode, started: true });
    // Show the placeholder at the origin right away.
    setPreview({
      rects: session.originRects,
      activeRect: session.candidate,
    });
  };

  type EndFunction = (commit: boolean) => void;
  const endGesture: EndFunction = (commit: boolean): void => {
    const session: GestureSession | null = sessionRef.current;
    if (!session) {
      return;
    }

    if (session.rafId !== null) {
      window.cancelAnimationFrame(session.rafId);
    }

    if (session.detach) {
      session.detach();
    }

    document.body.style.userSelect = "";
    document.body.style.cursor = "";

    sessionRef.current = null;

    const wasStarted: boolean = session.started;

    if (!wasStarted) {
      // Press-and-release without movement: a click.
      setGesture(null);
      setPreview(null);
      /*
       * Only a press on the widget body counts as a click. A press on a
       * resize handle that never moved must not open the settings modal —
       * otherwise the same press behaves differently depending on whether
       * the pointer jittered a single pixel.
       */
      if (commit && session.mode === "move" && propsRef.current.onItemClick) {
        propsRef.current.onItemClick(session.id);
      }
      return;
    }

    if (commit) {
      const finalRects: Array<GridRect> =
        session.mode === "move"
          ? GridLayoutUtil.moveRect({
              rects: session.originRects,
              id: session.id,
              left: session.candidate.left,
              top: session.candidate.top,
              columns: propsRef.current.metrics.columns,
            })
          : GridLayoutUtil.resizeRect({
              rects: session.originRects,
              id: session.id,
              left: session.candidate.left,
              top: session.candidate.top,
              width: session.candidate.width,
              height: session.candidate.height,
              columns: propsRef.current.metrics.columns,
            });

      const finalRect: GridRect =
        finalRects.find((r: GridRect) => {
          return r.id === session.id;
        }) || session.originRect;

      settleElement(session.id, finalRect);
      setGesture(null);
      setPreview(null);

      if (!GridLayoutUtil.areLayoutsEqual(finalRects, propsRef.current.items)) {
        propsRef.current.onCommit(finalRects);
      }
      return;
    }

    // Cancelled: glide back to where the widget started.
    settleElement(session.id, session.originRect);
    setGesture(null);
    setPreview(null);
  };

  type PointerMoveHandler = (event: PointerEvent) => void;
  const onPointerMove: PointerMoveHandler = (event: PointerEvent): void => {
    const session: GestureSession | null = sessionRef.current;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }

    session.latestClientX = event.clientX;
    session.latestClientY = event.clientY;

    if (!session.started) {
      const distance: number = Math.hypot(
        event.clientX - session.startClientX,
        event.clientY - session.startClientY,
      );
      // Resize gestures are always intentional — no threshold.
      if (session.mode === "resize" || distance >= DRAG_THRESHOLD_IN_PX) {
        activateGesture(session);
      }
    }

    if (session.started) {
      event.preventDefault();
    }
  };

  type PointerUpHandler = (event: PointerEvent) => void;
  const onPointerUp: PointerUpHandler = (event: PointerEvent): void => {
    const session: GestureSession | null = sessionRef.current;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }
    // Take one final reading so fast flicks land where they were released.
    session.latestClientX = event.clientX;
    session.latestClientY = event.clientY;
    if (session.started) {
      const raw: PxRect = computeRawRect(session);
      session.candidate = snapToGrid(session, raw);
    }
    endGesture(true);
  };

  type PointerCancelHandler = (event: PointerEvent) => void;
  const onPointerCancel: PointerCancelHandler = (event: PointerEvent): void => {
    const session: GestureSession | null = sessionRef.current;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }
    endGesture(false);
  };

  type KeyDownHandler = (event: KeyboardEvent) => void;
  const onKeyDown: KeyDownHandler = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && sessionRef.current) {
      event.preventDefault();
      event.stopPropagation();
      endGesture(false);
    }
  };

  type WindowBlurHandler = () => void;
  const onWindowBlur: WindowBlurHandler = (): void => {
    endGesture(false);
  };

  type StartSessionFunction = (
    id: string,
    mode: GridDndMode,
    direction: ResizeDirection | null,
    event: React.PointerEvent,
  ) => void;
  const startSession: StartSessionFunction = (
    id: string,
    mode: GridDndMode,
    direction: ResizeDirection | null,
    event: React.PointerEvent,
  ): void => {
    if (!propsRef.current.isEnabled) {
      return;
    }
    if (sessionRef.current) {
      return;
    }
    // Primary button / primary touch only.
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }

    const items: Array<GridRect> = propsRef.current.items;
    const originRects: Array<GridRect> = GridLayoutUtil.normalize(
      items,
      propsRef.current.metrics.columns,
    );
    const originRect: GridRect | undefined = originRects.find((r: GridRect) => {
      return r.id === id;
    });

    if (!originRect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // jsdom / older browsers: window listeners still cover us.
    }

    const canvas: HTMLElement | null = propsRef.current.canvasRef.current;
    const canvasRect: DOMRect | null = canvas
      ? canvas.getBoundingClientRect()
      : null;

    const startCanvasX: number = canvasRect
      ? event.clientX - canvasRect.left
      : event.clientX;
    const startCanvasY: number = canvasRect
      ? event.clientY - canvasRect.top
      : event.clientY;

    const originPx: PxRect = rectToPx(originRect);

    const session: GestureSession = {
      id,
      mode,
      direction,
      pointerId: event.pointerId,
      originRects,
      originRect,
      startCanvasX,
      startCanvasY,
      startClientX: event.clientX,
      startClientY: event.clientY,
      latestClientX: event.clientX,
      latestClientY: event.clientY,
      grabFracX: Math.min(
        Math.max((startCanvasX - originPx.x) / Math.max(originPx.width, 1), 0),
        1,
      ),
      grabFracY: Math.min(
        Math.max((startCanvasY - originPx.y) / Math.max(originPx.height, 1), 0),
        1,
      ),
      maxBottomUnits:
        GridLayoutUtil.requiredRows(originRects) + AUTO_GROW_SLACK_ROWS,
      started: false,
      candidate: originRect,
      rafId: null,
      detach: null,
    };

    sessionRef.current = session;
    setGesture({ id, mode, started: false });

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onWindowBlur);

    session.detach = (): void => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onWindowBlur);
    };

    session.rafId = window.requestAnimationFrame(onFrame);
  };

  const startMove: (id: string, event: React.PointerEvent) => void =
    useCallback((id: string, event: React.PointerEvent): void => {
      startSession(id, "move", null, event);
    }, []);

  const startResize: (
    id: string,
    direction: ResizeDirection,
    event: React.PointerEvent,
  ) => void = useCallback(
    (id: string, direction: ResizeDirection, event: React.PointerEvent) => {
      startSession(id, "resize", direction, event);
    },
    [],
  );

  /*
   * Keep a live reference to endGesture so unmount/disable cleanup always
   * runs the freshest closure (the session's own detach handles listener
   * identity).
   */
  const endGestureRef: React.MutableRefObject<EndFunction> =
    useRef<EndFunction>(endGesture);
  endGestureRef.current = endGesture;

  // Cancel any in-flight gesture when unmounting or when editing turns off.
  useEffect(() => {
    return () => {
      endGestureRef.current(false);
    };
  }, []);

  useEffect(() => {
    if (!props.isEnabled && sessionRef.current) {
      endGestureRef.current(false);
    }
  }, [props.isEnabled]);

  // ── derived render data ───────────────────────────────────────────────

  const activeId: string | null = gesture?.id || null;
  const isGestureActive: boolean = Boolean(gesture?.started);

  const rects: Array<GridRect> = useMemo(() => {
    if (!preview || !activeId) {
      return props.items;
    }
    /*
     * Neighbours come from the preview; the active widget stays pinned at
     * its origin because its DOM node is being moved imperatively.
     */
    const originRect: GridRect | undefined =
      sessionRef.current?.originRect ||
      props.items.find((r: GridRect) => {
        return r.id === activeId;
      });

    return preview.rects.map((rect: GridRect) => {
      return rect.id === activeId && originRect ? originRect : rect;
    });
  }, [preview, activeId, props.items]);

  const placeholderRect: GridRect | null =
    isGestureActive && preview ? preview.activeRect : null;

  const totalRows: number = useMemo(() => {
    const layoutRows: number = GridLayoutUtil.requiredRows(
      preview ? preview.rects : props.items,
    );
    return layoutRows;
  }, [preview, props.items]);

  return {
    rects,
    placeholderRect,
    totalRows,
    activeId,
    activeMode: gesture?.mode || null,
    isGestureActive,
    registerItemElement,
    startMove,
    startResize,
  };
};

type GetResizeCursorFunction = (direction: ResizeDirection) => string;

export const getResizeCursor: GetResizeCursorFunction = (
  direction: ResizeDirection,
): string => {
  switch (direction) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
      return "nwse-resize";
    default:
      return "default";
  }
};

export default useDashboardGridDnd;
