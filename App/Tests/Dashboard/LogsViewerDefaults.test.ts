import {
  buildClearedLogsViewState,
  ClearedLogsViewState,
} from "../../FeatureSet/Dashboard/src/Components/Logs/LogsViewerDefaults";
import Log from "Common/Models/AnalyticsModels/Log";
import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import TimeRange from "Common/Types/Time/TimeRange";
import { DEFAULT_LOGS_TABLE_COLUMNS } from "Common/UI/Components/LogsViewer/types";
import { describe, expect, test } from "@jest/globals";

/*
 * Deselecting a saved log view has to undo everything applying one did.
 * Applying writes the window, the facet chips, the page, the page size, the
 * sort and the column selection all at once, so a clear that forgets any one
 * of them leaves the explorer still wearing the view — which is exactly the
 * complaint in issue 3189, one field at a time.
 *
 * The host scope is the one thing that must NOT be cleared: it comes from the
 * page the viewer is embedded in (a service, a trace, a replay session), not
 * from the saved view, and dropping it would widen the query to the whole
 * project.
 */

const ONE_HOUR_IN_MS: number = 60 * 60 * 1000;
// Generous: only rules out a window anchored to a different hour entirely.
const CLOCK_TOLERANCE_IN_MS: number = 60 * 1000;

function scopedQuery(): Query<Log> {
  return {
    primaryEntityId: new Includes(["6512f1a0a1b2c3d4e5f60718"]),
    traceId: new Includes(["b1c2d3"]),
  } as unknown as Query<Log>;
}

function clearedWith(baseQuery: Query<Log>): ClearedLogsViewState {
  return buildClearedLogsViewState({
    baseQuery: baseQuery,
    defaultPageSize: 100,
  });
}

describe("buildClearedLogsViewState — the time selection", () => {
  test("lands on the rolling default hour, not a frozen custom window", () => {
    const cleared: ClearedLogsViewState = clearedWith({});

    expect(cleared.timeRange.range).toBe(TimeRange.PAST_ONE_HOUR);
    /*
     * A Custom range would pin the explorer to whatever hour it happened to
     * be when the view was cleared — the same staleness saved views had
     * before the selection got its own column.
     */
    expect(cleared.timeRange.startAndEndDate).toBeUndefined();
  });

  test("stamps a freshly resolved window on the query", () => {
    const before: number = Date.now();
    const cleared: ClearedLogsViewState = clearedWith({});
    const after: number = Date.now();

    const time: InBetween<Date> = (
      cleared.filterOptions as unknown as Record<string, InBetween<Date>>
    )["time"]!;

    expect(time).toBeInstanceOf(InBetween);

    const startTime: number = new Date(time.startValue).getTime();
    const endTime: number = new Date(time.endValue).getTime();

    expect(endTime - startTime).toBeCloseTo(ONE_HOUR_IN_MS, -4);
    expect(endTime).toBeGreaterThanOrEqual(before - CLOCK_TOLERANCE_IN_MS);
    expect(endTime).toBeLessThanOrEqual(after + CLOCK_TOLERANCE_IN_MS);
  });

  test("keeps the window the embedding page pinned", () => {
    /*
     * An incident page pins the hour its incident is about. That window came
     * from the page, not from the saved view, so clearing the view must not
     * drag the reader off the moment they were sent to look at — the same
     * reason the default saved view is never auto-applied for those hosts.
     */
    const pinnedStart: Date = new Date("2026-02-01T09:00:00.000Z");
    const pinnedEnd: Date = new Date("2026-02-01T10:00:00.000Z");

    const cleared: ClearedLogsViewState = buildClearedLogsViewState({
      baseQuery: {},
      defaultPageSize: 100,
      hostTimeRange: {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(pinnedStart, pinnedEnd),
      },
    });

    expect(cleared.timeRange.range).toBe(TimeRange.CUSTOM);

    const time: InBetween<Date> = (
      cleared.filterOptions as unknown as Record<string, InBetween<Date>>
    )["time"]!;

    expect(new Date(time.startValue).getTime()).toBe(pinnedStart.getTime());
    expect(new Date(time.endValue).getTime()).toBe(pinnedEnd.getTime());
  });

  test("a host that pins nothing still gets the rolling default", () => {
    for (const hostTimeRange of [undefined, null]) {
      const cleared: ClearedLogsViewState = buildClearedLogsViewState({
        baseQuery: {},
        defaultPageSize: 100,
        hostTimeRange: hostTimeRange,
      });

      expect(cleared.timeRange.range).toBe(TimeRange.PAST_ONE_HOUR);
    }
  });

  test("a rolling window the host controls is re-resolved, not frozen", () => {
    // The entity hub drives a relative cursor; it must stay relative.
    const cleared: ClearedLogsViewState = buildClearedLogsViewState({
      baseQuery: {},
      defaultPageSize: 100,
      hostTimeRange: { range: TimeRange.PAST_ONE_DAY },
    });

    const time: InBetween<Date> = (
      cleared.filterOptions as unknown as Record<string, InBetween<Date>>
    )["time"]!;

    expect(cleared.timeRange.range).toBe(TimeRange.PAST_ONE_DAY);
    expect(
      new Date(time.endValue).getTime() - new Date(time.startValue).getTime(),
    ).toBeCloseTo(24 * ONE_HOUR_IN_MS, -5);
  });

  test("re-resolves the window on every call rather than reusing one", () => {
    const first: ClearedLogsViewState = clearedWith({});
    const second: ClearedLogsViewState = clearedWith({});

    const firstTime: InBetween<Date> = (
      first.filterOptions as unknown as Record<string, InBetween<Date>>
    )["time"]!;
    const secondTime: InBetween<Date> = (
      second.filterOptions as unknown as Record<string, InBetween<Date>>
    )["time"]!;

    // Distinct objects, so mutating one explorer's window cannot touch another.
    expect(secondTime).not.toBe(firstTime);
  });
});

describe("buildClearedLogsViewState — the query", () => {
  test("keeps the host scope the embedding page imposes", () => {
    const cleared: ClearedLogsViewState = clearedWith(scopedQuery());
    const query: Record<string, unknown> =
      cleared.filterOptions as unknown as Record<string, unknown>;

    expect(query["primaryEntityId"]).toBeInstanceOf(Includes);
    expect((query["primaryEntityId"] as Includes).values).toEqual([
      "6512f1a0a1b2c3d4e5f60718",
    ]);
    expect((query["traceId"] as Includes).values).toEqual(["b1c2d3"]);
  });

  test("carries nothing but the scope and the window", () => {
    const cleared: ClearedLogsViewState = clearedWith(scopedQuery());

    /*
     * Any extra key here would be a predicate the saved view contributed and
     * clearing failed to drop — severityText, a body search, a facet chip.
     */
    expect(Object.keys(cleared.filterOptions).sort()).toEqual([
      "primaryEntityId",
      "time",
      "traceId",
    ]);
  });

  test("an unscoped explorer clears down to the window alone", () => {
    const cleared: ClearedLogsViewState = clearedWith({});

    expect(Object.keys(cleared.filterOptions)).toEqual(["time"]);
  });

  test("does not mutate the base query it was handed", () => {
    const baseQuery: Query<Log> = scopedQuery();

    clearedWith(baseQuery);

    expect(
      (baseQuery as unknown as Record<string, unknown>)["time"],
    ).toBeUndefined();
  });

  test("a base query that already carries a window has it replaced", () => {
    const staleStart: Date = new Date("2020-03-01T10:00:00.000Z");
    const staleEnd: Date = new Date("2020-03-01T11:00:00.000Z");

    const cleared: ClearedLogsViewState = clearedWith({
      time: new InBetween<Date>(staleStart, staleEnd),
    } as unknown as Query<Log>);

    const time: InBetween<Date> = (
      cleared.filterOptions as unknown as Record<string, InBetween<Date>>
    )["time"]!;

    expect(new Date(time.startValue).getTime()).not.toBe(staleStart.getTime());
  });
});

describe("buildClearedLogsViewState — the rest of the explorer", () => {
  test("drops every facet chip", () => {
    const cleared: ClearedLogsViewState = clearedWith({});

    expect(cleared.facetFilters.size).toBe(0);
  });

  test("hands out a fresh chip map each time", () => {
    /*
     * The viewer mutates copies of this map as the user clicks facets. A
     * shared instance would leak one explorer's chips into the next clear.
     */
    const first: ClearedLogsViewState = clearedWith({});
    const second: ClearedLogsViewState = clearedWith({});

    first.facetFilters.set("severityText", new Set(["Error"]));

    expect(second.facetFilters.size).toBe(0);
  });

  test("returns to the first page", () => {
    const cleared: ClearedLogsViewState = clearedWith({});

    expect(cleared.page).toBe(1);
  });

  test("takes the page size the host considers default", () => {
    // props.limit wins over the viewer's own default when the host sets one.
    expect(
      buildClearedLogsViewState({ baseQuery: {}, defaultPageSize: 25 })
        .pageSize,
    ).toBe(25);
    expect(
      buildClearedLogsViewState({ baseQuery: {}, defaultPageSize: 100 })
        .pageSize,
    ).toBe(100);
  });

  test("restores newest-first ordering by time", () => {
    const cleared: ClearedLogsViewState = clearedWith({});

    expect(cleared.sortField).toBe("time");
    expect(cleared.sortOrder).toBe(SortOrder.Descending);
  });

  test("restores the default column selection", () => {
    const cleared: ClearedLogsViewState = clearedWith({});

    expect(cleared.columns).toEqual(DEFAULT_LOGS_TABLE_COLUMNS);
  });

  test("the returned columns are a copy of the shared default", () => {
    /*
     * The viewer pushes the cleared columns straight into state and then into
     * localStorage. Handing back the module-level array would let a later
     * column edit rewrite the defaults for the whole app.
     */
    const cleared: ClearedLogsViewState = clearedWith({});

    expect(cleared.columns).not.toBe(DEFAULT_LOGS_TABLE_COLUMNS);

    cleared.columns.push("traceId");

    expect(DEFAULT_LOGS_TABLE_COLUMNS).not.toContain("traceId");
  });
});
