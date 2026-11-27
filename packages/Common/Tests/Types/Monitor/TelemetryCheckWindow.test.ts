import { describe, expect, test } from "@jest/globals";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Query from "../../../Types/BaseDatabase/Query";
import OneUptimeDate from "../../../Types/Date";
import JSONFunctions from "../../../Types/JSONFunctions";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import { MonitorStepExceptionMonitorUtil } from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import { MonitorStepLlmMonitorUtil } from "../../../Types/Monitor/MonitorStepLlmMonitor";
import { MonitorStepLogMonitorUtil } from "../../../Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepProfileMonitorUtil } from "../../../Types/Monitor/MonitorStepProfileMonitor";
import { MonitorStepSecurityEventsMonitorUtil } from "../../../Types/Monitor/MonitorStepSecurityEventsMonitor";
import { MonitorStepTraceMonitorUtil } from "../../../Types/Monitor/MonitorStepTraceMonitor";
import TelemetryCheckWindow from "../../../Types/Monitor/TelemetryCheckWindow";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";

/*
 * THE WINDOW EVERY TELEMETRY CHECK JUDGES HOLDS ITS START AND NOT ITS END
 * (issue #11334).
 *
 * A monitor's windows follow on (#11248): each starts where the one before
 * ended. With both ends held, a record stamped exactly on that instant was in
 * two windows, and counted by two checks. Every check's window now comes
 * from TelemetryCheckWindow, from its start, included, up to its end, not
 * included, and keeps saying so through JSON (an incident's saved query, a
 * preview's request), so every reader leaves the end out the same way.
 */

const DUE_AT: Date = new Date("2026-11-27T10:01:07.000Z");

// What a query reads of a range, as the builders write it: from the start, up to or through the end.
function isIn(range: InBetween<Date>, at: Date): boolean {
  const atMs: number = at.getTime();
  const startMs: number = new Date(range.startValue).getTime();
  const endMs: number = new Date(range.endValue).getTime();

  return atMs >= startMs && (range.includesEnd ? atMs <= endMs : atMs < endMs);
}

function expectCheckWindow(range: unknown, startsAt: Date, endsAt: Date): void {
  expect(range).toBeInstanceOf(InBetween);

  const window: InBetween<Date> = range as InBetween<Date>;

  expect(window.includesEnd).toBe(false);
  expect(new Date(window.startValue).toISOString()).toBe(
    startsAt.toISOString(),
  );
  expect(new Date(window.endValue).toISOString()).toBe(endsAt.toISOString());
}

describe("InBetween: a range holds both its ends unless it says otherwise", () => {
  test("a range a person filters by holds both ends, as every range did", () => {
    const range: InBetween<Date> = new InBetween<Date>(
      new Date("2026-11-27T10:00:07.000Z"),
      DUE_AT,
    );

    expect(range.includesEnd).toBe(true);
    expect(isIn(range, DUE_AT)).toBe(true);
  });

  test("its JSON is what it always was: no includesEnd field", () => {
    const json: JSONObject = new InBetween<number>(1, 5).toJSON();

    expect(json).toEqual({
      _type: ObjectType.InBetween,
      startValue: 1,
      endValue: 5,
    });
    expect(Object.keys(json)).not.toContain("includesEnd");
  });

  test("a range saved before the field existed reads as holding both ends", () => {
    const range: InBetween<number> = InBetween.fromJSON<number>({
      _type: ObjectType.InBetween,
      startValue: 1,
      endValue: 5,
    });

    expect(range.includesEnd).toBe(true);
    expect(range.startValue).toBe(1);
    expect(range.endValue).toBe(5);
  });

  test("includesEnd: true, or anything but false, holds both ends", () => {
    expect(new InBetween<number>(1, 5, { includesEnd: true }).includesEnd).toBe(
      true,
    );
    expect(new InBetween<number>(1, 5, {}).includesEnd).toBe(true);
    expect(
      new InBetween<number>(1, 5, { includesEnd: undefined }).includesEnd,
    ).toBe(true);
    expect(
      InBetween.fromJSON<number>({
        _type: ObjectType.InBetween,
        startValue: 1,
        endValue: 5,
        includesEnd: true,
      }).includesEnd,
    ).toBe(true);
    expect(
      InBetween.fromJSON<number>({
        _type: ObjectType.InBetween,
        startValue: 1,
        endValue: 5,
        includesEnd: "false",
      }).includesEnd,
    ).toBe(true);
  });

  test("a range that leaves out its end says so in its JSON, and reads back the same", () => {
    const range: InBetween<number> = new InBetween<number>(1, 5, {
      includesEnd: false,
    });
    const json: JSONObject = range.toJSON();

    expect(json).toEqual({
      _type: ObjectType.InBetween,
      startValue: 1,
      endValue: 5,
      includesEnd: false,
    });

    const back: InBetween<number> = InBetween.fromJSON<number>(json);

    expect(back.includesEnd).toBe(false);
    expect(back.startValue).toBe(1);
    expect(back.endValue).toBe(5);
  });

  test("JSON that is not a range is refused, as before", () => {
    expect(() => {
      return InBetween.fromJSON({ _type: ObjectType.Includes, values: [] });
    }).toThrow();
  });
});

describe("TelemetryCheckWindow", () => {
  test("the last so many seconds up to when the check was due, its end left out", () => {
    const window: InBetween<Date> = TelemetryCheckWindow.ofSeconds(60, DUE_AT);

    expectCheckWindow(window, new Date("2026-11-27T10:00:07.000Z"), DUE_AT);
  });

  test("keeps a due time's milliseconds, and reads a fractional length to the millisecond", () => {
    const dueAt: Date = new Date("2026-11-27T10:01:07.123Z");

    expectCheckWindow(
      TelemetryCheckWindow.ofSeconds(60, dueAt),
      new Date("2026-11-27T10:00:07.123Z"),
      dueAt,
    );
    expectCheckWindow(
      TelemetryCheckWindow.ofSeconds(1.5, dueAt),
      new Date("2026-11-27T10:01:05.623Z"),
      dueAt,
    );
  });

  test("starts exactly where the window builders always started it", () => {
    for (const seconds of [1, 30, 60, 300, 900, 3600, 86400]) {
      const window: InBetween<Date> = TelemetryCheckWindow.ofSeconds(
        seconds,
        DUE_AT,
      );

      expect(window.startValue.getTime()).toBe(
        OneUptimeDate.addRemoveSeconds(DUE_AT, -seconds).getTime(),
      );
    }
  });

  test("with no end given, the window ends now", () => {
    const before: number = Date.now();
    const window: InBetween<Date> = TelemetryCheckWindow.ofSeconds(60);
    const after: number = Date.now();

    expect(window.includesEnd).toBe(false);
    expect(window.endValue.getTime()).toBeGreaterThanOrEqual(before);
    expect(window.endValue.getTime()).toBeLessThanOrEqual(after);
    expect(window.endValue.getTime() - window.startValue.getTime()).toBe(60000);
  });

  test("a rolling time's window starts where RollingTimeUtil starts it, for every rolling time", () => {
    for (const rollingTime of Object.values(RollingTime)) {
      const window: InBetween<Date> = TelemetryCheckWindow.ofRollingTime(
        rollingTime as RollingTime,
        DUE_AT,
      );
      const range: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
        rollingTime as RollingTime,
        DUE_AT,
      );

      expectCheckWindow(window, range.startValue, range.endValue);
      expect(range.includesEnd).toBe(true);
    }
  });

  test("an unreadable rolling time covers the default's window, never one of no length", () => {
    const window: InBetween<Date> = TelemetryCheckWindow.ofRollingTime(
      "not a rolling time" as RollingTime,
      DUE_AT,
    );

    expect(window.includesEnd).toBe(false);
    expect(window.endValue.getTime() - window.startValue.getTime()).toBe(
      RollingTimeUtil.getWindowInMs("not a rolling time" as RollingTime),
    );
    expect(window.endValue.getTime()).toBeGreaterThan(
      window.startValue.getTime(),
    );
  });

  test("a rolling time with no end given ends now", () => {
    const before: number = Date.now();
    const window: InBetween<Date> = TelemetryCheckWindow.ofRollingTime(
      RollingTime.Past5Minutes,
    );
    const after: number = Date.now();

    expect(window.endValue.getTime()).toBeGreaterThanOrEqual(before);
    expect(window.endValue.getTime()).toBeLessThanOrEqual(after);
    expect(window.endValue.getTime() - window.startValue.getTime()).toBe(
      5 * 60 * 1000,
    );
  });

  test("from: the two ends as given, the end left out", () => {
    const start: Date = new Date("2026-11-26T10:01:07.000Z");

    expectCheckWindow(TelemetryCheckWindow.from(start, DUE_AT), start, DUE_AT);
  });

  test("a record stamped where one window ends and the next begins is in exactly one: the later", () => {
    const first: InBetween<Date> = TelemetryCheckWindow.ofSeconds(60, DUE_AT);
    const second: InBetween<Date> = TelemetryCheckWindow.ofSeconds(
      60,
      new Date(DUE_AT.getTime() + 60000),
    );

    expect(second.startValue.getTime()).toBe(first.endValue.getTime());

    const onTheEdge: Date = new Date(DUE_AT.getTime());

    expect(isIn(first, onTheEdge)).toBe(false);
    expect(isIn(second, onTheEdge)).toBe(true);

    // As windows were read before: both.
    const closedFirst: InBetween<Date> = new InBetween<Date>(
      first.startValue,
      first.endValue,
    );
    const closedSecond: InBetween<Date> = new InBetween<Date>(
      second.startValue,
      second.endValue,
    );

    expect(isIn(closedFirst, onTheEdge)).toBe(true);
    expect(isIn(closedSecond, onTheEdge)).toBe(true);
  });

  test("an hour of one-minute windows holds every millisecond exactly once", () => {
    const windows: Array<InBetween<Date>> = [];

    for (let index: number = 1; index <= 60; index++) {
      windows.push(
        TelemetryCheckWindow.ofSeconds(
          60,
          new Date(DUE_AT.getTime() + index * 60000),
        ),
      );
    }

    // Every whole second of the hour, and the edges' neighbours.
    for (
      let atMs: number = DUE_AT.getTime();
      atMs < DUE_AT.getTime() + 60 * 60000;
      atMs += 1000
    ) {
      for (const at of [atMs - 1, atMs, atMs + 1]) {
        if (at < DUE_AT.getTime()) {
          continue;
        }

        const holding: number = windows.filter(
          (window: InBetween<Date>): boolean => {
            return isIn(window, new Date(at));
          },
        ).length;

        expect(holding).toBe(1);
      }
    }
  });

  test("survives JSON as a check's window: an incident's saved query, a preview's request", () => {
    const window: InBetween<Date> = TelemetryCheckWindow.ofSeconds(60, DUE_AT);

    const viaJsonFunctions: InBetween<Date> = JSONFunctions.deserialize(
      JSONFunctions.serialize({ time: window } as unknown as JSONObject),
    )["time"] as unknown as InBetween<Date>;

    expect(viaJsonFunctions).toBeInstanceOf(InBetween);
    expect(viaJsonFunctions.includesEnd).toBe(false);
    expect(new Date(viaJsonFunctions.startValue).toISOString()).toBe(
      "2026-11-27T10:00:07.000Z",
    );
    expect(new Date(viaJsonFunctions.endValue).toISOString()).toBe(
      DUE_AT.toISOString(),
    );

    const viaText: InBetween<Date> = JSONFunctions.deserialize(
      JSON.parse(
        JSON.stringify(
          JSONFunctions.anyObjectToJSONObject({
            time: window,
          } as unknown as JSONObject),
        ),
      ) as JSONObject,
    )["time"] as unknown as InBetween<Date>;

    expect(viaText).toBeInstanceOf(InBetween);
    expect(viaText.includesEnd).toBe(false);
  });
});

describe("every telemetry step's window holds its start and not its end", () => {
  const MINUTE_BEFORE: Date = new Date("2026-11-27T10:00:07.000Z");

  test("Logs", () => {
    const query: Query<{ time: Date }> = MonitorStepLogMonitorUtil.toQuery(
      { ...MonitorStepLogMonitorUtil.getDefault(), lastXSecondsOfLogs: 60 },
      DUE_AT,
    ) as unknown as Query<{ time: Date }>;

    expectCheckWindow(query.time, MINUTE_BEFORE, DUE_AT);
  });

  test("Logs: the logs that resolve a group, over the same window", () => {
    const query: Query<{ time: Date }> =
      MonitorStepLogMonitorUtil.toResolvedByQuery(
        {
          ...MonitorStepLogMonitorUtil.getDefault(),
          lastXSecondsOfLogs: 60,
          groupByAttributes: ["interface"],
          resolvedByAttributes: { "event.name": "interface.up" },
        },
        DUE_AT,
      ) as unknown as Query<{ time: Date }>;

    expectCheckWindow(query.time, MINUTE_BEFORE, DUE_AT);
  });

  test("Traces", () => {
    const query: Query<{ startTime: Date }> =
      MonitorStepTraceMonitorUtil.toQuery(
        {
          ...MonitorStepTraceMonitorUtil.getDefault(),
          lastXSecondsOfSpans: 60,
        },
        DUE_AT,
      ) as unknown as Query<{ startTime: Date }>;

    expectCheckWindow(query.startTime, MINUTE_BEFORE, DUE_AT);
  });

  test("Exceptions", () => {
    const query: Query<{ time: Date }> =
      MonitorStepExceptionMonitorUtil.toAnalyticsQuery(
        {
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          lastXSecondsOfExceptions: 60,
        },
        DUE_AT,
      ) as unknown as Query<{ time: Date }>;

    expectCheckWindow(query.time, MINUTE_BEFORE, DUE_AT);
  });

  test("Profiles", () => {
    const query: Query<{ startTime: Date }> =
      MonitorStepProfileMonitorUtil.toQuery(
        {
          ...MonitorStepProfileMonitorUtil.getDefault(),
          lastXSecondsOfProfiles: 60,
        },
        DUE_AT,
      ) as unknown as Query<{ startTime: Date }>;

    expectCheckWindow(query.startTime, MINUTE_BEFORE, DUE_AT);
  });

  test("Security Events", () => {
    const query: Query<{ time: Date }> =
      MonitorStepSecurityEventsMonitorUtil.toQuery(
        {
          ...MonitorStepSecurityEventsMonitorUtil.getDefault(),
          lastXSecondsOfEvents: 60,
        },
        DUE_AT,
      ) as unknown as Query<{ time: Date }>;

    expectCheckWindow(query.time, MINUTE_BEFORE, DUE_AT);
  });

  test("AI: the window it counts, and the span query an incident links to", () => {
    const step: ReturnType<typeof MonitorStepLlmMonitorUtil.getDefault> = {
      ...MonitorStepLlmMonitorUtil.getDefault(),
      lastXSecondsOfCalls: 60,
    };

    expectCheckWindow(
      MonitorStepLlmMonitorUtil.getWindow(step, DUE_AT),
      MINUTE_BEFORE,
      DUE_AT,
    );
    expectCheckWindow(
      (
        MonitorStepLlmMonitorUtil.toSpanQuery(step, DUE_AT) as unknown as {
          startTime: unknown;
        }
      ).startTime,
      MINUTE_BEFORE,
      DUE_AT,
    );
  });

  test("a step with no window still reads none, as before", () => {
    expect(
      (
        MonitorStepLogMonitorUtil.toQuery(
          { ...MonitorStepLogMonitorUtil.getDefault(), lastXSecondsOfLogs: 0 },
          DUE_AT,
        ) as unknown as { time?: unknown }
      ).time,
    ).toBeUndefined();
    expect(
      (
        MonitorStepTraceMonitorUtil.toQuery(
          {
            ...MonitorStepTraceMonitorUtil.getDefault(),
            lastXSecondsOfSpans: 0,
          },
          DUE_AT,
        ) as unknown as { startTime?: unknown }
      ).startTime,
    ).toBeUndefined();
  });
});
