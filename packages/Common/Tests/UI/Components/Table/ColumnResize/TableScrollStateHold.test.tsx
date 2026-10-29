import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import React, { ReactElement, useRef } from "react";
import useTableScrollState, {
  TableScrollState,
  TableScrollStateHold,
} from "../../../../../UI/Components/Table/useTableScrollState";

/*
 * While a person drags a column's edge the table's width changes every
 * frame, and reading it each time - every name set free and back, every
 * value cut short and whole, four times over - would lay a long table out
 * four times a frame. The readings wait while the table holds them
 * (TableScrollStateHold), and run once the edge is let go, through what
 * remeasureRef holds.
 *
 * jsdom has no ResizeObserver, so the hook reads the table again on the
 * window's resize: a resize while held reads nothing.
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

interface Harness {
  state: () => TableScrollState;
  hold: TableScrollStateHold;
  table: HTMLElement;
  box: HTMLElement;
}

const renderHarness: () => Harness = (): Harness => {
  let latest: TableScrollState | null = null;
  const hold: TableScrollStateHold = {
    isHeldRef: { current: false },
    remeasureRef: { current: null },
  };

  const Probe: () => ReactElement = (): ReactElement => {
    const boxRef: React.RefObject<HTMLDivElement> =
      useRef<HTMLDivElement>(null);
    const tableRef: React.RefObject<HTMLTableElement> =
      useRef<HTMLTableElement>(null);

    latest = useTableScrollState({
      scrollRef: boxRef,
      tableRef: tableRef,
      watch: [],
      hold: hold,
    });

    return (
      <div ref={boxRef} data-testid="box">
        <table ref={tableRef} data-testid="table">
          <tbody>
            <tr>
              <td>Row</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  render(<Probe />);

  return {
    state: (): TableScrollState => {
      return latest as unknown as TableScrollState;
    },
    hold: hold,
    table: document.querySelector('[data-testid="table"]') as HTMLElement,
    box: document.querySelector('[data-testid="box"]') as HTMLElement,
  };
};

describe("a table's readings while one of its columns is sized", () => {
  test("the hook hands the table its reading, to run once an edge is let go", () => {
    const harness: Harness = renderHarness();

    expect(typeof harness.hold.remeasureRef.current).toBe("function");
  });

  test("a resize while held reads nothing; the reading the table runs when it is let go does", () => {
    const harness: Harness = renderHarness();

    expect(harness.state().isOverflowing).toBe(false);

    setWidth(harness.box, 900);
    setWidth(harness.table, 1400);
    harness.hold.isHeldRef.current = true;

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    // Held: the rows' width was not read.
    expect(harness.state().isOverflowing).toBe(false);

    harness.hold.isHeldRef.current = false;

    act(() => {
      harness.hold.remeasureRef.current?.();
    });

    expect(harness.state().isOverflowing).toBe(true);
    expect(harness.state().canStickHeader).toBe(false);
  });

  test("not held, a resize reads the table as it always did", () => {
    const harness: Harness = renderHarness();

    setWidth(harness.box, 900);
    setWidth(harness.table, 1400);

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(harness.state().isOverflowing).toBe(true);
  });

  test("a table that goes away takes its reading with it", () => {
    const harness: Harness = renderHarness();

    cleanup();

    expect(harness.hold.remeasureRef.current).toBeNull();
  });
});
