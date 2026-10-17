import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement, useRef } from "react";
import useTableScrollState, {
  TableScrollState,
  isInsideScrollingBox,
  isTableOverflowing,
} from "../../../../UI/Components/Table/useTableScrollState";

/*
 * Whether a table's rows are wider than its card (they scroll sideways and
 * the Actions column sticks at the right edge), and whether its header row
 * can stick under the page's top bar (Common/UI/Components/Table/
 * useTableScrollState.ts). jsdom lays nothing out, so the widths are handed
 * to the elements here; the Chromium half is the ModelTables offline suite.
 */

type SetWidthFunction = (element: Element, width: number) => void;

const setWidth: SetWidthFunction = (element: Element, width: number): void => {
  (element as HTMLElement).getBoundingClientRect = (): DOMRect => {
    return {
      width: width,
      height: 40,
      top: 0,
      left: 0,
      right: width,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: (): unknown => {
        return {};
      },
    } as DOMRect;
  };
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("isTableOverflowing", () => {
  const CASES: Array<[string, number, number, boolean]> = [
    ["as wide as its box", 1200, 1200, false],
    ["narrower (min-w-full stretches it)", 800, 1200, false],
    ["wider", 1986, 1214, true],
    ["a pixel wider", 1215, 1214, true],
    ["a fraction of a pixel wider (sub-pixel layout)", 1214.6, 1214.2, false],
    ["no box yet", 900, 0, false],
    ["no table yet", 0, 1200, false],
  ];

  test.each(CASES)(
    "%s",
    (
      _label: string,
      tableWidth: number,
      boxWidth: number,
      expected: boolean,
    ) => {
      expect(isTableOverflowing({ tableWidth, boxWidth })).toBe(expected);
    },
  );
});

describe("isInsideScrollingBox", () => {
  type NestFunction = (
    styles: Array<Partial<CSSStyleDeclaration>>,
  ) => HTMLElement;

  // The innermost element of a chain of boxes, outermost first.
  const nest: NestFunction = (
    styles: Array<Partial<CSSStyleDeclaration>>,
  ): HTMLElement => {
    let parent: HTMLElement = document.body;

    for (const style of styles) {
      const box: HTMLDivElement = document.createElement("div");
      Object.assign(box.style, style);
      parent.appendChild(box);
      parent = box;
    }

    return parent;
  };

  test("a table on the page: nothing scrolls between it and the page", () => {
    expect(isInsideScrollingBox(nest([{}, {}, {}]))).toBe(false);
  });

  const SCROLLERS: Array<[string, Partial<CSSStyleDeclaration>]> = [
    ["a dialog's scrolling body", { overflowY: "auto" }],
    ["a side panel", { overflow: "scroll" }],
    ["a box that hides its overflow", { overflow: "hidden" }],
    ["a box that scrolls sideways", { overflowX: "auto" }],
  ];

  test.each(SCROLLERS)(
    "inside %s",
    (_label: string, style: Partial<CSSStyleDeclaration>) => {
      expect(isInsideScrollingBox(nest([{}, style, {}]))).toBe(true);
    },
  );

  test("the table's own box counts too", () => {
    expect(isInsideScrollingBox(nest([{}, { overflowX: "auto" }]))).toBe(true);
  });

  test("a box that clips without scrolling (overflow: clip) leaves the header free to stick", () => {
    expect(isInsideScrollingBox(nest([{ overflow: "clip" }, {}]))).toBe(false);
  });

  test("no element", () => {
    expect(isInsideScrollingBox(null)).toBe(false);
  });
});

interface ProbeProps {
  tableWidth: number;
  boxWidth: number;
  boxStyle?: React.CSSProperties | undefined;
  // False draws no table in the box, as a phone draws its rows as cards.
  hasTable?: boolean | undefined;
  onState: (state: TableScrollState) => void;
}

/*
 * A box and a table whose widths are set before the hook measures them
 * (ref callbacks run before layout effects).
 */
function Probe(props: ProbeProps): ReactElement {
  const scrollRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const tableRef: React.MutableRefObject<HTMLTableElement | null> =
    useRef<HTMLTableElement | null>(null);

  const hasTable: boolean = props.hasTable !== false;

  const state: TableScrollState = useTableScrollState({
    scrollRef: scrollRef as React.RefObject<HTMLElement>,
    tableRef: tableRef as React.RefObject<HTMLElement>,
    watch: [props.tableWidth, props.boxWidth, hasTable],
  });

  props.onState(state);

  return (
    <div
      data-testid="box"
      style={props.boxStyle}
      ref={(element: HTMLDivElement | null) => {
        scrollRef.current = element;
        if (element) {
          setWidth(element, props.boxWidth);
        }
      }}
    >
      {hasTable ? (
        <table
          ref={(element: HTMLTableElement | null) => {
            tableRef.current = element;
            if (element) {
              setWidth(element, props.tableWidth);
            }
          }}
        >
          <tbody>
            <tr>
              <td>{state.isOverflowing ? "overflowing" : "fits"}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div>{state.isOverflowing ? "overflowing" : "fits"}</div>
      )}
    </div>
  );
}

describe("useTableScrollState", () => {
  test("a table that fits: no sideways scroll, and the header can stick", () => {
    const states: Array<TableScrollState> = [];

    render(
      <Probe
        tableWidth={1200}
        boxWidth={1200}
        onState={(state: TableScrollState) => {
          states.push(state);
        }}
      />,
    );

    expect(states[states.length - 1]).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
    expect(screen.getByText("fits")).toBeInTheDocument();
  });

  test("a table wider than its card scrolls sideways, and its header does not stick", () => {
    const states: Array<TableScrollState> = [];

    render(
      <Probe
        tableWidth={1986}
        boxWidth={1214}
        onState={(state: TableScrollState) => {
          states.push(state);
        }}
      />,
    );

    expect(states[states.length - 1]).toEqual({
      isOverflowing: true,
      canStickHeader: false,
    });
    expect(screen.getByText("overflowing")).toBeInTheDocument();
  });

  test("a table that fits inside a scrolling box (a dialog) does not stick its header", () => {
    const states: Array<TableScrollState> = [];

    render(
      <div style={{ overflowY: "auto" }}>
        <Probe
          tableWidth={600}
          boxWidth={600}
          onState={(state: TableScrollState) => {
            states.push(state);
          }}
        />
      </div>,
    );

    expect(states[states.length - 1]).toEqual({
      isOverflowing: false,
      canStickHeader: false,
    });
  });

  test("a table that scrolled sideways and fits again sticks its header again: its own box's sideways scroll is the hook's, not a scrolling box around it", () => {
    const states: Array<TableScrollState> = [];

    /*
     * The box still has the overflow-x-auto Table gave it while the rows
     * overflowed, when the wider window is measured.
     */
    render(
      <Probe
        tableWidth={1100}
        boxWidth={1200}
        boxStyle={{ overflowX: "auto" }}
        onState={(state: TableScrollState) => {
          states.push(state);
        }}
      />,
    );

    expect(states[states.length - 1]).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
  });

  test("on a phone, with no table drawn, nothing scrolls sideways - a reading the desktop rows left is not kept", () => {
    const states: Array<TableScrollState> = [];
    const onState: (state: TableScrollState) => void = (
      state: TableScrollState,
    ): void => {
      states.push(state);
    };

    const { rerender } = render(
      <Probe tableWidth={1986} boxWidth={1214} onState={onState} />,
    );

    expect(states[states.length - 1]?.isOverflowing).toBe(true);

    // The window narrows to a phone's: the rows are drawn as cards.
    rerender(
      <Probe
        tableWidth={1986}
        boxWidth={340}
        hasTable={false}
        onState={onState}
      />,
    );

    expect(states[states.length - 1]?.isOverflowing).toBe(false);
    expect(screen.getByText("fits")).toBeInTheDocument();
  });

  test("measures again when the window changes size (where ResizeObserver is missing, as in jsdom)", () => {
    const states: Array<TableScrollState> = [];

    render(
      <Probe
        tableWidth={1000}
        boxWidth={1200}
        onState={(state: TableScrollState) => {
          states.push(state);
        }}
      />,
    );

    expect(states[states.length - 1]?.isOverflowing).toBe(false);

    // The window narrows: the card does too, under the table's width.
    setWidth(screen.getByTestId("box"), 900);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(states[states.length - 1]).toEqual({
      isOverflowing: true,
      canStickHeader: false,
    });
  });

  test("a measurement that changes nothing does not draw the table again", () => {
    const onState: Mock<(state: TableScrollState) => void> =
      jest.fn<(state: TableScrollState) => void>();

    render(<Probe tableWidth={1000} boxWidth={1200} onState={onState} />);

    const drawn: number = onState.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(onState.mock.calls.length).toBe(drawn);
  });

  /*
   * A ResizeObserver whose calls the test makes, and animation frames the
   * test runs, in place of the browser's.
   */
  interface FakeBrowser {
    observed: Array<Element>;
    disconnect: Mock<() => void>;
    resize: () => void;
    pendingFrames: () => number;
    runFrames: () => void;
  }

  type WithFakeBrowserFunction = (run: (browser: FakeBrowser) => void) => void;

  const withFakeBrowser: WithFakeBrowserFunction = (
    run: (browser: FakeBrowser) => void,
  ): void => {
    const observed: Array<Element> = [];
    const disconnect: Mock<() => void> = jest.fn<() => void>();
    let onResize: (() => void) | null = null;
    const frames: Map<number, FrameRequestCallback> = new Map();
    let nextFrame: number = 1;

    class FakeResizeObserver {
      public constructor(callback: () => void) {
        onResize = callback;
      }

      public observe(element: Element): void {
        observed.push(element);
      }

      public disconnect(): void {
        disconnect();
      }

      public unobserve(): void {}
    }

    const originalObserver: unknown = (
      window as unknown as { ResizeObserver?: unknown }
    ).ResizeObserver;
    const originalRequest: typeof window.requestAnimationFrame =
      window.requestAnimationFrame;
    const originalCancel: typeof window.cancelAnimationFrame =
      window.cancelAnimationFrame;

    (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      FakeResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      FakeResizeObserver;
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      const id: number = nextFrame++;
      frames.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id: number): void => {
      frames.delete(id);
    };

    try {
      run({
        observed,
        disconnect,
        resize: (): void => {
          act(() => {
            onResize?.();
          });
        },
        pendingFrames: (): number => {
          return frames.size;
        },
        runFrames: (): void => {
          const callbacks: Array<FrameRequestCallback> = Array.from(
            frames.values(),
          );
          frames.clear();
          act(() => {
            for (const callback of callbacks) {
              callback(0);
            }
          });
        },
      });
    } finally {
      (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
        originalObserver;
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        originalObserver;
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
    }
  };

  test("with ResizeObserver, both the box and the table are watched, and let go of on unmount", () => {
    withFakeBrowser((browser: FakeBrowser) => {
      const states: Array<TableScrollState> = [];
      const { unmount } = render(
        <Probe
          tableWidth={1000}
          boxWidth={1200}
          onState={(state: TableScrollState) => {
            states.push(state);
          }}
        />,
      );

      expect(
        browser.observed.map((element: Element): string => {
          return element.tagName;
        }),
      ).toEqual(["DIV", "TABLE"]);

      // The table grows past its card: the observer's call measures again.
      setWidth(browser.observed[1]!, 1500);
      browser.resize();
      browser.runFrames();

      expect(states[states.length - 1]?.isOverflowing).toBe(true);

      unmount();
      expect(browser.disconnect).toHaveBeenCalled();
    });
  });

  test("the observer's call measures on the next frame, never inside the call - a size changed in it is an error on the page", () => {
    withFakeBrowser((browser: FakeBrowser) => {
      const states: Array<TableScrollState> = [];

      render(
        <Probe
          tableWidth={1000}
          boxWidth={1200}
          onState={(state: TableScrollState) => {
            states.push(state);
          }}
        />,
      );

      const table: HTMLElement = browser.observed[1] as HTMLElement;
      const readings: Array<string | null> = [];

      setWidth(table, 1500);
      const read: () => DOMRect = table.getBoundingClientRect;
      table.getBoundingClientRect = (): DOMRect => {
        readings.push("read");
        return read.call(table);
      };

      browser.resize();

      // Nothing read, nothing changed, inside the observer's call.
      expect(readings).toEqual([]);
      expect(states[states.length - 1]?.isOverflowing).toBe(false);
      expect(browser.pendingFrames()).toBe(1);

      browser.runFrames();

      expect(readings.length).toBeGreaterThan(0);
      expect(states[states.length - 1]?.isOverflowing).toBe(true);
    });
  });

  test("calls that come before the frame are measured once", () => {
    withFakeBrowser((browser: FakeBrowser) => {
      render(
        <Probe tableWidth={1000} boxWidth={1200} onState={(): void => {}} />,
      );

      const table: HTMLElement = browser.observed[1] as HTMLElement;
      let reads: number = 0;
      const read: () => DOMRect = table.getBoundingClientRect;
      table.getBoundingClientRect = (): DOMRect => {
        reads++;
        return read.call(table);
      };

      // The box and the table both changed size, and the box again.
      browser.resize();
      browser.resize();
      browser.resize();

      expect(browser.pendingFrames()).toBe(1);

      browser.runFrames();

      // One measurement: the table fits, so it is read once.
      expect(reads).toBe(1);
    });
  });

  test("a frame still waiting when the table goes is called off", () => {
    withFakeBrowser((browser: FakeBrowser) => {
      const { unmount } = render(
        <Probe tableWidth={1000} boxWidth={1200} onState={(): void => {}} />,
      );

      browser.resize();
      expect(browser.pendingFrames()).toBe(1);

      unmount();

      expect(browser.pendingFrames()).toBe(0);
    });
  });
});
