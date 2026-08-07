import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import { act, render, screen } from "@testing-library/react";
import useDashboardGridDnd, {
  DashboardGridDndResult,
  ResizeDirection,
} from "../../../UI/Utils/UseDashboardGridDnd";
import { GridRect } from "../../../Utils/Dashboard/GridLayout";

/*
 * Grid used throughout: 50px units with a 10px gap, so one grid cell pitch
 * is 60px. Moving the pointer 60px moves the widget exactly one unit.
 */
const UNIT: number = 50;
const GAP: number = 10;
const CELL: number = UNIT + GAP;

function makeRect(spec: Partial<GridRect> & { id: string }): GridRect {
  return {
    left: 0,
    top: 0,
    width: 3,
    height: 2,
    minWidth: 1,
    minHeight: 1,
    ...spec,
  };
}

interface HarnessProps {
  initialItems: Array<GridRect>;
  isEnabled?: boolean;
  onCommit?: (rects: Array<GridRect>) => void;
  onItemClick?: (id: string) => void;
}

/**
 * Renders the hook the way the real canvas does: absolutely positioned
 * items registered with the hook, plus probes exposing hook state.
 */
const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const [items, setItems] = useState<Array<GridRect>>(props.initialItems);
  const canvasRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  const dnd: DashboardGridDndResult = useDashboardGridDnd({
    items,
    metrics: { unitSizeInPx: UNIT, gapInPx: GAP, columns: 12 },
    isEnabled: props.isEnabled ?? true,
    canvasRef,
    onCommit: (rects: Array<GridRect>) => {
      setItems(rects);
      if (props.onCommit) {
        props.onCommit(rects);
      }
    },
    onItemClick: props.onItemClick,
  });

  return (
    <div ref={canvasRef} data-testid="canvas">
      <div data-testid="gesture">{dnd.isGestureActive ? "active" : "idle"}</div>
      <div data-testid="total-rows">{dnd.totalRows}</div>
      {dnd.placeholderRect && (
        <div
          data-testid="placeholder"
          data-left={dnd.placeholderRect.left}
          data-top={dnd.placeholderRect.top}
          data-width={dnd.placeholderRect.width}
          data-height={dnd.placeholderRect.height}
        />
      )}
      {dnd.rects.map((rect: GridRect) => {
        return (
          <div
            key={rect.id}
            data-testid={`item-${rect.id}`}
            data-left={rect.left}
            data-top={rect.top}
            data-width={rect.width}
            data-height={rect.height}
            ref={(element: HTMLDivElement | null) => {
              dnd.registerItemElement(rect.id, element);
            }}
            onPointerDown={(event: React.PointerEvent) => {
              dnd.startMove(rect.id, event);
            }}
          >
            {(["n", "s", "e", "w", "se"] as Array<ResizeDirection>).map(
              (direction: ResizeDirection) => {
                return (
                  <div
                    key={direction}
                    data-testid={`resize-${rect.id}-${direction}`}
                    onPointerDown={(event: React.PointerEvent) => {
                      event.stopPropagation();
                      dnd.startResize(rect.id, direction, event);
                    }}
                  />
                );
              },
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── event helpers ───────────────────────────────────────────────────────

interface PointerOptions {
  x: number;
  y: number;
  pointerId?: number;
  button?: number;
  isPrimary?: boolean;
}

/**
 * jsdom has no PointerEvent constructor, so build a MouseEvent and graft
 * the pointer fields on. The hook only reads clientX/Y, pointerId, button
 * and isPrimary.
 */
function makePointerEvent(type: string, options: PointerOptions): Event {
  const event: MouseEvent = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: options.x,
    clientY: options.y,
    button: options.button ?? 0,
  });
  Object.defineProperty(event, "pointerId", {
    value: options.pointerId ?? 1,
  });
  Object.defineProperty(event, "isPrimary", {
    value: options.isPrimary ?? true,
  });
  return event;
}

function press(element: Element, options: PointerOptions): void {
  act(() => {
    element.dispatchEvent(makePointerEvent("pointerdown", options));
  });
}

/** Move the pointer and run a few animation frames so previews update. */
function moveTo(options: PointerOptions): void {
  act(() => {
    window.dispatchEvent(makePointerEvent("pointermove", options));
    jest.advanceTimersByTime(64);
  });
}

function release(options: PointerOptions): void {
  act(() => {
    window.dispatchEvent(makePointerEvent("pointerup", options));
  });
}

function pressEscape(): void {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

function itemAttr(id: string, attr: string): number {
  const element: HTMLElement = screen.getByTestId(`item-${id}`);
  return Number(element.getAttribute(`data-${attr}`));
}

function gestureState(): string {
  return screen.getByTestId("gesture").textContent || "";
}

beforeAll(() => {
  /*
   * jsdom implements scrollBy as a loud not-implemented stub. Auto-scroll
   * legitimately fires when the pointer is near the viewport edge, so give
   * it a quiet landing spot.
   */
  Object.defineProperty(window, "scrollBy", {
    value: jest.fn(),
    writable: true,
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  (window.scrollBy as jest.Mock).mockClear();
});

afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe("useDashboardGridDnd — click vs drag", () => {
  test("press and release without movement is a click, not a drag", () => {
    const onItemClick: jest.Mock = jest.fn();
    const onCommit: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[makeRect({ id: "a" })]}
        onItemClick={onItemClick}
        onCommit={onCommit}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    release({ x: 10, y: 10 });

    expect(onItemClick).toHaveBeenCalledWith("a");
    expect(onCommit).not.toHaveBeenCalled();
    expect(gestureState()).toBe("idle");
  });

  test("movement below the threshold still counts as a click", () => {
    const onItemClick: jest.Mock = jest.fn();
    const onCommit: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[makeRect({ id: "a" })]}
        onItemClick={onItemClick}
        onCommit={onCommit}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 13, y: 10 });
    expect(gestureState()).toBe("idle");
    release({ x: 13, y: 10 });

    expect(onItemClick).toHaveBeenCalledWith("a");
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("movement past the threshold becomes a drag and suppresses the click", () => {
    const onItemClick: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[makeRect({ id: "a" })]}
        onItemClick={onItemClick}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 40, y: 10 });
    expect(gestureState()).toBe("active");
    release({ x: 40, y: 10 });

    expect(onItemClick).not.toHaveBeenCalled();
  });

  test("secondary mouse buttons never start a gesture", () => {
    const onItemClick: jest.Mock = jest.fn();
    const onCommit: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[makeRect({ id: "a" })]}
        onItemClick={onItemClick}
        onCommit={onCommit}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10, button: 2 });
    moveTo({ x: 200, y: 10, button: 2 });
    release({ x: 200, y: 10, button: 2 });

    expect(gestureState()).toBe("idle");
    expect(onItemClick).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("gestures are inert when the hook is disabled (view mode)", () => {
    const onCommit: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[makeRect({ id: "a" })]}
        isEnabled={false}
        onCommit={onCommit}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 300, y: 10 });
    release({ x: 300, y: 10 });

    expect(gestureState()).toBe("idle");
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("useDashboardGridDnd — moving widgets", () => {
  test("dragging two cells right commits the widget two units right", () => {
    const onCommit: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 0 })]}
        onCommit={onCommit}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 10 + 2 * CELL, y: 10 });
    release({ x: 10 + 2 * CELL, y: 10 });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(itemAttr("a", "left")).toBe(2);
    expect(itemAttr("a", "top")).toBe(0);
  });

  test("the placeholder tracks the snapped destination during the drag", () => {
    render(<Harness initialItems={[makeRect({ id: "a", left: 0, top: 0 })]} />);

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 10 + 3 * CELL, y: 10 + 2 * CELL });

    const placeholder: HTMLElement = screen.getByTestId("placeholder");
    expect(placeholder.getAttribute("data-left")).toBe("3");
    expect(placeholder.getAttribute("data-top")).toBe("2");

    release({ x: 10 + 3 * CELL, y: 10 + 2 * CELL });
  });

  test("the dragged widget stays pinned at its origin in React while active", () => {
    render(<Harness initialItems={[makeRect({ id: "a", left: 0, top: 0 })]} />);

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 10 + 4 * CELL, y: 10 });

    // The rendered rect must not move mid-gesture …
    expect(itemAttr("a", "left")).toBe(0);

    release({ x: 10 + 4 * CELL, y: 10 });

    // … and lands after the drop.
    expect(itemAttr("a", "left")).toBe(4);
  });

  test("dropping onto a neighbour pushes the neighbour down", () => {
    const onCommit: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[
          makeRect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
          makeRect({ id: "b", left: 0, top: 4, width: 3, height: 2 }),
        ]}
        onCommit={onCommit}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 10, y: 10 + 4 * CELL });

    // Live preview: b is already shown pushed out of the way.
    expect(itemAttr("b", "top")).toBe(6);

    release({ x: 10, y: 10 + 4 * CELL });

    expect(itemAttr("a", "top")).toBe(4);
    expect(itemAttr("b", "top")).toBe(6);

    const committed: Array<GridRect> = onCommit.mock.calls[0]![0];
    expect(
      committed.find((r: GridRect) => {
        return r.id === "b";
      }),
    ).toMatchObject({ top: 6 });
  });

  test("dragging away and back home commits nothing", () => {
    const onCommit: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[
          makeRect({ id: "a", left: 0, top: 0 }),
          makeRect({ id: "b", left: 0, top: 4 }),
        ]}
        onCommit={onCommit}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 10, y: 10 + 4 * CELL });
    expect(itemAttr("b", "top")).toBe(6);
    moveTo({ x: 10, y: 10 });
    // The push preview must have rolled back — nothing accumulates.
    expect(itemAttr("b", "top")).toBe(4);
    release({ x: 10, y: 10 });

    expect(onCommit).not.toHaveBeenCalled();
    expect(itemAttr("a", "top")).toBe(0);
    expect(itemAttr("b", "top")).toBe(4);
  });

  test("dragging past the right edge clamps to the last column", () => {
    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 0, width: 3 })]}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 5000, y: 10 });
    release({ x: 5000, y: 10 });

    expect(itemAttr("a", "left")).toBe(9); // 12 columns - width 3
  });

  test("total rows grow while dragging below the current board", () => {
    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 0, height: 2 })]}
      />,
    );

    expect(screen.getByTestId("total-rows").textContent).toBe("2");

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 10, y: 10 + 4 * CELL });

    expect(screen.getByTestId("total-rows").textContent).toBe("6");

    release({ x: 10, y: 10 + 4 * CELL });
  });

  test("one gesture cannot run away past the board bottom (auto-grow cap)", () => {
    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 0, height: 2 })]}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    // Try to drag 40 rows down — far past the 6-row growth allowance.
    moveTo({ x: 10, y: 10 + 40 * CELL });
    release({ x: 10, y: 10 + 40 * CELL });

    /*
     * Board bottom was 2; the gesture may reach at most 2 + 6 rows,
     * so a 2-tall widget tops out at row 6.
     */
    expect(itemAttr("a", "top")).toBe(6);
  });

  test("the active element's transform follows the pointer imperatively", () => {
    render(
      <Harness
        initialItems={[
          makeRect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
        ]}
      />,
    );

    const element: HTMLElement = screen.getByTestId("item-a");

    press(element, { x: 10, y: 10 });
    moveTo({ x: 10 + CELL, y: 10 });

    // Raw pixel tracking: exactly one cell right of the origin.
    expect(element.style.transform).toBe(`translate(${CELL}px, 0px)`);
    expect(element.style.transition).toBe("none");
    expect(element.style.zIndex).toBe("60");

    release({ x: 10 + CELL, y: 10 });

    /*
     * Settled: snapped to the grid with the settle transition active,
     * still elevated while the glide animation runs...
     */
    expect(element.style.transform).toBe(`translate(${CELL}px, 0px)`);
    expect(element.style.transition).toContain("transform");
    expect(element.style.transition).not.toBe("none");
    expect(element.style.zIndex).toBe("60");

    // ...and the elevation clears once the settle finishes.
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(element.style.zIndex).toBe("");
  });

  test("a flick released before any animation frame still commits at the release point", () => {
    const onCommit: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 0 })]}
        onCommit={onCommit}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    /*
     * Move and release with NO timer advance: no rAF frame ever runs, so
     * only the pointerup handler's final reading can place the widget.
     */
    act(() => {
      window.dispatchEvent(
        makePointerEvent("pointermove", { x: 10 + 2 * CELL, y: 10 }),
      );
      window.dispatchEvent(
        makePointerEvent("pointerup", { x: 10 + 2 * CELL, y: 10 }),
      );
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(itemAttr("a", "left")).toBe(2);
  });
});

describe("useDashboardGridDnd — cancelling", () => {
  test("Escape cancels the drag and restores the layout", () => {
    const onCommit: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[
          makeRect({ id: "a", left: 0, top: 0 }),
          makeRect({ id: "b", left: 0, top: 4 }),
        ]}
        onCommit={onCommit}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 10, y: 10 + 4 * CELL });
    expect(itemAttr("b", "top")).toBe(6);

    pressEscape();

    expect(gestureState()).toBe("idle");
    expect(itemAttr("a", "top")).toBe(0);
    expect(itemAttr("b", "top")).toBe(4);

    // A later pointerup must not commit either.
    release({ x: 10, y: 10 + 4 * CELL });
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("pointercancel aborts without committing", () => {
    const onCommit: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 0 })]}
        onCommit={onCommit}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 10 + 3 * CELL, y: 10 });

    act(() => {
      window.dispatchEvent(makePointerEvent("pointercancel", { x: 0, y: 0 }));
    });

    expect(gestureState()).toBe("idle");
    expect(onCommit).not.toHaveBeenCalled();
    expect(itemAttr("a", "left")).toBe(0);
  });

  test("window blur aborts without committing", () => {
    const onCommit: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 0 })]}
        onCommit={onCommit}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 10 + 3 * CELL, y: 10 });

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(gestureState()).toBe("idle");
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("body text-selection lock is released when the gesture ends", () => {
    render(<Harness initialItems={[makeRect({ id: "a" })]} />);

    press(screen.getByTestId("item-a"), { x: 10, y: 10 });
    moveTo({ x: 100, y: 10 });
    expect(document.body.style.userSelect).toBe("none");

    release({ x: 100, y: 10 });
    expect(document.body.style.userSelect).toBe("");
  });
});

describe("useDashboardGridDnd — resizing", () => {
  test("east resize grows the width one unit per cell dragged", () => {
    const onCommit: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 0, width: 3 })]}
        onCommit={onCommit}
      />,
    );

    press(screen.getByTestId("resize-a-e"), { x: 170, y: 30 });
    moveTo({ x: 170 + CELL, y: 30 });
    release({ x: 170 + CELL, y: 30 });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(itemAttr("a", "width")).toBe(4);
    expect(itemAttr("a", "left")).toBe(0);
  });

  test("south resize pushes the widget below out of the way", () => {
    render(
      <Harness
        initialItems={[
          makeRect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
          makeRect({ id: "b", left: 0, top: 2, width: 3, height: 2 }),
        ]}
      />,
    );

    press(screen.getByTestId("resize-a-s"), { x: 30, y: 110 });
    moveTo({ x: 30, y: 110 + 2 * CELL });
    release({ x: 30, y: 110 + 2 * CELL });

    expect(itemAttr("a", "height")).toBe(4);
    expect(itemAttr("b", "top")).toBe(4);
  });

  test("west resize keeps the right edge anchored", () => {
    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 4, top: 0, width: 3 })]}
      />,
    );

    press(screen.getByTestId("resize-a-w"), { x: 4 * CELL, y: 30 });
    moveTo({ x: 4 * CELL - CELL, y: 30 });
    release({ x: 4 * CELL - CELL, y: 30 });

    expect(itemAttr("a", "left")).toBe(3);
    expect(itemAttr("a", "width")).toBe(4);
  });

  test("north resize keeps the bottom edge anchored", () => {
    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 3, height: 2 })]}
      />,
    );

    press(screen.getByTestId("resize-a-n"), { x: 30, y: 3 * CELL });
    moveTo({ x: 30, y: 3 * CELL - CELL });
    release({ x: 30, y: 3 * CELL - CELL });

    expect(itemAttr("a", "top")).toBe(2);
    expect(itemAttr("a", "height")).toBe(3);
  });

  test("resize can never shrink below the widget's minimum size", () => {
    render(
      <Harness
        initialItems={[
          makeRect({
            id: "a",
            left: 0,
            top: 0,
            width: 6,
            height: 4,
            minWidth: 2,
            minHeight: 2,
          }),
        ]}
      />,
    );

    press(screen.getByTestId("resize-a-se"), { x: 350, y: 230 });
    moveTo({ x: -1000, y: -1000 });
    release({ x: -1000, y: -1000 });

    expect(itemAttr("a", "width")).toBe(2);
    expect(itemAttr("a", "height")).toBe(2);
  });

  test("east resize cannot push the widget past the board edge", () => {
    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 9, top: 0, width: 3 })]}
      />,
    );

    press(screen.getByTestId("resize-a-e"), { x: 12 * CELL, y: 30 });
    moveTo({ x: 12 * CELL + 500, y: 30 });
    release({ x: 12 * CELL + 500, y: 30 });

    expect(itemAttr("a", "left")).toBe(9);
    expect(itemAttr("a", "width")).toBe(3);
  });

  test("resize activates without a drag threshold", () => {
    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 0, width: 3 })]}
      />,
    );

    press(screen.getByTestId("resize-a-e"), { x: 170, y: 30 });
    moveTo({ x: 172, y: 30 });

    expect(gestureState()).toBe("active");

    release({ x: 172, y: 30 });
    // 2px is less than half a cell: size snaps back to 3 wide, no commit.
    expect(itemAttr("a", "width")).toBe(3);
  });

  test("press-and-release on a resize handle is never treated as a click", () => {
    const onItemClick: jest.Mock = jest.fn();

    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 0, width: 3 })]}
        onItemClick={onItemClick}
      />,
    );

    press(screen.getByTestId("resize-a-e"), { x: 170, y: 30 });
    release({ x: 170, y: 30 });

    expect(onItemClick).not.toHaveBeenCalled();
    expect(gestureState()).toBe("idle");
  });

  test("north resize dragged past the top edge clamps at row zero", () => {
    render(
      <Harness
        initialItems={[
          makeRect({ id: "a", left: 0, top: 1, width: 3, height: 2 }),
        ]}
      />,
    );

    press(screen.getByTestId("resize-a-n"), { x: 30, y: CELL });
    moveTo({ x: 30, y: CELL - 5 * CELL });
    release({ x: 30, y: CELL - 5 * CELL });

    // The bottom edge (row 3) is anchored; the top clamps at 0.
    expect(itemAttr("a", "top")).toBe(0);
    expect(itemAttr("a", "height")).toBe(3);
  });
});

describe("useDashboardGridDnd — auto-scroll", () => {
  test("dragging near the bottom viewport edge scrolls the window down", () => {
    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 0, height: 2 })]}
      />,
    );

    const nearBottom: number = window.innerHeight - 10;

    press(screen.getByTestId("item-a"), { x: 10, y: 300 });
    moveTo({ x: 10, y: 300 + 60 });
    (window.scrollBy as jest.Mock).mockClear();

    moveTo({ x: 10, y: nearBottom });

    expect(window.scrollBy).toHaveBeenCalled();
    const [dx, dy] = (window.scrollBy as jest.Mock).mock.calls[0] as [
      number,
      number,
    ];
    expect(dx).toBe(0);
    expect(dy).toBeGreaterThan(0);

    release({ x: 10, y: nearBottom });
  });

  test("no auto-scroll while the pointer stays inside the viewport middle", () => {
    render(
      <Harness
        initialItems={[makeRect({ id: "a", left: 0, top: 0, height: 2 })]}
      />,
    );

    press(screen.getByTestId("item-a"), { x: 10, y: 300 });
    moveTo({ x: 200, y: 320 });
    (window.scrollBy as jest.Mock).mockClear();
    moveTo({ x: 260, y: 340 });

    expect(window.scrollBy).not.toHaveBeenCalled();

    release({ x: 260, y: 340 });
  });
});
