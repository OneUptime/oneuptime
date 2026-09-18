import Log from "../../../Models/AnalyticsModels/Log";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import LogSeverity from "../../../Types/Log/LogSeverity";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import ObjectID from "../../../Types/ObjectID";

describe("MonitorStepLogMonitorUtil", () => {
  describe("getDefault", () => {
    test("returns an empty monitor scoped to the last 60 seconds", () => {
      const def: MonitorStepLogMonitor = MonitorStepLogMonitorUtil.getDefault();

      expect(def.attributes).toEqual({});
      expect(def.body).toBe("");
      expect(def.severityTexts).toEqual([]);
      expect(def.telemetryServiceIds).toEqual([]);
      expect(def.entityKeys).toEqual([]);
      expect(def.lastXSecondsOfLogs).toBe(60);
    });
  });

  describe("toQuery", () => {
    test("builds no filters for the empty default (other than the time window)", () => {
      const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery({
        ...MonitorStepLogMonitorUtil.getDefault(),
        lastXSecondsOfLogs: 0, // disable the time window too
      });

      expect(query).toEqual({});
    });

    test("scopes to telemetry services when provided", () => {
      const serviceId: ObjectID = ObjectID.generate();

      const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery({
        ...MonitorStepLogMonitorUtil.getDefault(),
        telemetryServiceIds: [serviceId],
        lastXSecondsOfLogs: 0,
      });

      expect(query.primaryEntityId).toBeInstanceOf(Includes);
      expect((query.primaryEntityId as Includes).values).toEqual([serviceId]);
    });

    test("scopes to entity keys when provided", () => {
      const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery({
        ...MonitorStepLogMonitorUtil.getDefault(),
        entityKeys: ["host-1", "pod-2"],
        lastXSecondsOfLogs: 0,
      });

      expect(query.entityKeys).toBeInstanceOf(Includes);
      expect((query.entityKeys as Includes).values).toEqual([
        "host-1",
        "pod-2",
      ]);
    });

    test("omits entity keys when the list is empty or undefined", () => {
      expect(
        MonitorStepLogMonitorUtil.toQuery({
          ...MonitorStepLogMonitorUtil.getDefault(),
          entityKeys: [],
          lastXSecondsOfLogs: 0,
        }).entityKeys,
      ).toBeUndefined();

      expect(
        MonitorStepLogMonitorUtil.toQuery({
          ...MonitorStepLogMonitorUtil.getDefault(),
          entityKeys: undefined,
          lastXSecondsOfLogs: 0,
        }).entityKeys,
      ).toBeUndefined();
    });

    test("passes attributes through when non-empty", () => {
      const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery({
        ...MonitorStepLogMonitorUtil.getDefault(),
        attributes: { env: "prod", retries: 3, ok: true },
        lastXSecondsOfLogs: 0,
      });

      expect(query.attributes).toEqual({ env: "prod", retries: 3, ok: true });
    });

    test("omits attributes when the dictionary is empty", () => {
      expect(
        MonitorStepLogMonitorUtil.toQuery({
          ...MonitorStepLogMonitorUtil.getDefault(),
          attributes: {},
          lastXSecondsOfLogs: 0,
        }).attributes,
      ).toBeUndefined();
    });

    test("filters by severity when provided", () => {
      const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery({
        ...MonitorStepLogMonitorUtil.getDefault(),
        severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
        lastXSecondsOfLogs: 0,
      });

      expect(query.severityText).toBeInstanceOf(Includes);
      expect((query.severityText as Includes).values).toEqual([
        LogSeverity.Error,
        LogSeverity.Fatal,
      ]);
    });

    test("searches the body when a body filter is set", () => {
      const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery({
        ...MonitorStepLogMonitorUtil.getDefault(),
        body: "connection refused",
        lastXSecondsOfLogs: 0,
      });

      expect(query.body).toBeInstanceOf(Search);
      expect((query.body as Search<string>).value).toBe("connection refused");
    });

    test("omits the body filter when it is an empty string", () => {
      expect(
        MonitorStepLogMonitorUtil.toQuery({
          ...MonitorStepLogMonitorUtil.getDefault(),
          body: "",
          lastXSecondsOfLogs: 0,
        }).body,
      ).toBeUndefined();
    });

    test("builds a trailing time window from lastXSecondsOfLogs", () => {
      const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery({
        ...MonitorStepLogMonitorUtil.getDefault(),
        lastXSecondsOfLogs: 120,
      });

      expect(query.time).toBeInstanceOf(InBetween);

      const time: InBetween<Date> = query.time as InBetween<Date>;
      const spanMs: number =
        time.endValue.getTime() - time.startValue.getTime();

      // 120 seconds back from now, within a small tolerance.
      expect(Math.abs(spanMs - 120 * 1000)).toBeLessThan(2000);
      expect(time.startValue.getTime()).toBeLessThan(time.endValue.getTime());
    });

    test("omits the time window when lastXSecondsOfLogs is 0", () => {
      expect(
        MonitorStepLogMonitorUtil.toQuery({
          ...MonitorStepLogMonitorUtil.getDefault(),
          lastXSecondsOfLogs: 0,
        }).time,
      ).toBeUndefined();
    });

    test("combines every filter when all are set", () => {
      const serviceId: ObjectID = ObjectID.generate();

      const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery({
        attributes: { env: "prod" },
        body: "timeout",
        severityTexts: [LogSeverity.Error],
        telemetryServiceIds: [serviceId],
        entityKeys: ["host-1"],
        lastXSecondsOfLogs: 60,
      });

      expect(query.primaryEntityId).toBeDefined();
      expect(query.entityKeys).toBeDefined();
      expect(query.attributes).toBeDefined();
      expect(query.severityText).toBeDefined();
      expect(query.body).toBeDefined();
      expect(query.time).toBeDefined();
    });
  });

  describe("toJSON / fromJSON", () => {
    test("round-trips a fully populated monitor", () => {
      const original: MonitorStepLogMonitor = {
        attributes: { env: "prod", retries: 3 },
        body: "timeout",
        severityTexts: [LogSeverity.Error, LogSeverity.Warning],
        telemetryServiceIds: [ObjectID.generate()],
        entityKeys: ["host-1"],
        lastXSecondsOfLogs: 300,
      };

      const roundTripped: MonitorStepLogMonitor =
        MonitorStepLogMonitorUtil.fromJSON(
          MonitorStepLogMonitorUtil.toJSON(original),
        );

      expect(roundTripped.attributes).toEqual(original.attributes);
      expect(roundTripped.body).toBe(original.body);
      expect(roundTripped.severityTexts).toEqual(original.severityTexts);
      expect(roundTripped.entityKeys).toEqual(original.entityKeys);
      expect(roundTripped.lastXSecondsOfLogs).toBe(original.lastXSecondsOfLogs);
      expect(roundTripped.telemetryServiceIds.map(String)).toEqual(
        original.telemetryServiceIds.map(String),
      );
    });

    test("fromJSON defaults attributes and entityKeys when absent", () => {
      const monitor: MonitorStepLogMonitor = MonitorStepLogMonitorUtil.fromJSON(
        {
          telemetryServiceIds: [],
        } as JSONObject,
      );

      expect(monitor.attributes).toEqual({});
      // entityKeys is optional on older saved monitors — normalized to [].
      expect(monitor.entityKeys).toEqual([]);
    });

    test("toJSON normalizes an undefined entityKeys to an empty array", () => {
      const json: JSONObject = MonitorStepLogMonitorUtil.toJSON({
        ...MonitorStepLogMonitorUtil.getDefault(),
        entityKeys: undefined,
      });

      expect(json["entityKeys"]).toEqual([]);
    });
  });
});
