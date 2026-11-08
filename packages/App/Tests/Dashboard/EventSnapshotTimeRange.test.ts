import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import TimeRangeZoomUtil from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomUtil";
import { TimeRangeZoom } from "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  SnapshotCompanionWindow,
  getExplorerZoom,
  getSnapshotCompanionWindow,
  getSnapshotExplorerQuery,
} from "../../FeatureSet/Dashboard/src/Utils/EventSnapshotTimeRange";

/*
 * The time range of a logs, traces or exceptions snapshot (issue #6251):
 * the card on an incident, alert or episode page lists what the monitor's
 * stored query finds over a time range the reader picks, and these are the
 * decisions it makes about it - what the explorer is handed, the zoom the
 * explorer follows, and what the other tabs say they show. They took over
 * from the page-level snapshot zoom (useTelemetrySnapshotZoom), whose
 * promises are held here where they now live: an untouched card hands the
 * explorer exactly the stored query, a zoom reaches the explorer as a
 * window of its own, and the tabs' words name the zoomed part of the
 * snapshot window while that is what they show.
 */

const SNAPSHOT: InBetween<Date> = new InBetween<Date>(
  new Date("2026-09-14T17:45:00.000Z"),
  new Date("2026-09-14T18:00:00.000Z"),
);
const SLICE: InBetween<Date> = new InBetween<Date>(
  new Date("2026-09-14T17:50:00.000Z"),
  new Date("2026-09-14T17:55:00.000Z"),
);
const HOUR_BEFORE: InBetween<Date> = new InBetween<Date>(
  new Date("2026-09-14T17:00:00.000Z"),
  new Date("2026-09-14T18:00:00.000Z"),
);

type StoredQuery = TelemetryQuery["telemetryQuery"];

// A window as the row stores it: serialized, its bounds ISO strings.
function asStored(window: InBetween<Date>): InBetween<Date> {
  return new InBetween<Date>(
    window.startValue.toISOString() as unknown as Date,
    window.endValue.toISOString() as unknown as Date,
  );
}

function storedQuery(field: string, window: InBetween<Date>): StoredQuery {
  return {
    [field]: asStored(window),
    severityText: "Error",
    serviceId: "service-1",
  } as unknown as StoredQuery;
}

function windowIn(query: StoredQuery, field: string): [number, number] {
  const window: InBetween<Date> | null = TelemetryQueryTimeRange.toDateWindow(
    (query as unknown as JSONObject)[field],
  );

  if (!window) {
    throw new Error(`No window in ${field}`);
  }

  return [window.startValue.getTime(), window.endValue.getTime()];
}

function msOf(window: InBetween<Date>): [number, number] {
  return [window.startValue.getTime(), window.endValue.getTime()];
}

const WINDOW_FIELDS: Array<[string, TelemetryType, string]> = [
  ["a Logs snapshot", TelemetryType.Log, "time"],
  ["a Traces snapshot", TelemetryType.Trace, "startTime"],
  ["an Exceptions snapshot", TelemetryType.Exception, "time"],
];

describe("getSnapshotCompanionWindow: what the other tabs say they show", () => {
  test("an untouched card: the snapshot window", () => {
    expect(
      getSnapshotCompanionWindow({
        isTimeChanged: false,
        isZoomed: false,
        isZoomedFromDefault: false,
      }),
    ).toBe("snapshot");
  });

  test("a zoom dragged out of the snapshot window: its zoomed part", () => {
    expect(
      getSnapshotCompanionWindow({
        isTimeChanged: true,
        isZoomed: true,
        isZoomedFromDefault: true,
      }),
    ).toBe("zoomed");
  });

  test("a range the reader picked: the selected time range", () => {
    expect(
      getSnapshotCompanionWindow({
        isTimeChanged: true,
        isZoomed: false,
        isZoomedFromDefault: false,
      }),
    ).toBe("selected");
  });

  test("a zoom into a range the reader picked is the selected time range too: it need not be any part of the snapshot window", () => {
    expect(
      getSnapshotCompanionWindow({
        isTimeChanged: true,
        isZoomed: true,
        isZoomedFromDefault: false,
      }),
    ).toBe("selected");
  });

  test.each([
    [false, false, false, "snapshot"],
    [false, false, true, "snapshot"],
    [false, true, false, "snapshot"],
    [false, true, true, "snapshot"],
    [true, false, false, "selected"],
    [true, false, true, "selected"],
    [true, true, false, "selected"],
    [true, true, true, "zoomed"],
  ])(
    "changed %s, zoomed %s, zoomed from the default %s: %s",
    (
      isTimeChanged: boolean,
      isZoomed: boolean,
      isZoomedFromDefault: boolean,
      expected: string,
    ) => {
      /*
       * Nothing changed is the snapshot window whatever else is said: a
       * card says it shows another range only once the reader moved it.
       */
      const window: SnapshotCompanionWindow = getSnapshotCompanionWindow({
        isTimeChanged,
        isZoomed,
        isZoomedFromDefault,
      });

      expect(window).toBe(expected);
    },
  );
});

describe("getSnapshotExplorerQuery: what the primary explorer lists", () => {
  test.each(WINDOW_FIELDS)(
    "%s on what the monitor saw is handed the stored query itself, not a copy",
    (_name: string, telemetryType: TelemetryType, field: string) => {
      const stored: StoredQuery = storedQuery(field, SNAPSHOT);

      expect(
        getSnapshotExplorerQuery({
          telemetryType: telemetryType,
          storedQuery: stored,
          snapshotWindow: SNAPSHOT,
          window: new InBetween<Date>(
            new Date(SNAPSHOT.startValue.getTime()),
            new Date(SNAPSHOT.endValue.getTime()),
          ),
        }),
      ).toBe(stored);
    },
  );

  test.each(WINDOW_FIELDS)(
    "%s: a stored window whose bounds are ISO strings is still the snapshot window",
    (_name: string, telemetryType: TelemetryType, field: string) => {
      const stored: StoredQuery = storedQuery(field, SNAPSHOT);

      expect(
        getSnapshotExplorerQuery({
          telemetryType: telemetryType,
          storedQuery: stored,
          snapshotWindow: asStored(SNAPSHOT),
          window: SNAPSHOT,
        }),
      ).toBe(stored);
    },
  );

  test.each(WINDOW_FIELDS)(
    "%s on another window carries that window in its own window field, and keeps every filter",
    (_name: string, telemetryType: TelemetryType, field: string) => {
      const stored: StoredQuery = storedQuery(field, SNAPSHOT);
      const storedCopy: string = JSON.stringify(stored);

      for (const window of [SLICE, HOUR_BEFORE]) {
        const shown: StoredQuery = getSnapshotExplorerQuery({
          telemetryType: telemetryType,
          storedQuery: stored,
          snapshotWindow: SNAPSHOT,
          window: window,
        });

        expect(shown).not.toBe(stored);
        expect(windowIn(shown, field)).toEqual(msOf(window));
        // The window itself, real Dates the explorer pins to.
        expect((shown as unknown as JSONObject)[field]).toBe(window);
        expect((shown as unknown as JSONObject)["severityText"]).toBe("Error");
        expect((shown as unknown as JSONObject)["serviceId"]).toBe(
          "service-1",
        );
        expect(Object.keys(shown as unknown as JSONObject).sort()).toEqual(
          Object.keys(stored as unknown as JSONObject).sort(),
        );
      }

      // The stored query is never written to.
      expect(JSON.stringify(stored)).toBe(storedCopy);
    },
  );

  test("a span's window goes in startTime, and a time field it may carry is left alone", () => {
    const stored: StoredQuery = {
      startTime: asStored(SNAPSHOT),
      time: "kept as it was",
    } as unknown as StoredQuery;

    const shown: StoredQuery = getSnapshotExplorerQuery({
      telemetryType: TelemetryType.Trace,
      storedQuery: stored,
      snapshotWindow: SNAPSHOT,
      window: SLICE,
    });

    expect(windowIn(shown, "startTime")).toEqual(msOf(SLICE));
    expect((shown as unknown as JSONObject)["time"]).toBe("kept as it was");
  });

  test("no stored query: nothing to list", () => {
    expect(
      getSnapshotExplorerQuery({
        telemetryType: TelemetryType.Log,
        storedQuery: null,
        snapshotWindow: SNAPSHOT,
        window: SLICE,
      }),
    ).toBeNull();
  });

  test.each([
    ["a metric snapshot", TelemetryType.Metric],
    ["an unknown kind", undefined],
    ["no kind at all", null],
  ])(
    "%s keeps its window elsewhere, if anywhere: the stored query is left as it is",
    (_name: string, telemetryType: TelemetryType | null | undefined) => {
      const stored: StoredQuery = storedQuery("time", SNAPSHOT);

      expect(
        getSnapshotExplorerQuery({
          telemetryType: telemetryType,
          storedQuery: stored,
          snapshotWindow: SNAPSHOT,
          window: SLICE,
        }),
      ).toBe(stored);
    },
  );

  test("with no snapshot window to compare with, the window shown is written in", () => {
    const stored: StoredQuery = storedQuery("time", SNAPSHOT);

    for (const snapshotWindow of [null, undefined]) {
      const shown: StoredQuery = getSnapshotExplorerQuery({
        telemetryType: TelemetryType.Log,
        storedQuery: stored,
        snapshotWindow: snapshotWindow,
        window: SLICE,
      });

      expect(windowIn(shown, "time")).toEqual(msOf(SLICE));
    }
  });

  test("seeded: the stored query whenever the window is the snapshot window, and the window shown in its field otherwise", () => {
    const random: SeededRandom = seededRandom(6251);
    const baseMs: number = new Date("2026-09-14T00:00:00.000Z").getTime();

    for (let draw: number = 0; draw < 500; draw++) {
      const [, telemetryType, field] = WINDOW_FIELDS[random(3)]!;
      const snapshotStartMs: number = baseMs + random(86400) * 1000;
      const snapshot: InBetween<Date> = new InBetween<Date>(
        new Date(snapshotStartMs),
        new Date(snapshotStartMs + (1 + random(7200)) * 1000),
      );
      const isSame: boolean = random(2) === 0;
      const windowStartMs: number = isSame
        ? snapshot.startValue.getTime()
        : snapshotStartMs + (random(7200) - 3600) * 1000;
      const window: InBetween<Date> = isSame
        ? new InBetween<Date>(
            new Date(snapshot.startValue.getTime()),
            new Date(snapshot.endValue.getTime()),
          )
        : new InBetween<Date>(
            new Date(windowStartMs),
            new Date(windowStartMs + (1 + random(7200)) * 1000),
          );
      const stored: StoredQuery = storedQuery(field, snapshot);
      const storedCopy: string = JSON.stringify(stored);

      const shown: StoredQuery = getSnapshotExplorerQuery({
        telemetryType: telemetryType,
        storedQuery: stored,
        snapshotWindow: random(2) === 0 ? snapshot : asStored(snapshot),
        window: window,
      });

      const sameWindow: boolean =
        window.startValue.getTime() === snapshot.startValue.getTime() &&
        window.endValue.getTime() === snapshot.endValue.getTime();

      if (sameWindow) {
        expect(shown).toBe(stored);
      } else {
        expect(windowIn(shown, field)).toEqual(msOf(window));
      }

      // The explorer pins to what it is handed: the window on screen.
      expect(
        TelemetryQueryTimeRange.isSameRange(
          TelemetryQueryTimeRange.getPinnedRangeForQuery(
            shown as unknown as JSONObject,
            telemetryType,
          ),
          { range: TimeRange.CUSTOM, startAndEndDate: window },
        ),
      ).toBe(true);
      expect(JSON.stringify(stored)).toBe(storedCopy);
    }
  });
});

describe("getExplorerZoom: the card's zoom, as the primary explorer is offered it", () => {
  function cardZoom(timeRange: RangeStartAndEndDateTime): TimeRangeZoom {
    return {
      isZoomed: true,
      timeRange: timeRange,
      rangeBeforeZoom: { range: TimeRange.PAST_ONE_HOUR },
      zoomToTimeRange: (): void => {},
      resetZoom: (): void => {},
    };
  }

  test("over the window shown, as a custom range: the very range the explorer is pinned to", () => {
    const zoom: TimeRangeZoom = cardZoom({ range: TimeRange.PAST_ONE_HOUR });
    const offered: TimeRangeZoom = getExplorerZoom(zoom, HOUR_BEFORE);

    expect(offered.timeRange).toEqual({
      range: TimeRange.CUSTOM,
      startAndEndDate: HOUR_BEFORE,
    });

    /*
     * The explorer follows a zoom only while it is over its own window
     * (useViewerTimeRangeZoom): over "Past 1 Hour" it would keep a zoom of
     * its own, and a drag on its chart would leave the other tabs behind.
     */
    const pinned: RangeStartAndEndDateTime | null =
      TelemetryQueryTimeRange.getPinnedRangeForQuery(
        getSnapshotExplorerQuery({
          telemetryType: TelemetryType.Log,
          storedQuery: storedQuery("time", SNAPSHOT),
          snapshotWindow: SNAPSHOT,
          window: HOUR_BEFORE,
        }) as unknown as JSONObject,
        TelemetryType.Log,
      );

    expect(TimeRangeZoomUtil.isSameRange(offered.timeRange, pinned)).toBe(
      true,
    );
    expect(TimeRangeZoomUtil.isSameRange(zoom.timeRange, pinned)).toBe(false);
  });

  test("an untouched card's zoom is over the stored window the explorer reads, ISO strings and all", () => {
    const offered: TimeRangeZoom = getExplorerZoom(
      cardZoom({ range: TimeRange.CUSTOM, startAndEndDate: SNAPSHOT }),
      SNAPSHOT,
    );

    const pinned: RangeStartAndEndDateTime | null =
      TelemetryQueryTimeRange.getPinnedRangeForQuery(
        storedQuery("time", SNAPSHOT) as unknown as JSONObject,
        TelemetryType.Log,
      );

    expect(TimeRangeZoomUtil.isSameRange(offered.timeRange, pinned)).toBe(
      true,
    );
  });

  test("everything else is the card's own: the way back, what it goes back to, the handlers", () => {
    const zoom: TimeRangeZoom = cardZoom({
      range: TimeRange.CUSTOM,
      startAndEndDate: SLICE,
    });
    const offered: TimeRangeZoom = getExplorerZoom(zoom, SLICE);

    expect(offered.isZoomed).toBe(true);
    expect(offered.rangeBeforeZoom).toBe(zoom.rangeBeforeZoom);
    expect(offered.zoomToTimeRange).toBe(zoom.zoomToTimeRange);
    expect(offered.resetZoom).toBe(zoom.resetZoom);
  });

  test("the card's zoom is left as it was", () => {
    const timeRange: RangeStartAndEndDateTime = {
      range: TimeRange.PAST_ONE_HOUR,
    };
    const zoom: TimeRangeZoom = cardZoom(timeRange);

    getExplorerZoom(zoom, HOUR_BEFORE);

    expect(zoom.timeRange).toBe(timeRange);
  });
});
