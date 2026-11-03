import { describe, expect, test } from "@jest/globals";
import {
  PageSelectionState,
  getPageSelectionState,
  isRowSelected,
  keepSelectedOnPage,
  refreshSelectedFromPage,
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

/*
 * A selection of every match (the list's "Select all 4,213 exceptions"):
 * kept whole from page to page, each row the page shows as the page has it
 * now.
 */
describe("refreshSelectedFromPage", () => {
  test("a row the page shows carries the page's state; the rest stay as they were read", () => {
    const resolvedA: Row = { id: "a", state: "resolved" };

    const refreshed: Array<Row> = refreshSelectedFromPage(
      [A, B, C],
      [resolvedA, { id: "d", state: "open" }],
      idOf,
    );

    expect(refreshed).toEqual([resolvedA, B, C]);
    expect(refreshed[0]).toBe(resolvedA);
    expect(refreshed[1]).toBe(B);
  });

  test("nothing leaves it, not even a row no page shows any more", () => {
    expect(refreshSelectedFromPage([A, B, C], [], idOf)).toEqual([A, B, C]);
  });

  test("a row the page shows that was never selected is not added", () => {
    const D: Row = { id: "d", state: "open" };

    expect(refreshSelectedFromPage([A], [A, D], idOf)).toEqual([A]);
  });

  test("keeps its own order, not the page's", () => {
    expect(
      refreshSelectedFromPage([C, A, B], [B, A, C], idOf).map(idOf),
    ).toEqual(["c", "a", "b"]);
  });

  test("hands back the same array when the page changed nothing, so an idle list renders once", () => {
    const selected: Array<Row> = [A, B];

    expect(refreshSelectedFromPage(selected, [A, B], idOf)).toBe(selected);
    expect(refreshSelectedFromPage(selected, [C], idOf)).toBe(selected);
    expect(
      refreshSelectedFromPage(selected, [{ id: "a", state: "open" }], idOf),
    ).not.toBe(selected);
  });
});
