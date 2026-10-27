import { describe, expect, test } from "@jest/globals";
import {
  PageSelectionState,
  getPageSelectionState,
  isRowSelected,
  keepSelectedOnPage,
  setRowSelected,
} from "../../../../UI/Components/TelemetryViewer/TelemetryViewerSelection";

/*
 * WHICH OF A TELEMETRY LIST'S ROWS ARE TICKED (TelemetryViewerSelection),
 * for the list's Bulk Actions: kept by each row's id, so a row read again
 * stays ticked with its new state, and kept to the page, so a selection is
 * never wider than what the person sees.
 */

interface Row {
  id: string;
  state: string;
}

const idOf: (row: Row) => string = (row: Row): string => {
  return row.id;
};

const A: Row = { id: "a", state: "open" };
const B: Row = { id: "b", state: "open" };
const C: Row = { id: "c", state: "open" };

describe("isRowSelected", () => {
  test("by the row's id, not the object", () => {
    expect(isRowSelected([A], { id: "a", state: "resolved" }, idOf)).toBe(true);
    expect(isRowSelected([A], B, idOf)).toBe(false);
    expect(isRowSelected([], A, idOf)).toBe(false);
  });
});

describe("setRowSelected", () => {
  test("ticking adds the row once, clearing takes it out", () => {
    const once: Array<Row> = setRowSelected([A], B, true, idOf);
    expect(once).toEqual([A, B]);

    // Ticked again (a double event): still once.
    expect(setRowSelected(once, B, true, idOf)).toEqual([A, B]);

    expect(setRowSelected(once, A, false, idOf)).toEqual([B]);
    // Clearing a row that is not ticked changes nothing.
    expect(setRowSelected(once, C, false, idOf)).toEqual([A, B]);
  });

  test("never changes the selection it is handed", () => {
    const selected: Array<Row> = [A];
    setRowSelected(selected, B, true, idOf);

    expect(selected).toEqual([A]);
  });
});

describe("keepSelectedOnPage", () => {
  test("a row read again keeps its tick and carries its new state", () => {
    const resolvedA: Row = { id: "a", state: "resolved" };

    expect(keepSelectedOnPage([A, B], [resolvedA, B, C], idOf)).toEqual([
      resolvedA,
      B,
    ]);
  });

  test("a row that left the page leaves the selection", () => {
    expect(keepSelectedOnPage([A, B], [B, C], idOf)).toEqual([B]);
    expect(keepSelectedOnPage([A, B], [], idOf)).toEqual([]);
  });

  test("in the page's order, whatever order the rows were ticked in", () => {
    expect(keepSelectedOnPage([C, A], [A, B, C], idOf)).toEqual([A, C]);
  });
});

describe("getPageSelectionState", () => {
  test("none, some or all of the page's rows", () => {
    expect(getPageSelectionState([], [A, B], idOf)).toBe(
      PageSelectionState.None,
    );
    expect(getPageSelectionState([A], [A, B], idOf)).toBe(
      PageSelectionState.Some,
    );
    expect(getPageSelectionState([B, A], [A, B], idOf)).toBe(
      PageSelectionState.All,
    );
  });

  test("an empty page is never all selected, and rows off the page do not count", () => {
    expect(getPageSelectionState([A], [], idOf)).toBe(PageSelectionState.None);
    expect(getPageSelectionState([C], [A, B], idOf)).toBe(
      PageSelectionState.None,
    );
    expect(getPageSelectionState([A, C], [A, B], idOf)).toBe(
      PageSelectionState.Some,
    );
  });
});
