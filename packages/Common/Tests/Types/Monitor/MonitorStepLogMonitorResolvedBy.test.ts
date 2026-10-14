import Log from "../../../Models/AnalyticsModels/Log";
import Includes from "../../../Types/BaseDatabase/Includes";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Query from "../../../Types/BaseDatabase/Query";
import { JSONObject } from "../../../Types/JSON";
import LogSeverity from "../../../Types/Log/LogSeverity";
import MonitorStepLogMonitor, {
  MAX_LOG_MONITOR_RESOLVED_BY_ATTRIBUTES,
  MAX_LOG_MONITOR_RESOLVED_BY_VALUE_LENGTH,
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Resolved By, on a grouped Logs monitor: the log that says a group has
 * recovered. "interface.down" per interface is the case it exists for -
 * the link is back when the device says "interface.up", not when it has
 * said nothing for five minutes.
 *
 * A step reaches the worker as the JSON it was saved as, so the readers
 * here take anything and hand back something safe; and a monitor saved
 * before the field existed must behave exactly as it did.
 */

function step(
  overrides: Partial<MonitorStepLogMonitor> = {},
): MonitorStepLogMonitor {
  return {
    ...MonitorStepLogMonitorUtil.getDefault(),
    attributes: { "event.name": "interface.down" },
    groupByAttributes: ["networkDevice.name", "network.interface.name"],
    resolvedByAttributes: { "event.name": "interface.up" },
    ...overrides,
  };
}

describe("getResolvedByAttributes", () => {
  test("is the attributes of the resolving log, on a grouped monitor", () => {
    expect(MonitorStepLogMonitorUtil.getResolvedByAttributes(step())).toEqual({
      "event.name": "interface.up",
    });
  });

  test("is empty on a monitor that is not grouped: there is no group for a log to resolve", () => {
    for (const groupByAttributes of [[], undefined, ["  "], null]) {
      expect(
        MonitorStepLogMonitorUtil.getResolvedByAttributes(
          step({
            groupByAttributes: groupByAttributes as Array<string> | undefined,
          }),
        ),
      ).toEqual({});
    }
  });

  test("is empty on a monitor saved before the field existed, and on one that leaves it empty", () => {
    for (const resolvedByAttributes of [undefined, null, {}]) {
      expect(
        MonitorStepLogMonitorUtil.getResolvedByAttributes(
          step({
            resolvedByAttributes: resolvedByAttributes as
              | Record<string, string>
              | undefined,
          }),
        ),
      ).toEqual({});
    }

    expect(MonitorStepLogMonitorUtil.getResolvedByAttributes(null)).toEqual({});
    expect(
      MonitorStepLogMonitorUtil.getResolvedByAttributes(undefined),
    ).toEqual({});
  });

  test("values are the strings a log's attributes hold", () => {
    expect(
      MonitorStepLogMonitorUtil.getResolvedByAttributes(
        step({
          resolvedByAttributes: {
            status: "Established",
            code: 17801,
            up: true,
          },
        }),
      ),
    ).toEqual({ status: "Established", code: "17801", up: "true" });
  });

  test("trims keys and values, and drops what is left empty", () => {
    expect(
      MonitorStepLogMonitorUtil.getResolvedByAttributes(
        step({
          resolvedByAttributes: {
            "  event.name ": "  interface.up  ",
            "": "x",
            "   ": "y",
            empty: "",
            blank: "   ",
          },
        }),
      ),
    ).toEqual({ "event.name": "interface.up" });
  });

  test("drops values that are not text, a number or a switch", () => {
    expect(
      MonitorStepLogMonitorUtil.getResolvedByAttributes(
        step({
          resolvedByAttributes: {
            keep: "yes",
            list: ["a"],
            object: { a: 1 },
            nothing: null,
            missing: undefined,
          } as unknown as Record<string, string>,
        }),
      ),
    ).toEqual({ keep: "yes" });
  });

  test("the first of two keys that trim to the same name wins", () => {
    expect(
      MonitorStepLogMonitorUtil.getResolvedByAttributes(
        step({
          resolvedByAttributes: { status: "up", " status": "down" },
        }),
      ),
    ).toEqual({ status: "up" });
  });

  test("refuses __proto__ as a key, and a key or value too long to be an attribute", () => {
    const raw: Record<string, string> = JSON.parse(
      '{"__proto__": "polluted", "ok": "yes"}',
    ) as Record<string, string>;

    raw["k".repeat(257)] = "too long a key";
    raw["long"] = "v".repeat(MAX_LOG_MONITOR_RESOLVED_BY_VALUE_LENGTH + 1);
    raw["longest"] = "v".repeat(MAX_LOG_MONITOR_RESOLVED_BY_VALUE_LENGTH);

    const cleaned: Record<string, string> =
      MonitorStepLogMonitorUtil.getResolvedByAttributes(
        step({ resolvedByAttributes: raw }),
      );

    expect(Object.keys(cleaned).sort()).toEqual(["longest", "ok"]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf(cleaned)).toBe(Object.prototype);
  });

  test("keeps at most ten attributes", () => {
    const raw: Record<string, string> = {};

    for (let index: number = 0; index < 25; index++) {
      raw[`key${index}`] = "value";
    }

    expect(MAX_LOG_MONITOR_RESOLVED_BY_ATTRIBUTES).toBe(10);
    expect(
      Object.keys(
        MonitorStepLogMonitorUtil.getResolvedByAttributes(
          step({ resolvedByAttributes: raw }),
        ),
      ),
    ).toHaveLength(10);
  });

  test("anything that is not a set of attributes is none", () => {
    for (const raw of ["event.name=up", 5, true, ["event.name", "up"]]) {
      expect(
        MonitorStepLogMonitorUtil.getResolvedByAttributes(
          step({
            resolvedByAttributes: raw as unknown as Record<string, string>,
          }),
        ),
      ).toEqual({});
    }
  });
});

describe("isResolvedByLog", () => {
  test("is true only for a grouped monitor that names a resolving log", () => {
    expect(MonitorStepLogMonitorUtil.isResolvedByLog(step())).toBe(true);

    for (const overrides of [
      { groupByAttributes: [] },
      { resolvedByAttributes: {} },
      { resolvedByAttributes: undefined },
      { resolvedByAttributes: { "event.name": "   " } },
    ] as Array<Partial<MonitorStepLogMonitor>>) {
      expect({
        overrides,
        resolvedByLog: MonitorStepLogMonitorUtil.isResolvedByLog(
          step(overrides),
        ),
      }).toEqual({ overrides, resolvedByLog: false });
    }

    expect(
      MonitorStepLogMonitorUtil.isResolvedByLog(
        MonitorStepLogMonitorUtil.getDefault(),
      ),
    ).toBe(false);
    expect(MonitorStepLogMonitorUtil.isResolvedByLog(null)).toBe(false);
  });
});

describe("toResolvedByQuery", () => {
  const UNTIL: Date = new Date("2026-10-13T10:05:00.000Z");

  test("matches the resolving logs in the same window, services and entities as the logs the monitor counts", () => {
    const serviceId: ObjectID = ObjectID.generate();
    const monitor: MonitorStepLogMonitor = step({
      telemetryServiceIds: [serviceId],
      entityKeys: ["host-1"],
      lastXSecondsOfLogs: 300,
    });

    const problem: Query<Log> = MonitorStepLogMonitorUtil.toQuery(
      monitor,
      UNTIL,
    );
    const resolving: Query<Log> = MonitorStepLogMonitorUtil.toResolvedByQuery(
      monitor,
      UNTIL,
    );

    expect(resolving.attributes).toEqual({ "event.name": "interface.up" });
    expect(problem.attributes).toEqual({ "event.name": "interface.down" });

    expect((resolving.primaryEntityId as Includes).values).toEqual([serviceId]);
    expect((resolving.entityKeys as Includes).values).toEqual(["host-1"]);

    const window: InBetween<Date> = resolving.time as InBetween<Date>;

    expect(window.endValue).toEqual(UNTIL);
    expect(window.startValue).toEqual(new Date("2026-10-13T10:00:00.000Z"));
    expect(resolving.time).toEqual(problem.time);
  });

  test("leaves out the text and severity filters: they describe the problem, not the recovery", () => {
    const resolving: Query<Log> = MonitorStepLogMonitorUtil.toResolvedByQuery(
      step({
        body: "terminated",
        severityTexts: [LogSeverity.Error],
      }),
      UNTIL,
    );

    expect(resolving.body).toBeUndefined();
    expect(resolving.severityText).toBeUndefined();
  });

  test("uses the cleaned attributes, never the raw ones", () => {
    const resolving: Query<Log> = MonitorStepLogMonitorUtil.toResolvedByQuery(
      step({
        resolvedByAttributes: { " status ": " Established ", blank: " " },
      }),
      UNTIL,
    );

    expect(resolving.attributes).toEqual({ status: "Established" });
  });
});

describe("a step saved and read back", () => {
  test("keeps Resolved By", () => {
    const saved: JSONObject = MonitorStepLogMonitorUtil.toJSON(step());

    expect(saved["resolvedByAttributes"]).toEqual({
      "event.name": "interface.up",
    });
    expect(
      MonitorStepLogMonitorUtil.fromJSON(saved).resolvedByAttributes,
    ).toEqual({ "event.name": "interface.up" });
    expect(
      MonitorStepLogMonitorUtil.isResolvedByLog(
        MonitorStepLogMonitorUtil.fromJSON(saved),
      ),
    ).toBe(true);
  });

  test("a step saved before the field existed reads as one whose groups resolve when their logs stop", () => {
    const saved: JSONObject = MonitorStepLogMonitorUtil.toJSON(step());

    delete saved["resolvedByAttributes"];

    const read: MonitorStepLogMonitor =
      MonitorStepLogMonitorUtil.fromJSON(saved);

    expect(read.resolvedByAttributes).toEqual({});
    expect(MonitorStepLogMonitorUtil.isResolvedByLog(read)).toBe(false);
    // Everything else is as it was.
    expect(read.groupByAttributes).toEqual([
      "networkDevice.name",
      "network.interface.name",
    ]);
    expect(read.attributes).toEqual({ "event.name": "interface.down" });
  });

  test("what was typed is kept while Group By is empty, and simply not applied", () => {
    const saved: JSONObject = MonitorStepLogMonitorUtil.toJSON(
      step({ groupByAttributes: [] }),
    );

    expect(saved["resolvedByAttributes"]).toEqual({
      "event.name": "interface.up",
    });

    const read: MonitorStepLogMonitor =
      MonitorStepLogMonitorUtil.fromJSON(saved);

    expect(read.resolvedByAttributes).toEqual({ "event.name": "interface.up" });
    expect(MonitorStepLogMonitorUtil.isResolvedByLog(read)).toBe(false);
  });

  test("the default step names no resolving log", () => {
    expect(MonitorStepLogMonitorUtil.getDefault().resolvedByAttributes).toEqual(
      {},
    );
  });
});
