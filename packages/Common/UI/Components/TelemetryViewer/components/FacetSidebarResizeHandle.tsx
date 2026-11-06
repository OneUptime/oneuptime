import {
  FACET_SIDEBAR_DEFAULT_WIDTH_IN_PX,
  FACET_SIDEBAR_MAX_WIDTH_IN_PX,
  FACET_SIDEBAR_MIN_WIDTH_IN_PX,
  FACET_SIDEBAR_WIDTH_PROPERTY,
  FacetSidebarResizeKeyResult,
  clampFacetSidebarWidth,
  getFacetSidebarFitWidth,
  getFacetSidebarMaxWidth,
  getKeyboardResizedFacetSidebarWidth,
  getPointerResizedFacetSidebarWidth,
} from "../FacetSidebarWidth";
import {
  getFacetNameShortfalls,
  getFacetSidebarDrawnWidth,
  getFacetSidebarRoomWidth,
  isFacetSidebarRightToLeft,
} from "../FacetSidebarMeasure";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The filters sidebar's edge: drag it to make the sidebar wider or
 * narrower (FacetSidebarWidth has the rules). It works the way a table
 * column's edge does (ColumnResizeHandle), so nothing about it is new to
 * learn:
 *
 *   - A pointer - a mouse, a pen, a finger on a tablet - drags it, the
 *     sidebar following the pointer as it moves and the list beside it
 *     taking the rest of the room; the width is kept when the edge is let
 *     go. Escape puts the sidebar back as it was.
 *   - A double-click (or a double tap) fits the sidebar to the names it
 *     lists: as wide as the longest needs to show whole.
 *   - The keyboard reaches it after the sidebar's last filter: the arrow
 *     keys move it the way they point (Shift for bigger steps), Home makes
 *     the sidebar as narrow as it goes, End or Enter fits it, Delete gives
 *     it back its own width. A screen reader hears it as a vertical
 *     separator, "Resize the filters", with the sidebar's width.
 *
 * It stands in the gap between the sidebar and the list, as the next item
 * of their row (FacetSidebarPanel draws it after the sidebar): from 4px
 * inside the sidebar's edge, where a pointer aimed at the edge lands, to
 * the list's. Below md the sidebar stacks above the list at full width and
 * there is nothing to size: the edge is not drawn there.
 */

export const FACET_SIDEBAR_RESIZE_NAME: string =
  translationKey("Resize the filters");

// The hint under the pointer: the very words of a table column's edge.
export const FACET_SIDEBAR_RESIZE_HINT: string = translationKey(
  "Drag to resize. Double-click to fit.",
);

// The width a screen reader hears, in the words of a table column's edge.
export const FACET_SIDEBAR_RESIZE_WIDTH_TEMPLATE: PluralTemplate = {
  one: "{{count}} pixel wide",
  other: "{{count}} pixels wide",
};

export const FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID: string =
  "facet-sidebar-resize-handle";

/*
 * The edge's hit area: 16px wide, from 4px inside the sidebar's end over
 * the 12px gap (gap-3) to the list, by its margins, so the list stays where
 * it always was (-ml-4 w-4 -mr-3 adds nothing to the row). Its margins are
 * the reading direction's start and end (TailwindReadingDirection), so on a
 * right-to-left page it reaches into the sidebar from the left. None below
 * md (max-md:hidden md:block - never a bare hidden, which a foreign
 * stylesheet's .hidden would pin).
 */
export const FACET_SIDEBAR_RESIZE_HANDLE_CLASS_NAME: string =
  "group/edge relative -ml-4 -mr-3 w-4 flex-none cursor-col-resize touch-none select-none self-stretch focus:outline-none max-md:hidden md:block";

/*
 * Its line: unseen until the edge is pointed at, has the keyboard's focus
 * or is dragged, then the product's indigo, 2px, down the middle of the gap
 * (9px in from the start of the hit area: 5px from the sidebar's edge).
 */
export const FACET_SIDEBAR_RESIZE_LINE_CLASS_NAME: string = [
  "pointer-events-none absolute inset-y-0 left-[9px] w-0.5 rounded-full bg-indigo-500 opacity-0 transition-opacity duration-150",
  "group-hover/edge:opacity-100 group-focus-visible/edge:opacity-100 group-data-[resizing=true]/edge:opacity-100",
].join(" ");

/*
 * Two presses on the edge this close in time and place, without a drag
 * between them, are a double-click: the same for a mouse, a pen and a
 * finger, which a browser's own dblclick is not.
 */
export const FACET_SIDEBAR_DOUBLE_PRESS_MS: number = 500;
const DOUBLE_PRESS_DISTANCE_IN_PX: number = 8;

// How far a press may move before it is a drag rather than a click.
const DRAG_THRESHOLD_IN_PX: number = 2;

/*
 * Its handlers read the props of the latest render when they run
 * (propsRef), not those of the render that bound them: a drag outlives
 * renders. The rule cannot see a prop read through a ref.
 */
/* eslint-disable react/no-unused-prop-types */
export interface ComponentProps {
  // The sidebar the edge sizes.
  panelRef: React.RefObject<HTMLElement>;
  // The sidebar's id: the separator controls it.
  panelId?: string | undefined;
  // The width a person gave the sidebar, or null: its own 14rem.
  width: number | null;
  // A width to keep, or null: the sidebar back at its own width.
  onWidthChange: (width: number | null) => void;
  dataTestId?: string | undefined;
}
/* eslint-enable react/no-unused-prop-types */

interface SavedWidth {
  value: string;
  priority: string;
}

interface PointerDrag {
  pointerId: number;
  panel: HTMLElement;
  // The width the sidebar's own style wrote, given back if the drag is let go.
  saved: SavedWidth;
  startX: number;
  startWidth: number;
  width: number;
  maxWidth: number;
  isRightToLeft: boolean;
  isMoved: boolean;
  pendingX: number | null;
  frame: number | null;
}

interface LastPress {
  at: number;
  x: number;
}

const requestFrame: (callback: () => void) => number = (
  callback: () => void,
): number => {
  if (typeof window !== "undefined" && window.requestAnimationFrame) {
    return window.requestAnimationFrame(callback);
  }

  return setTimeout(callback, 16) as unknown as number;
};

const cancelFrame: (frame: number) => void = (frame: number): void => {
  if (typeof window !== "undefined" && window.cancelAnimationFrame) {
    window.cancelAnimationFrame(frame);
    return;
  }

  clearTimeout(frame);
};

const readSavedWidth: (panel: HTMLElement) => SavedWidth = (
  panel: HTMLElement,
): SavedWidth => {
  return {
    value: panel.style.getPropertyValue(FACET_SIDEBAR_WIDTH_PROPERTY),
    priority: panel.style.getPropertyPriority(FACET_SIDEBAR_WIDTH_PROPERTY),
  };
};

const restoreSavedWidth: (panel: HTMLElement, saved: SavedWidth) => void = (
  panel: HTMLElement,
  saved: SavedWidth,
): void => {
  if (saved.value) {
    panel.style.setProperty(
      FACET_SIDEBAR_WIDTH_PROPERTY,
      saved.value,
      saved.priority,
    );
    return;
  }

  panel.style.removeProperty(FACET_SIDEBAR_WIDTH_PROPERTY);
};

// The width a sidebar is drawn at, while it is dragged: written on it.
const drawWidth: (panel: HTMLElement, width: number) => void = (
  panel: HTMLElement,
  width: number,
): void => {
  panel.style.setProperty(FACET_SIDEBAR_WIDTH_PROPERTY, `${width}px`);
};

const FacetSidebarResizeHandle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const dragRef: React.MutableRefObject<PointerDrag | null> =
    useRef<PointerDrag | null>(null);
  const lastPressRef: React.MutableRefObject<LastPress | null> =
    useRef<LastPress | null>(null);
  const propsRef: React.MutableRefObject<ComponentProps> =
    useRef<ComponentProps>(props);
  propsRef.current = props;

  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [valueNow, setValueNow] = useState<number>(
    props.width ?? FACET_SIDEBAR_DEFAULT_WIDTH_IN_PX,
  );
  const [valueMax, setValueMax] = useState<number>(
    FACET_SIDEBAR_MAX_WIDTH_IN_PX,
  );

  /*
   * A width kept elsewhere (another tab, another explorer on the page) is
   * the one heard; the sidebar's drawn width, capped by its room, is read
   * when the edge takes the focus.
   */
  useEffect(() => {
    if (dragRef.current) {
      return;
    }

    setValueNow(props.width ?? FACET_SIDEBAR_DEFAULT_WIDTH_IN_PX);
  }, [props.width]);

  // A sidebar that goes away mid-drag leaves no frame waiting.
  useEffect(() => {
    return () => {
      const drag: PointerDrag | null = dragRef.current;

      if (drag && drag.frame !== null) {
        cancelFrame(drag.frame);
      }

      dragRef.current = null;
    };
  }, []);

  // The most the sidebar may be drawn in the room it has now.
  const readMaxWidth: (panel: HTMLElement) => number = (
    panel: HTMLElement,
  ): number => {
    const maxWidth: number = getFacetSidebarMaxWidth(
      getFacetSidebarRoomWidth(panel),
    );

    setValueMax(maxWidth);

    return maxWidth;
  };

  /*
   * The width the sidebar is drawn at now: as measured, else (a page not
   * laid out) the width kept, else its own.
   */
  const readDrawnWidth: (panel: HTMLElement, maxWidth: number) => number = (
    panel: HTMLElement,
    maxWidth: number,
  ): number => {
    const drawn: number = getFacetSidebarDrawnWidth(panel);

    return clampFacetSidebarWidth(
      drawn > 0
        ? drawn
        : (propsRef.current.width ?? FACET_SIDEBAR_DEFAULT_WIDTH_IN_PX),
      maxWidth,
    );
  };

  const keepWidth: (width: number | null) => void = (
    width: number | null,
  ): void => {
    propsRef.current.onWidthChange(width);
  };

  // As wide as the names the sidebar lists need: a double-click, End, Enter.
  const readFitWidth: (panel: HTMLElement, maxWidth: number) => number | null = (
    panel: HTMLElement,
    maxWidth: number,
  ): number | null => {
    return getFacetSidebarFitWidth({
      width: readDrawnWidth(panel, maxWidth),
      nameShortfalls: getFacetNameShortfalls(panel),
      maxWidth: maxWidth,
    });
  };

  const fitToNames: (panel: HTMLElement) => void = (
    panel: HTMLElement,
  ): void => {
    const maxWidth: number = readMaxWidth(panel);
    const fitWidth: number | null = readFitWidth(panel, maxWidth);

    if (fitWidth === null) {
      return;
    }

    setValueNow(fitWidth);
    keepWidth(fitWidth);
  };

  // ---- A pointer --------------------------------------------------------

  const applyPendingMove: (drag: PointerDrag) => void = (
    drag: PointerDrag,
  ): void => {
    if (drag.pendingX === null) {
      return;
    }

    const width: number = getPointerResizedFacetSidebarWidth({
      startWidth: drag.startWidth,
      startX: drag.startX,
      x: drag.pendingX,
      isRightToLeft: drag.isRightToLeft,
      maxWidth: drag.maxWidth,
    });

    drag.pendingX = null;

    if (width === drag.width) {
      return;
    }

    drag.width = width;
    drawWidth(drag.panel, width);
    setValueNow(width);
  };

  const endPointerDrag: (data: {
    isKept: boolean;
    element: HTMLElement | null;
  }) => void = (data: {
    isKept: boolean;
    element: HTMLElement | null;
  }): void => {
    const drag: PointerDrag | null = dragRef.current;

    if (!drag) {
      return;
    }

    if (drag.frame !== null) {
      cancelFrame(drag.frame);
      drag.frame = null;
    }

    if (data.isKept && drag.isMoved) {
      // Where the pointer let go, even between two frames.
      applyPendingMove(drag);
    }

    dragRef.current = null;
    setIsResizing(false);

    try {
      data.element?.releasePointerCapture?.(drag.pointerId);
    } catch {
      // The pointer is already let go.
    }

    if (data.isKept && drag.isMoved) {
      keepWidth(drag.width);
      return;
    }

    restoreSavedWidth(drag.panel, drag.saved);
    setValueNow(Math.round(drag.startWidth));
  };

  const onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    // The main button only: a right click opens the browser's menu as ever.
    if (event.button !== 0 || dragRef.current) {
      return;
    }

    const panel: HTMLElement | null = propsRef.current.panelRef.current;

    if (!panel) {
      return;
    }

    // No text selected in the list or the sidebar as the pointer moves.
    event.preventDefault();
    event.stopPropagation();

    const handle: HTMLDivElement = event.currentTarget;

    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer that cannot be held still drags while it is over the edge.
    }

    const maxWidth: number = readMaxWidth(panel);
    const startWidth: number = readDrawnWidth(panel, maxWidth);

    dragRef.current = {
      pointerId: event.pointerId,
      panel: panel,
      saved: readSavedWidth(panel),
      startX: event.clientX,
      startWidth: startWidth,
      width: startWidth,
      maxWidth: maxWidth,
      isRightToLeft: isFacetSidebarRightToLeft(panel),
      isMoved: false,
      pendingX: null,
      frame: null,
    };

    setValueNow(startWidth);
    setIsResizing(true);
  };

  const onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag: PointerDrag | null = dragRef.current;

    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    event.preventDefault();

    if (
      !drag.isMoved &&
      Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD_IN_PX
    ) {
      return;
    }

    drag.isMoved = true;
    drag.pendingX = event.clientX;

    // One width a frame, however fast the pointer moves.
    if (drag.frame === null) {
      let hasRun: boolean = false;
      const frame: number = requestFrame(() => {
        hasRun = true;
        drag.frame = null;
        applyPendingMove(drag);
      });

      // A frame already run (a scheduler that runs at once) is not waited on.
      if (!hasRun) {
        drag.frame = frame;
      }
    }
  };

  const onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag: PointerDrag | null = dragRef.current;

    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const isMoved: boolean = drag.isMoved;
    const panel: HTMLElement = drag.panel;

    endPointerDrag({ isKept: true, element: event.currentTarget });

    if (isMoved) {
      lastPressRef.current = null;
      return;
    }

    // A press without a drag: the second one close behind fits the names.
    const now: number = Date.now();
    const last: LastPress | null = lastPressRef.current;

    if (
      last &&
      now - last.at <= FACET_SIDEBAR_DOUBLE_PRESS_MS &&
      Math.abs(event.clientX - last.x) <= DOUBLE_PRESS_DISTANCE_IN_PX
    ) {
      lastPressRef.current = null;
      fitToNames(panel);
      return;
    }

    lastPressRef.current = { at: now, x: event.clientX };
  };

  const onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag: PointerDrag | null = dragRef.current;

    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    endPointerDrag({ isKept: false, element: event.currentTarget });
  };

  // ---- The keyboard -----------------------------------------------------

  const onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key === "Escape" && dragRef.current) {
      event.preventDefault();
      event.stopPropagation();
      endPointerDrag({ isKept: false, element: event.currentTarget });
      return;
    }

    if (dragRef.current || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const panel: HTMLElement | null = propsRef.current.panelRef.current;

    if (!panel) {
      return;
    }

    const maxWidth: number = readMaxWidth(panel);
    const width: number = readDrawnWidth(panel, maxWidth);
    // The names are read only for the keys that fit them.
    const isFitKey: boolean = event.key === "End" || event.key === "Enter";

    const result: FacetSidebarResizeKeyResult =
      getKeyboardResizedFacetSidebarWidth({
        key: event.key,
        shiftKey: event.shiftKey,
        width: width,
        fitWidth: isFitKey ? readFitWidth(panel, maxWidth) : null,
        maxWidth: maxWidth,
        isRightToLeft: isFacetSidebarRightToLeft(panel),
      });

    if (!result) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (result.kind === "default") {
      setValueNow(
        clampFacetSidebarWidth(FACET_SIDEBAR_DEFAULT_WIDTH_IN_PX, maxWidth),
      );

      if (propsRef.current.width !== null) {
        keepWidth(null);
      }
      return;
    }

    setValueNow(result.width);

    // A key that changes nothing (an arrow at the end, End with no names) keeps nothing.
    if (result.width !== Math.round(width)) {
      keepWidth(result.width);
    }
  };

  const onFocus: () => void = (): void => {
    const panel: HTMLElement | null = propsRef.current.panelRef.current;

    if (!panel || dragRef.current) {
      return;
    }

    setValueNow(Math.round(readDrawnWidth(panel, readMaxWidth(panel))));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={translator.translateText(FACET_SIDEBAR_RESIZE_NAME)}
      aria-controls={props.panelId}
      aria-valuenow={valueNow}
      aria-valuemin={FACET_SIDEBAR_MIN_WIDTH_IN_PX}
      aria-valuemax={valueMax}
      aria-valuetext={translator.translatePlural(
        FACET_SIDEBAR_RESIZE_WIDTH_TEMPLATE,
        valueNow,
      )}
      tabIndex={0}
      title={translator.translateText(FACET_SIDEBAR_RESIZE_HINT)}
      className={FACET_SIDEBAR_RESIZE_HANDLE_CLASS_NAME}
      data-resizing={isResizing ? "true" : undefined}
      data-testid={props.dataTestId || FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={(event: React.PointerEvent<HTMLDivElement>) => {
        // The browser took the pointer back mid-drag: keep what was dragged.
        if (dragRef.current && event.pointerId === dragRef.current.pointerId) {
          endPointerDrag({ isKept: true, element: null });
        }
      }}
      onClick={(event: React.MouseEvent<HTMLDivElement>) => {
        // A press on the edge is nothing else's click.
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      <span aria-hidden="true" className={FACET_SIDEBAR_RESIZE_LINE_CLASS_NAME} />
    </div>
  );
};

export default FacetSidebarResizeHandle;
