import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import LogSeverity from "../../../Types/Log/LogSeverity";
import MonitorStepLogMonitor from "../../../Types/Monitor/MonitorStepLogMonitor";
import { JSONObject } from "../../../Types/JSON";

/*
 * Guards the persistence half of the "log monitors do not work" fix. The bug
 * hinged on MonitorStep.toJSON() serializing a sub-config only when it is
 * truthy: a step whose logMonitor was undefined serialized to no logMonitor at
 * all, so the config was silently dropped on save and the worker later saw an
 * empty config. These tests prove (a) a seeded telemetry sub-config survives a
 * toJSON -> fromJSON round-trip, (b) user-entered filters survive it, and
 * (c) the drop-when-undefined behavior the bug relied on is real (so the seed
 * is what prevents it).
 */

const buildArgs: (
  monitorType: MonitorType,
) => Parameters<typeof MonitorStep.getDefaultMonitorStep>[0] = (
  monitorType: MonitorType,
) => {
  const id: ObjectID = ObjectID.generate();
  return {
    monitorName: `${monitorType} monitor`,
    monitorType,
    onlineMonitorStatusId: id,
    offlineMonitorStatusId: id,
    defaultIncidentSeverityId: id,
    defaultAlertSeverityId: id,
  };
};

const serializedValue: (step: MonitorStep) => JSONObject = (
  step: MonitorStep,
): JSONObject => {
  return step.toJSON()["value"] as JSONObject;
};

const roundTrip: (step: MonitorStep) => MonitorStep = (
  step: MonitorStep,
): MonitorStep => {
  return MonitorStep.fromJSON(step.toJSON());
};

describe("MonitorStep telemetry sub-config serialization round-trip", () => {
  test("a default Logs step keeps its logMonitor through toJSON/fromJSON", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.Logs),
    );

    // Serialized output must actually contain the sub-config...
    const logMonitorJson: JSONObject = serializedValue(step)[
      "logMonitor"
    ] as JSONObject;
    expect(logMonitorJson).toBeDefined();
    expect(logMonitorJson["lastXSecondsOfLogs"]).toBeGreaterThan(0);

    // ...and it must survive a round-trip back into a MonitorStep.
    expect(roundTrip(step).data?.logMonitor).toBeDefined();
  });

  test.each([
    [MonitorType.Traces, "traceMonitor"],
    [MonitorType.Metrics, "metricMonitor"],
    [MonitorType.Exceptions, "exceptionMonitor"],
  ])(
    "a default %s step keeps its %s",
    (monitorType: MonitorType, key: string) => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
        buildArgs(monitorType),
      );

      expect(serializedValue(step)[key]).toBeDefined();
      expect(
        (roundTrip(step).data as unknown as JSONObject)[key],
      ).toBeDefined();
    },
  );

  test("user-entered log filters are written to the persisted form", () => {
    const serviceId: ObjectID = ObjectID.generate();
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.Logs),
    );

    const custom: MonitorStepLogMonitor = {
      attributes: { env: "prod" },
      body: "connection refused",
      severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
      telemetryServiceIds: [serviceId],
      entityKeys: ["host-1"],
      lastXSecondsOfLogs: 300,
    };
    step.setLogMonitor(custom);

    // The canonical persisted form (toJSON) carries every filter the user set.
    const logMonitorJson: JSONObject = serializedValue(step)[
      "logMonitor"
    ] as JSONObject;
    expect(logMonitorJson["body"]).toBe("connection refused");
    expect(logMonitorJson["severityTexts"]).toEqual([
      LogSeverity.Error,
      LogSeverity.Fatal,
    ]);
    expect(logMonitorJson["attributes"]).toEqual({ env: "prod" });
    expect(logMonitorJson["entityKeys"]).toEqual(["host-1"]);
    expect(logMonitorJson["lastXSecondsOfLogs"]).toBe(300);
    expect(
      (logMonitorJson["telemetryServiceIds"] as Array<unknown>).length,
    ).toBe(1);

    // And the config still deserializes back onto the step.
    expect(roundTrip(step).data?.logMonitor).toBeDefined();
  });

  test("the drop-when-undefined behavior the bug relied on is real", () => {
    /*
     * A Ping monitor has no telemetry sub-config. Its serialized form must
     * not carry logMonitor/traceMonitor/etc, and the round-trip returns
     * undefined for them. This is exactly why leaving the config undefined
     * (pre-fix) lost it on save — and why seeding it (the fix) is required.
     */
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.Ping),
    );

    const value: JSONObject = serializedValue(step);
    expect(value["logMonitor"]).toBeUndefined();
    expect(value["traceMonitor"]).toBeUndefined();
    expect(value["metricMonitor"]).toBeUndefined();
    expect(value["exceptionMonitor"]).toBeUndefined();

    const restored: MonitorStep = roundTrip(step);
    expect(restored.data?.logMonitor).toBeUndefined();
    expect(restored.data?.traceMonitor).toBeUndefined();
    expect(restored.data?.metricMonitor).toBeUndefined();
    expect(restored.data?.exceptionMonitor).toBeUndefined();
  });
});
