import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import ColumnResizeHandle, {
  COLUMN_RESIZE_DOUBLE_PRESS_MS,
  COLUMN_RESIZE_GUIDE_ONLY_ROWS,
  COLUMN_RESIZE_HINT,
  COLUMN_RESIZE_SLOW_FRAME_MS,
} from "../../../../../UI/Components/Table/ColumnResize/ColumnResizeHandle";
import * as Measure from "../../../../../UI/Components/Table/ColumnResize/ColumnWidthMeasure";
import { ColumnWidthKind } from "../../../../../UI/Components/Table/ColumnResize/ColumnWidths";
import {
  COLUMN_RESIZE_GUIDE_TEST_ID,
  COLUMN_RESIZE_HANDLE_TEST_ID,
} from "../../../../../UI/Components/Table/ColumnResize/ColumnResizeLayout";

/*
 * The edge a person drags to size a column: with a pointer (and the column
 * following it, one width a frame on its header cell), with a double
 * press (fit), with the keyboard (the arrows, Shift, Home, End, Enter,
 * Delete, Escape mid-drag), in both reading directions - and, on a list too
 * long to draw again every frame, with only its line following the
 * pointer. Its header cell's width is the one thing it writes while it
 * moves; the width is kept (onWidthChange) once, when it is let go.
 *
 * What the column holds is read off the page in a browser
 * (ColumnWidthMeasure, its own suite): here it is handed in.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

const MEASURED: Measure.ColumnMeasurement = {
  currentWidth: 200,
  headerMinContentWidth: 80,
  headerMaxContentWidth: 120,
  widestValueWidth: 260,
  cellPaddingWidth: 24,
};

// What MEASURED makes of a column of text: 8rem of value plus its padding.
const FLOOR: number = 128 + 24;
// Its widest value whole, its padding in.
const FIT: number = 260 + 24;

beforeAll(() => {
  if (typeof window.PointerEvent === "undefined") {
    class TestPointerEvent extends MouseEvent {
      public pointerId: number;
      public pointerType: string;

      public constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "mouse";
      }
    }

    Object.defineProperty(window, "PointerEvent", {
      configurable: true,
      writable: true,
      value: TestPointerEvent,
    });
  }
});

let now: number = 1_000_000;
let direction: "ltr" | "rtl" = "ltr";

beforeEach(() => {
  now = 1_000_000;
  direction = "ltr";

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  // A frame runs at once: one width a frame is one width a move here.
  jest
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback: FrameRequestCallback): number => {
      callback(now);
      return 1;
    });

  jest
    .spyOn(Measure, "measureTableColumn")
    .mockImplementation((): Measure.ColumnMeasurement => {
      return MEASURED;
    });

  const realGetComputedStyle: typeof window.getComputedStyle =
    window.getComputedStyle.bind(window);

  jest
    .spyOn(window, "getComputedStyle")
    .mockImplementation((element: Element): CSSStyleDeclaration => {
      const style: CSSStyleDeclaration = realGetComputedStyle(element);

      return new Proxy(style, {
        get: (target: CSSStyleDeclaration, property: string | symbol) => {
          if (property === "direction") {
            return direction;
          }

          const value: unknown = (target as unknown as Record<string | symbol, unknown>)[
            property
          ];

          return typeof value === "function"
            ? (value as (...args: Array<unknown>) => unknown).bind(target)
            : value;
        },
      });
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  document.body.innerHTML = "";
});

interface Calls {
  onWidthChange: jest.Mock<(columnId: string, width: number | null) => void>;
  onResizeStart: jest.Mock<
    (columnId: string, headerCell: HTMLTableCellElement) => void
  >;
  onResizeMove: jest.Mock<(columnId: string, width: number) => void>;
  onResizeEnd: jest.Mock<(columnId: string) => void>;
  parentClick: jest.Mock<() => void>;
  parentPointerDown: jest.Mock<() => void>;
}

interface Drawn {
  handle: HTMLElement;
  headerCell: HTMLTableCellElement;
  calls: Calls;
  rerender: (width?: number | undefined) => void;
}

const drawHandle: (data?: {
  width?: number | undefined;
  kind?: ColumnWidthKind | undefined;
  rows?: number | undefined;
}) => Drawn = (data?: {
  width?: number | undefined;
  kind?: ColumnWidthKind | undefined;
  rows?: number | undefined;
}): Drawn => {
  const calls: Calls = {
    onWidthChange: jest.fn<(columnId: string, width: number | null) => void>(),
    onResizeStart:
      jest.fn<(columnId: string, headerCell: HTMLTableCellElement) => void>(),
    onResizeMove: jest.fn<(columnId: string, width: number) => void>(),
    onResizeEnd: jest.fn<(columnId: string) => void>(),
    parentClick: jest.fn<() => void>(),
    parentPointerDown: jest.fn<() => void>(),
  };

  const rows: Array<ReactElement> = [];

  for (let index: number = 0; index < (data?.rows ?? 3); index++) {
    rows.push(
      <tr key={index}>
        <td>Row {index}</td>
      </tr>,
    );
  }

  const tree: (width?: number | undefined) => ReactElement = (
    width?: number | undefined,
  ): ReactElement => {
    return (
      <div onClick={calls.parentClick} onPointerDown={calls.parentPointerDown}>
        <table>
          <thead>
            <tr>
              <th>
                <button type="button">Status</button>
                <ColumnResizeHandle
                  columnId="status"
                  columnTitle="Status"
                  kind={data?.kind ?? ColumnWidthKind.Text}
                  width={width}
                  onWidthChange={calls.onWidthChange}
                  onResizeStart={calls.onResizeStart}
                  onResizeMove={calls.onResizeMove}
                  onResizeEnd={calls.onResizeEnd}
                />
              </th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  };

  const result: ReturnType<typeof render> = render(tree(data?.width));
  const handle: HTMLElement = document.querySelector(
    `[data-testid="${COLUMN_RESIZE_HANDLE_TEST_ID}"]`,
  ) as HTMLElement;

  return {
    handle: handle,
    headerCell: document.querySelector("th") as HTMLTableCellElement,
    calls: calls,
    rerender: (width?: number | undefined): void => {
      result.rerender(tree(width));
    },
  };
};

type PointerFunction = (
  element: HTMLElement,
  type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel",
  clientX: number,
  extra?: PointerEventInit,
) => void;

const pointer: PointerFunction = (
  element: HTMLElement,
  type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel",
  clientX: number,
  extra?: PointerEventInit,
): void => {
  act(() => {
    fireEvent[type](element, {
      clientX: clientX,
      clientY: 10,
      button: 0,
      pointerId: 7,
      ...(extra || {}),
    });
  });
};

const dragBy: (
  handle: HTMLElement,
  distances: Array<number>,
  release?: boolean,
) => void = (
  handle: HTMLElement,
  distances: Array<number>,
  release: boolean = true,
): void => {
  pointer(handle, "pointerDown", 500);

  for (const distance of distances) {
    pointer(handle, "pointerMove", 500 + distance);
  }

  if (release) {
    pointer(handle, "pointerUp", 500 + (distances[distances.length - 1] || 0));
  }
};

const widthOf: (cell: HTMLElement) => Array<string> = (
  cell: HTMLElement,
): Array<string> => {
  return [cell.style.width, cell.style.minWidth, cell.style.maxWidth];
};

describe("what the edge is", () => {
  test("a vertical separator named after its column, which the keyboard reaches, with its hint", () => {
    const { handle } = drawHandle({ width: 240 });

    expect(handle).toHaveAttribute("role", "separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-label", "Resize the Status column");
    expect(handle).toHaveAttribute("tabindex", "0");
    expect(handle).toHaveAttribute("title", COLUMN_RESIZE_HINT);
    expect(COLUMN_RESIZE_HINT).toBe("Drag to resize. Double-click to fit.");
    expect(handle).toHaveAttribute("data-column-resize-handle", "true");
    expect(handle).toHaveAttribute("data-column-id", "status");
  });

  test("it says its column's width, in words", () => {
    const { handle } = drawHandle({ width: 240 });

    expect(handle).toHaveAttribute("aria-valuenow", "240");
    expect(handle).toHaveAttribute("aria-valuetext", "240 pixels wide");
    expect(handle).toHaveAttribute("aria-valuemax", "1600");
    expect(handle).toHaveAttribute("aria-valuemin", "48");
  });

  test("a width kept elsewhere (another tab, a reset) is the one it says", () => {
    const { handle, rerender } = drawHandle({ width: 240 });

    rerender(310);
    expect(handle).toHaveAttribute("aria-valuenow", "310");

    rerender(undefined);
    expect(handle).not.toHaveAttribute("aria-valuenow");
  });

  test("its guide down the rows is drawn from the start, and shown only while it is dragged", () => {
    const { handle } = drawHandle();
    const guide: HTMLElement = handle.querySelector(
      `[data-testid="${COLUMN_RESIZE_GUIDE_TEST_ID}"]`,
    ) as HTMLElement;

    expect(guide).not.toBeNull();
    expect(guide.style.display).toBe("none");
  });
});

describe("dragging the edge with a pointer", () => {
  test("left to right the column follows the pointer, and its width is kept when it is let go", () => {
    const { handle, headerCell, calls } = drawHandle({ width: 200 });

    dragBy(handle, [20, 60], false);

    expect(widthOf(headerCell)).toEqual(["260px", "260px", "260px"]);
    expect(calls.onResizeMove).toHaveBeenLastCalledWith("status", 260);
    expect(calls.onWidthChange).not.toHaveBeenCalled();
    expect(handle).toHaveAttribute("data-resizing", "true");
    expect(handle).toHaveAttribute("aria-valuenow", "260");

    pointer(handle, "pointerUp", 560);

    expect(calls.onWidthChange).toHaveBeenCalledTimes(1);
    expect(calls.onWidthChange).toHaveBeenCalledWith("status", 260);
    expect(calls.onResizeEnd).toHaveBeenCalledWith("status");
    expect(handle).not.toHaveAttribute("data-resizing");
  });

  test("the table is told once, on the first move - never on a press alone", () => {
    const { handle, headerCell, calls } = drawHandle({ width: 200 });

    pointer(handle, "pointerDown", 500);
    expect(calls.onResizeStart).not.toHaveBeenCalled();

    pointer(handle, "pointerMove", 530);
    pointer(handle, "pointerMove", 540);

    expect(calls.onResizeStart).toHaveBeenCalledTimes(1);
    expect(calls.onResizeStart).toHaveBeenCalledWith("status", headerCell);

    pointer(handle, "pointerUp", 540);
    expect(calls.onResizeEnd).toHaveBeenCalledTimes(1);
  });

  test("a column with no width of its own starts from the width it is drawn at", () => {
    const { handle, headerCell, calls } = drawHandle();

    jest
      .spyOn(headerCell, "getBoundingClientRect")
      .mockReturnValue({ width: 180, bottom: 40 } as DOMRect);

    dragBy(handle, [30]);

    expect(calls.onWidthChange).toHaveBeenCalledWith("status", 210);
  });

  test("narrower, never past the floor: a header, a short value and a date stay whole", () => {
    const { handle, calls } = drawHandle({ width: 200 });

    dragBy(handle, [-30, -400]);

    expect(calls.onWidthChange).toHaveBeenCalledWith("status", FLOOR);
  });

  test("right to left the edge is the column's left one: moving left widens it", () => {
    direction = "rtl";

    const { handle, calls } = drawHandle({ width: 200 });

    dragBy(handle, [-70]);
    expect(calls.onWidthChange).toHaveBeenLastCalledWith("status", 270);

    dragBy(handle, [20]);
    expect(calls.onWidthChange).toHaveBeenLastCalledWith("status", 180);
  });

  test("a column of dates grows for a wider date: no most width on its header", () => {
    const { handle, headerCell } = drawHandle({
      width: 300,
      kind: ColumnWidthKind.Whole,
    });

    dragBy(handle, [40], false);

    expect(widthOf(headerCell)).toEqual(["340px", "340px", ""]);
  });

  test("a column of dates is never narrower than its widest date", () => {
    const { handle, calls } = drawHandle({
      width: 300,
      kind: ColumnWidthKind.Whole,
    });

    dragBy(handle, [-200]);

    // 260 of date and its padding: never cut, as a short name would be.
    expect(calls.onWidthChange).toHaveBeenCalledWith("status", 260 + 24);
  });

  test("a press that does not move changes nothing and tells no one", () => {
    const { handle, headerCell, calls } = drawHandle({ width: 200 });

    headerCell.style.width = "200px";

    dragBy(handle, [1]);

    expect(calls.onWidthChange).not.toHaveBeenCalled();
    expect(calls.onResizeStart).not.toHaveBeenCalled();
    expect(calls.onResizeEnd).not.toHaveBeenCalled();
    expect(headerCell.style.width).toBe("200px");
  });

  test("Escape mid-drag puts the column back as it was", () => {
    const { handle, headerCell, calls } = drawHandle({ width: 200 });

    headerCell.style.width = "200px";
    dragBy(handle, [80], false);
    expect(headerCell.style.width).toBe("280px");

    act(() => {
      fireEvent.keyDown(handle, { key: "Escape" });
    });

    expect(headerCell.style.width).toBe("200px");
    expect(calls.onWidthChange).not.toHaveBeenCalled();
    expect(calls.onResizeEnd).toHaveBeenCalledTimes(1);
    expect(handle).not.toHaveAttribute("data-resizing");
  });

  test("a pointer the browser takes back (pointercancel) puts the column back too", () => {
    const { handle, calls } = drawHandle({ width: 200 });

    dragBy(handle, [80], false);
    pointer(handle, "pointerCancel", 580);

    expect(calls.onWidthChange).not.toHaveBeenCalled();
    expect(handle).not.toHaveAttribute("data-resizing");
  });

  test("only the main button drags: a right click is the browser's", () => {
    const { handle, calls } = drawHandle({ width: 200 });

    pointer(handle, "pointerDown", 500, { button: 2 });
    pointer(handle, "pointerMove", 600);
    pointer(handle, "pointerUp", 600);

    expect(calls.onWidthChange).not.toHaveBeenCalled();
    expect(handle).not.toHaveAttribute("data-resizing");
  });

  test("another pointer's moves are not this drag's", () => {
    const { handle, calls } = drawHandle({ width: 200 });

    pointer(handle, "pointerDown", 500);
    pointer(handle, "pointerMove", 650, { pointerId: 99 });
    pointer(handle, "pointerUp", 650, { pointerId: 99 });

    expect(calls.onWidthChange).not.toHaveBeenCalled();
    expect(handle).toHaveAttribute("data-resizing", "true");
  });

  test("the guide runs down the rows while the edge is dragged", () => {
    const { handle, headerCell } = drawHandle({ width: 200 });
    const table: HTMLTableElement = headerCell.closest(
      "table",
    ) as HTMLTableElement;

    jest
      .spyOn(headerCell, "getBoundingClientRect")
      .mockReturnValue({ width: 200, bottom: 40 } as DOMRect);
    jest
      .spyOn(table, "getBoundingClientRect")
      .mockReturnValue({ width: 900, bottom: 340 } as DOMRect);

    pointer(handle, "pointerDown", 500);

    const guide: HTMLElement = handle.querySelector(
      `[data-testid="${COLUMN_RESIZE_GUIDE_TEST_ID}"]`,
    ) as HTMLElement;

    expect(guide.style.display).toBe("");
    expect(guide.style.height).toBe("300px");

    pointer(handle, "pointerUp", 500);
    expect(guide.style.display).toBe("none");
  });

  test("a press on the edge is no sort, and no pick of the card or widget it is in", () => {
    const { handle, calls } = drawHandle({ width: 200 });

    dragBy(handle, [40]);

    act(() => {
      fireEvent.click(handle);
    });

    expect(calls.parentPointerDown).not.toHaveBeenCalled();
    expect(calls.parentClick).not.toHaveBeenCalled();
  });
});

describe("a double press fits the column to its content", () => {
  test("two presses close in time fit it: its header on one line, its widest value whole", () => {
    const { handle, calls } = drawHandle({ width: 200 });

    dragBy(handle, [0]);
    now += 200;
    dragBy(handle, [0]);

    expect(calls.onWidthChange).toHaveBeenCalledTimes(1);
    expect(calls.onWidthChange).toHaveBeenCalledWith("status", FIT);
  });

  test("two presses far apart in time are two clicks", () => {
    const { handle, calls } = drawHandle({ width: 200 });

    dragBy(handle, [0]);
    now += COLUMN_RESIZE_DOUBLE_PRESS_MS + 1;
    dragBy(handle, [0]);

    expect(calls.onWidthChange).not.toHaveBeenCalled();
  });

  test("a drag between two presses is no double press", () => {
    const { handle, calls } = drawHandle({ width: 200 });

    dragBy(handle, [0]);
    now += 100;
    dragBy(handle, [40]);
    now += 100;
    dragBy(handle, [0]);

    expect(calls.onWidthChange).toHaveBeenCalledTimes(1);
    expect(calls.onWidthChange).toHaveBeenCalledWith("status", 240);
  });
});

describe("the keyboard on the edge", () => {
  const key: (handle: HTMLElement, name: string, shift?: boolean) => void = (
    handle: HTMLElement,
    name: string,
    shift?: boolean,
  ): void => {
    act(() => {
      fireEvent.keyDown(handle, { key: name, shiftKey: Boolean(shift) });
    });
  };

  const keyUp: (handle: HTMLElement, name: string) => void = (
    handle: HTMLElement,
    name: string,
  ): void => {
    act(() => {
      fireEvent.keyUp(handle, { key: name });
    });
  };

  test("an arrow held down moves the column a step a press, and the width is kept when it is let go", () => {
    const { handle, headerCell, calls } = drawHandle({ width: 200 });

    key(handle, "ArrowRight");
    key(handle, "ArrowRight");

    expect(headerCell.style.width).toBe("232px");
    expect(handle).toHaveAttribute("aria-valuenow", "232");
    expect(handle).toHaveAttribute("aria-valuetext", "232 pixels wide");
    expect(calls.onWidthChange).not.toHaveBeenCalled();
    expect(calls.onResizeStart).toHaveBeenCalledTimes(1);

    keyUp(handle, "ArrowRight");

    expect(calls.onWidthChange).toHaveBeenCalledWith("status", 232);
    expect(calls.onResizeEnd).toHaveBeenCalledTimes(1);
  });

  test("Shift takes bigger steps; the left arrow narrows, never past the floor", () => {
    const { handle, calls } = drawHandle({ width: 200 });

    key(handle, "ArrowRight", true);
    keyUp(handle, "ArrowRight");
    expect(calls.onWidthChange).toHaveBeenLastCalledWith("status", 264);

    key(handle, "ArrowLeft", true);
    key(handle, "ArrowLeft", true);
    key(handle, "ArrowLeft", true);
    keyUp(handle, "ArrowLeft");
    expect(calls.onWidthChange).toHaveBeenLastCalledWith("status", FLOOR);
  });

  test("right to left the left arrow widens the column", () => {
    direction = "rtl";

    const { handle, calls } = drawHandle({ width: 200 });

    key(handle, "ArrowLeft");
    keyUp(handle, "ArrowLeft");

    expect(calls.onWidthChange).toHaveBeenCalledWith("status", 216);
  });

  test("Home, End and Enter are kept at once: as narrow as it goes, and fitted", () => {
    const { handle, calls } = drawHandle({ width: 200 });

    key(handle, "Home");
    expect(calls.onWidthChange).toHaveBeenLastCalledWith("status", FLOOR);

    key(handle, "End");
    expect(calls.onWidthChange).toHaveBeenLastCalledWith("status", FIT);

    key(handle, "Enter");
    expect(calls.onWidthChange).toHaveBeenLastCalledWith("status", FIT);
    expect(calls.onWidthChange).toHaveBeenCalledTimes(3);
  });

  test("Delete gives the column back to the table", () => {
    const { handle, calls } = drawHandle({ width: 260 });

    key(handle, "Delete");

    expect(calls.onWidthChange).toHaveBeenCalledWith("status", null);
  });

  test("a key held with Ctrl, Alt or Cmd is the page's shortcut, not the edge's", () => {
    const { handle, calls } = drawHandle({ width: 200 });

    act(() => {
      fireEvent.keyDown(handle, { key: "ArrowRight", ctrlKey: true });
      fireEvent.keyDown(handle, { key: "ArrowRight", altKey: true });
      fireEvent.keyDown(handle, { key: "ArrowRight", metaKey: true });
    });

    expect(calls.onResizeStart).not.toHaveBeenCalled();
    expect(calls.onWidthChange).not.toHaveBeenCalled();
  });

  test("leaving the edge with an arrow still down keeps the width", () => {
    const { handle, calls } = drawHandle({ width: 200 });

    key(handle, "ArrowRight");
    act(() => {
      fireEvent.blur(handle);
    });

    expect(calls.onWidthChange).toHaveBeenCalledWith("status", 216);
  });

  test("Tab goes on to the next control", () => {
    const { handle } = drawHandle({ width: 200 });
    const event: KeyboardEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      handle.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
  });
});

describe("a list too long to draw again every frame", () => {
  test(`more than ${COLUMN_RESIZE_GUIDE_ONLY_ROWS} rows: only the edge's line follows the pointer, and the width is kept when it is let go`, () => {
    const { handle, headerCell, calls } = drawHandle({
      width: 200,
      rows: COLUMN_RESIZE_GUIDE_ONLY_ROWS + 1,
    });

    headerCell.style.width = "200px";
    dragBy(handle, [30, 60], false);

    // The table is left as it is drawn; the edge is moved over it.
    expect(headerCell.style.width).toBe("200px");
    expect(handle.style.transform).toBe("translateX(60px)");
    expect(calls.onResizeStart).not.toHaveBeenCalled();
    expect(handle).toHaveAttribute("aria-valuenow", "260");

    pointer(handle, "pointerUp", 560);

    expect(calls.onWidthChange).toHaveBeenCalledWith("status", 260);
    expect(handle.style.transform).toBe("");
  });

  test("right to left the line moves left as the column widens", () => {
    direction = "rtl";

    const { handle } = drawHandle({
      width: 200,
      rows: COLUMN_RESIZE_GUIDE_ONLY_ROWS + 1,
    });

    dragBy(handle, [-50], false);

    expect(handle.style.transform).toBe("translateX(-50px)");
  });

  test(`a table slower than ${COLUMN_RESIZE_SLOW_FRAME_MS}ms a frame twice running is left as it is from then on`, () => {
    const { handle, headerCell, calls } = drawHandle({ width: 200 });

    // Each frame drawn takes the table 80ms.
    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback): number => {
        now += 80;
        callback(now);
        return 1;
      });

    pointer(handle, "pointerDown", 500);
    pointer(handle, "pointerMove", 510);
    pointer(handle, "pointerMove", 520);

    // Two widths drawn, two slow frames: the third move only moves the line.
    expect(headerCell.style.width).toBe("220px");

    pointer(handle, "pointerMove", 560);

    expect(headerCell.style.width).toBe("220px");
    expect(handle.style.transform).toBe("translateX(40px)");

    pointer(handle, "pointerUp", 560);
    expect(calls.onWidthChange).toHaveBeenCalledWith("status", 260);
  });
});
