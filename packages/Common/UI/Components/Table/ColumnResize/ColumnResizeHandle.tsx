import {
  COLUMN_MAX_WIDTH_IN_PX,
  COLUMN_MIN_WIDTH_IN_PX,
  ColumnResizeKeyResult,
  ColumnWidthKind,
  clampColumnWidth,
  getColumnFitWidth,
  getColumnWidthFloor,
  getKeyboardResizedWidth,
  getPointerResizedWidth,
} from "./ColumnWidths";
import {
  COLUMN_RESIZE_HANDLE_ATTRIBUTE,
  ColumnMeasurement,
  SavedHeaderCellWidth,
  getColumnEdgeLineInset,
  measureTableColumn,
  readHeaderCellWidth,
  restoreHeaderCellWidth,
  writeHeaderCellWidth,
} from "./ColumnWidthMeasure";
import {
  COLUMN_RESIZE_ACTIVE_LINE_CLASS_NAME,
  COLUMN_RESIZE_EDGE_INSET_PROPERTY,
  COLUMN_RESIZE_GUIDE_CLASS_NAME,
  COLUMN_RESIZE_GUIDE_TEST_ID,
  COLUMN_RESIZE_HANDLE_CLASS_NAME,
  COLUMN_RESIZE_HANDLE_TEST_ID,
  COLUMN_RESIZE_LINE_CLASS_NAME,
} from "./ColumnResizeLayout";
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
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/*
 * The edge at the end of a column's header cell: drag it to make the
 * column wider or narrower (ColumnWidths has the rules).
 *
 *   - A pointer - a mouse, a pen, a finger on a tablet - drags it, the
 *     column following the pointer as it moves: one header cell is given
 *     its width each frame, whatever the rows hold, and the width is kept
 *     when the edge is let go. Escape puts the column back as it was.
 *   - A double-click (or a double tap) fits the column to its header and
 *     its widest value.
 *   - The keyboard reaches it after its column's name: the arrow keys move
 *     it the way they point (Shift for bigger steps), Home makes the column
 *     as narrow as it goes, End or Enter fits it, Delete gives it back to
 *     the table. A screen reader hears it as a vertical separator named
 *     after its column, with its width.
 *
 * It finds its header cell, its table and the page's reading direction on
 * the page when it is used, so a table drawn by hand needs nothing more
 * than this inside each header cell it lets a person size (and the cell
 * relative, so the edge sits on it).
 */

export const COLUMN_RESIZE_NAME_TEMPLATE: string = translationKey(
  "Resize the {{column}} column",
);

export const COLUMN_RESIZE_HINT: string = translationKey(
  "Drag to resize. Double-click to fit.",
);

export const COLUMN_RESIZE_WIDTH_TEMPLATE: PluralTemplate = {
  one: "{{count}} pixel wide",
  other: "{{count}} pixels wide",
};

/*
 * Two presses on the edge this close in time and place, without a drag
 * between them, are a double-click: the same for a mouse, a pen and a
 * finger, which a browser's own dblclick is not.
 */
export const COLUMN_RESIZE_DOUBLE_PRESS_MS: number = 500;
const DOUBLE_PRESS_DISTANCE_IN_PX: number = 8;

// How far a press may move before it is a drag rather than a click.
const DRAG_THRESHOLD_IN_PX: number = 2;

/*
 * A table that takes longer than this to draw a new width - a list of
 * hundreds of rows, a slow machine - twice running, is not drawn again
 * until the edge is let go: only the edge's line follows the pointer, down
 * the rows, and the column takes the width it shows when it is let go. A
 * column dragged at a few frames a second is no column dragged at all.
 */
export const COLUMN_RESIZE_SLOW_FRAME_MS: number = 50;
const SLOW_FRAMES_BEFORE_GUIDE_ONLY: number = 2;

/*
 * A table of more rows than this is never drawn again mid-drag: its edge's
 * line follows the pointer from the start, rather than after two frames a
 * person would see stall.
 */
export const COLUMN_RESIZE_GUIDE_ONLY_ROWS: number = 150;

// How many rows the table under a header cell draws.
const getTableRowCount: (headerCell: HTMLTableCellElement) => number = (
  headerCell: HTMLTableCellElement,
): number => {
  const table: HTMLTableElement | null = headerCell.closest("table");

  if (!table) {
    return 0;
  }

  return Array.from(table.tBodies).reduce(
    (count: number, body: HTMLTableSectionElement): number => {
      return count + body.rows.length;
    },
    0,
  );
};

/*
 * Its handlers read the props of the latest render when they run
 * (propsRef), not those of the render that bound them: a drag outlives
 * renders. The rule cannot see a prop read through a ref.
 */
/* eslint-disable react/no-unused-prop-types */
export interface ComponentProps {
  columnId: string;
  // The column's name as its header says it: the edge is named after it.
  columnTitle: string;
  kind: ColumnWidthKind;
  // The width a person gave the column, if they did.
  width?: number | undefined;
  // A width to keep, or null: the column back at the table's own width.
  onWidthChange: (columnId: string, width: number | null) => void;
  /*
   * The column is being sized: the table holds back what it does to its
   * columns (useTableScrollState) until it ends, and lets the column's
   * values use whatever width it is given.
   */
  onResizeStart?:
    | ((
        columnId: string,
        headerCell: HTMLTableCellElement,
        kind: ColumnWidthKind,
      ) => void)
    | undefined;
  // Each width while the edge moves, before the width is kept.
  onResizeMove?: ((columnId: string, width: number) => void) | undefined;
  onResizeEnd?: ((columnId: string) => void) | undefined;
  dataTestId?: string | undefined;
}
/* eslint-enable react/no-unused-prop-types */

// The least a column may be and what fits it, read off the page.
interface ColumnSizes {
  floor: number;
  fitWidth: number;
}

interface PointerDrag {
  pointerId: number;
  headerCell: HTMLTableCellElement;
  saved: SavedHeaderCellWidth;
  startX: number;
  startWidth: number;
  width: number;
  floor: number;
  isRightToLeft: boolean;
  isMoved: boolean;
  // The table was told (onResizeStart): only once the edge really moves.
  isStarted: boolean;
  pendingX: number | null;
  frame: number | null;
  // The width last drawn on the table.
  drawnWidth: number;
  // How many frames running the table took too long to draw.
  slowFrames: number;
  // Only the edge's line follows the pointer (COLUMN_RESIZE_SLOW_FRAME_MS).
  isGuideOnly: boolean;
}

interface KeyboardSizing {
  headerCell: HTMLTableCellElement;
  saved: SavedHeaderCellWidth;
  width: number;
  isChanged: boolean;
}

interface LastPress {
  at: number;
  x: number;
}

const isRightToLeftCell: (cell: Element) => boolean = (
  cell: Element,
): boolean => {
  if (typeof window === "undefined" || !window.getComputedStyle) {
    return false;
  }

  return window.getComputedStyle(cell).direction === "rtl";
};

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

/*
 * How far down the rows the guide runs: from under the header to the
 * table's last row, or the bottom of the window, whichever comes first.
 */
const getGuideHeight: (headerCell: HTMLTableCellElement) => number = (
  headerCell: HTMLTableCellElement,
): number => {
  const table: HTMLTableElement | null = headerCell.closest("table");

  if (!table) {
    return 0;
  }

  const cellBottom: number = headerCell.getBoundingClientRect().bottom;
  const tableBottom: number = table.getBoundingClientRect().bottom;
  const windowBottom: number =
    typeof window !== "undefined" && window.innerHeight
      ? window.innerHeight
      : tableBottom;

  return Math.max(0, Math.min(tableBottom, windowBottom) - cellBottom);
};

const getHeaderCell: (element: Element) => HTMLTableCellElement | null = (
  element: Element,
): HTMLTableCellElement | null => {
  return element.closest("th, td") as HTMLTableCellElement | null;
};

const ColumnResizeHandle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const handleRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const dragRef: React.MutableRefObject<PointerDrag | null> =
    useRef<PointerDrag | null>(null);
  const keyboardRef: React.MutableRefObject<KeyboardSizing | null> =
    useRef<KeyboardSizing | null>(null);
  // The column's floor and fit, read once while its edge has the focus.
  const sizesRef: React.MutableRefObject<ColumnSizes | null> =
    useRef<ColumnSizes | null>(null);
  const lastPressRef: React.MutableRefObject<LastPress | null> =
    useRef<LastPress | null>(null);
  const propsRef: React.MutableRefObject<ComponentProps> =
    useRef<ComponentProps>(props);
  propsRef.current = props;

  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [guideHeight, setGuideHeight] = useState<number>(0);
  const [valueNow, setValueNow] = useState<number | undefined>(
    props.width !== undefined ? Math.round(props.width) : undefined,
  );
  const [valueMin, setValueMin] = useState<number>(COLUMN_MIN_WIDTH_IN_PX);

  /*
   * A width kept elsewhere (another tab, Reset column widths) is the one
   * heard - and a column given back to the table, its width as drawn now,
   * while its edge has the focus.
   */
  useEffect(() => {
    if (dragRef.current || keyboardRef.current) {
      return;
    }

    if (props.width !== undefined) {
      setValueNow(Math.round(props.width));
      return;
    }

    const handle: HTMLDivElement | null = handleRef.current;
    const headerCell: HTMLTableCellElement | null = handle
      ? getHeaderCell(handle)
      : null;

    setValueNow(
      headerCell && document.activeElement === handle
        ? Math.round(headerCell.getBoundingClientRect().width)
        : undefined,
    );
  }, [props.width]);

  /*
   * The edge's lines in the middle of the room between this column's words
   * and the next column's (ColumnWidthMeasure's getColumnEdgeLineInset),
   * written on the edge - a style its own classes read, so nothing is drawn
   * again for it. Read whenever the edge is drawn, as the column after it
   * can change (a logs list's columns), off the cells' classes: no style is
   * read, so drawing a table never has the browser work out the page's
   * rules early, and no timer is armed (a table at rest arms none:
   * StateTimelineColumns counts them).
   */
  const writeEdgeLineInset: () => void = (): void => {
    const handle: HTMLDivElement | null = handleRef.current;
    const headerCell: HTMLTableCellElement | null = handle
      ? getHeaderCell(handle)
      : null;

    if (!handle || !headerCell) {
      return;
    }

    const inset: string = `${getColumnEdgeLineInset(headerCell)}px`;

    if (
      handle.style.getPropertyValue(COLUMN_RESIZE_EDGE_INSET_PROPERTY) !== inset
    ) {
      handle.style.setProperty(COLUMN_RESIZE_EDGE_INSET_PROPERTY, inset);
    }
  };

  useLayoutEffect(() => {
    writeEdgeLineInset();
  });

  // A table that goes away mid-drag leaves no frame waiting.
  useEffect(() => {
    return () => {
      const drag: PointerDrag | null = dragRef.current;

      if (drag && drag.frame !== null) {
        cancelFrame(drag.frame);
      }

      dragRef.current = null;
    };
  }, []);

  const measure: (headerCell: HTMLTableCellElement) => ColumnSizes = (
    headerCell: HTMLTableCellElement,
  ): ColumnSizes => {
    const measured: ColumnMeasurement = measureTableColumn({
      headerCell: headerCell,
      kind: propsRef.current.kind,
    });
    const floor: number = getColumnWidthFloor({
      measured: measured,
      kind: propsRef.current.kind,
    });
    const sizes: ColumnSizes = {
      floor: floor,
      fitWidth: getColumnFitWidth({ measured: measured, floor: floor }),
    };

    sizesRef.current = sizes;
    setValueMin(floor);

    return sizes;
  };

  // The width the column is drawn at now: the kept one, else as drawn.
  const getCurrentWidth: (headerCell: HTMLTableCellElement) => number = (
    headerCell: HTMLTableCellElement,
  ): number => {
    if (propsRef.current.width !== undefined) {
      return propsRef.current.width;
    }

    return headerCell.getBoundingClientRect().width;
  };

  const keepWidth: (width: number | null) => void = (
    width: number | null,
  ): void => {
    propsRef.current.onWidthChange(propsRef.current.columnId, width);
  };

  const fitToContent: (headerCell: HTMLTableCellElement) => void = (
    headerCell: HTMLTableCellElement,
  ): void => {
    const sizes: ColumnSizes = measure(headerCell);
    const width: number = clampColumnWidth(sizes.fitWidth, sizes.floor);

    setValueNow(width);
    keepWidth(width);
  };

  // ---- A pointer --------------------------------------------------------

  const applyPendingMove: (drag: PointerDrag) => void = (
    drag: PointerDrag,
  ): void => {
    if (drag.pendingX === null) {
      return;
    }

    const width: number = getPointerResizedWidth({
      startWidth: drag.startWidth,
      startX: drag.startX,
      x: drag.pendingX,
      isRightToLeft: drag.isRightToLeft,
      floor: drag.floor,
    });

    drag.pendingX = null;

    if (width === drag.width) {
      return;
    }

    drag.width = width;
    setValueNow(width);

    // A long table is left as it is drawn: only the edge's line moves.
    if (drag.isGuideOnly) {
      moveEdgeBy(drag, width - drag.drawnWidth);
      return;
    }

    if (!drag.isStarted) {
      /*
       * The column holds the width it had before anything else is let go -
       * its values' cap among them (onResizeStart) - so nothing jumps as it
       * starts to move.
       */
      drag.isStarted = true;
      writeHeaderCellWidth(
        drag.headerCell,
        drag.startWidth,
        propsRef.current.kind,
      );
      propsRef.current.onResizeStart?.(
        propsRef.current.columnId,
        drag.headerCell,
        propsRef.current.kind,
      );
    }

    // How long the table takes to draw it: the next frame says.
    const writtenAt: number = Date.now();

    drag.drawnWidth = width;
    writeHeaderCellWidth(drag.headerCell, width, propsRef.current.kind);
    propsRef.current.onResizeMove?.(propsRef.current.columnId, width);

    requestFrame(() => {
      if (dragRef.current !== drag || drag.isGuideOnly) {
        return;
      }

      drag.slowFrames =
        Date.now() - writtenAt > COLUMN_RESIZE_SLOW_FRAME_MS
          ? drag.slowFrames + 1
          : 0;

      if (drag.slowFrames >= SLOW_FRAMES_BEFORE_GUIDE_ONLY) {
        drag.isGuideOnly = true;
      }
    });
  };

  /*
   * The edge's line (and its guide down the rows) moved where the column
   * will end, the table left as it is drawn: towards the column's end, the
   * left on a right-to-left page.
   */
  const moveEdgeBy: (drag: PointerDrag, shift: number) => void = (
    drag: PointerDrag,
    shift: number,
  ): void => {
    const handle: HTMLDivElement | null = handleRef.current;

    if (!handle) {
      return;
    }

    const x: number = Math.round(drag.isRightToLeft ? -shift : shift);

    if (x === 0) {
      handle.style.removeProperty("transform");
      return;
    }

    handle.style.setProperty("transform", `translateX(${x}px)`);
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
    // What the column holds may change with its width: read it again next time.
    sizesRef.current = null;
    setIsResizing(false);
    handleRef.current?.style.removeProperty("transform");

    try {
      data.element?.releasePointerCapture?.(drag.pointerId);
    } catch {
      // The pointer is already let go.
    }

    if (data.isKept && drag.isMoved) {
      keepWidth(drag.width);
    } else {
      restoreHeaderCellWidth(drag.headerCell, drag.saved);
      setValueNow(
        propsRef.current.width !== undefined
          ? Math.round(propsRef.current.width)
          : Math.round(drag.startWidth),
      );
    }

    // A press that never moved the edge never told the table it started.
    if (drag.isStarted) {
      propsRef.current.onResizeEnd?.(propsRef.current.columnId);
    }
  };

  const onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    // The main button only: a right click opens the browser's menu as ever.
    if (event.button !== 0 || dragRef.current) {
      return;
    }

    const handle: HTMLDivElement = event.currentTarget;
    const headerCell: HTMLTableCellElement | null = getHeaderCell(handle);

    if (!headerCell) {
      return;
    }

    // No text selected, no sort, and no card or widget picked up under it.
    event.preventDefault();
    event.stopPropagation();

    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer that cannot be held still drags while it is over the edge.
    }

    // Read as the page is, before the column's values are read.
    const startWidth: number = getCurrentWidth(headerCell);
    const height: number = getGuideHeight(headerCell);
    const isRightToLeft: boolean = isRightToLeftCell(headerCell);
    const sizes: ColumnSizes = measure(headerCell);

    dragRef.current = {
      pointerId: event.pointerId,
      headerCell: headerCell,
      saved: readHeaderCellWidth(headerCell),
      startX: event.clientX,
      startWidth: startWidth,
      width: startWidth,
      floor: sizes.floor,
      isRightToLeft: isRightToLeft,
      isMoved: false,
      isStarted: false,
      pendingX: null,
      frame: null,
      drawnWidth: startWidth,
      slowFrames: 0,
      isGuideOnly: getTableRowCount(headerCell) > COLUMN_RESIZE_GUIDE_ONLY_ROWS,
    };

    setGuideHeight(height);
    setValueNow(Math.round(startWidth));
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
    const headerCell: HTMLTableCellElement = drag.headerCell;

    endPointerDrag({ isKept: true, element: event.currentTarget });

    if (isMoved) {
      lastPressRef.current = null;
      return;
    }

    // A press without a drag: the second one close behind fits the column.
    const now: number = Date.now();
    const last: LastPress | null = lastPressRef.current;

    if (
      last &&
      now - last.at <= COLUMN_RESIZE_DOUBLE_PRESS_MS &&
      Math.abs(event.clientX - last.x) <= DOUBLE_PRESS_DISTANCE_IN_PX
    ) {
      lastPressRef.current = null;
      fitToContent(headerCell);
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

  const endKeyboardSizing: () => void = (): void => {
    const sizing: KeyboardSizing | null = keyboardRef.current;

    if (!sizing) {
      return;
    }

    keyboardRef.current = null;

    if (sizing.isChanged) {
      keepWidth(sizing.width);
    } else {
      restoreHeaderCellWidth(sizing.headerCell, sizing.saved);
    }

    propsRef.current.onResizeEnd?.(propsRef.current.columnId);
  };

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

    const headerCell: HTMLTableCellElement | null = getHeaderCell(
      event.currentTarget,
    );

    if (!headerCell) {
      return;
    }

    const sizing: KeyboardSizing | null = keyboardRef.current;
    // Read once while the edge has the focus: a key held down repeats.
    const sizes: ColumnSizes = sizesRef.current || measure(headerCell);
    const width: number = sizing ? sizing.width : getCurrentWidth(headerCell);

    const result: ColumnResizeKeyResult = getKeyboardResizedWidth({
      key: event.key,
      shiftKey: event.shiftKey,
      width: width,
      floor: sizes.floor,
      fitWidth: sizes.fitWidth,
      isRightToLeft: isRightToLeftCell(headerCell),
    });

    if (!result) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (result.kind === "automatic") {
      if (sizing) {
        sizing.isChanged = false;
        endKeyboardSizing();
      }

      sizesRef.current = null;
      keepWidth(null);
      return;
    }

    if (!sizing) {
      keyboardRef.current = {
        headerCell: headerCell,
        saved: readHeaderCellWidth(headerCell),
        width: width,
        isChanged: false,
      };
      propsRef.current.onResizeStart?.(
        propsRef.current.columnId,
        headerCell,
        propsRef.current.kind,
      );
    }

    const current: KeyboardSizing = keyboardRef.current as KeyboardSizing;

    current.width = result.width;
    current.isChanged = true;
    writeHeaderCellWidth(headerCell, result.width, propsRef.current.kind);
    setValueNow(result.width);
    propsRef.current.onResizeMove?.(propsRef.current.columnId, result.width);

    // A jump - Home, End, Enter - is kept at once; an arrow when it is let go.
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      endKeyboardSizing();
    }
  };

  const onKeyUp: (event: React.KeyboardEvent<HTMLDivElement>) => void = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      endKeyboardSizing();
    }
  };

  const onFocus: (event: React.FocusEvent<HTMLDivElement>) => void = (
    event: React.FocusEvent<HTMLDivElement>,
  ): void => {
    const headerCell: HTMLTableCellElement | null = getHeaderCell(
      event.currentTarget,
    );

    if (headerCell && valueNow === undefined) {
      setValueNow(Math.round(getCurrentWidth(headerCell)));
    }
  };

  const onBlur: () => void = (): void => {
    endKeyboardSizing();
    sizesRef.current = null;
  };

  const name: string = translator.translateTemplate(
    COLUMN_RESIZE_NAME_TEMPLATE,
    { column: props.columnTitle },
  );

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label={name}
      aria-valuenow={valueNow}
      aria-valuemin={valueMin}
      aria-valuemax={COLUMN_MAX_WIDTH_IN_PX}
      aria-valuetext={
        valueNow !== undefined
          ? translator.translatePlural(COLUMN_RESIZE_WIDTH_TEMPLATE, valueNow)
          : undefined
      }
      tabIndex={0}
      title={translator.translateText(COLUMN_RESIZE_HINT)}
      className={COLUMN_RESIZE_HANDLE_CLASS_NAME}
      {...{ [COLUMN_RESIZE_HANDLE_ATTRIBUTE]: "true" }}
      data-column-id={props.columnId}
      data-resizing={isResizing ? "true" : undefined}
      data-testid={props.dataTestId || COLUMN_RESIZE_HANDLE_TEST_ID}
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
        // A press on the edge is not the header's click, nor its card's.
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <span aria-hidden="true" className={COLUMN_RESIZE_LINE_CLASS_NAME} />
      <span
        aria-hidden="true"
        className={COLUMN_RESIZE_ACTIVE_LINE_CLASS_NAME}
      />
      {/*
       * Drawn from the start and hidden: its classes are on the page before
       * the first drag, so pressing an edge never has the page's styles
       * worked out again.
       */}
      <span
        aria-hidden="true"
        className={COLUMN_RESIZE_GUIDE_CLASS_NAME}
        style={{
          height: `${Math.round(guideHeight)}px`,
          display: isResizing && guideHeight > 0 ? undefined : "none",
        }}
        data-testid={COLUMN_RESIZE_GUIDE_TEST_ID}
      />
    </div>
  );
};

export default ColumnResizeHandle;
