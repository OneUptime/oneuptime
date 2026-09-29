import Profile from "../../../Models/AnalyticsModels/Profile";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import { JSONObject } from "../../../Types/JSON";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
} from "../../../Types/Monitor/MonitorStepProfileMonitor";
import ObjectID from "../../../Types/ObjectID";

describe("MonitorStepProfileMonitorUtil", () => {
  describe("getDefault", () => {
    test("returns an empty monitor scoped to the last 60 seconds", () => {
      const def: MonitorStepProfileMonitor =
        MonitorStepProfileMonitorUtil.getDefault();

      expect(def.attributes).toEqual({});
      expect(def.profileType).toBe("");
      expect(def.profileTypes).toEqual([]);
      expect(def.telemetryServiceIds).toEqual([]);
      expect(def.entityKeys).toEqual([]);
      expect(def.lastXSecondsOfProfiles).toBe(60);
    });
  });

  describe("toQuery", () => {
    test("builds only the time window for the empty default", () => {
      const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery(
        MonitorStepProfileMonitorUtil.getDefault(),
      );

      // Only the rolling time window is present.
      expect(query.startTime).toBeInstanceOf(InBetween);
      expect(query.primaryEntityId).toBeUndefined();
      expect(query.entityKeys).toBeUndefined();
      expect(query.attributes).toBeUndefined();
      expect(query.profileType).toBeUndefined();
    });

    test("builds no filters at all when the time window is disabled", () => {
      const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        lastXSecondsOfProfiles: 0,
      });

      expect(query).toEqual({});
    });

    test("scopes to telemetry services when provided", () => {
      const serviceId: ObjectID = ObjectID.generate();

      const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        telemetryServiceIds: [serviceId],
        lastXSecondsOfProfiles: 0,
      });

      expect(query.primaryEntityId).toBeInstanceOf(Includes);
      expect((query.primaryEntityId as Includes).values).toEqual([serviceId]);
    });

    test("scopes to entity keys when provided", () => {
      const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        entityKeys: ["host-1", "pod-2"],
        lastXSecondsOfProfiles: 0,
      });

      expect(query.entityKeys).toBeInstanceOf(Includes);
      expect((query.entityKeys as Includes).values).toEqual([
        "host-1",
        "pod-2",
      ]);
    });

    test("passes attributes through only when non-empty", () => {
      const withAttrs: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        attributes: { "service.name": "checkout" },
        lastXSecondsOfProfiles: 0,
      });
      expect(withAttrs.attributes).toEqual({ "service.name": "checkout" });

      const withoutAttrs: Query<Profile> =
        MonitorStepProfileMonitorUtil.toQuery({
          ...MonitorStepProfileMonitorUtil.getDefault(),
          attributes: {},
          lastXSecondsOfProfiles: 0,
        });
      expect(withoutAttrs.attributes).toBeUndefined();
    });

    test("uses Includes for profileTypes", () => {
      const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        profileTypes: ["cpu", "heap"],
        lastXSecondsOfProfiles: 0,
      });

      expect(query.profileType).toBeInstanceOf(Includes);
      expect((query.profileType as unknown as Includes).values).toEqual([
        "cpu",
        "heap",
      ]);
    });

    test("a single profileType wins over profileTypes as a Search", () => {
      const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        profileTypes: ["cpu", "heap"],
        profileType: "cpu",
        lastXSecondsOfProfiles: 0,
      });

      expect(query.profileType).toBeInstanceOf(Search);
      expect((query.profileType as unknown as Search<string>).value).toBe(
        "cpu",
      );
    });

    test("builds a bounded time window from lastXSecondsOfProfiles", () => {
      const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        lastXSecondsOfProfiles: 120,
      });

      const window: InBetween<Date> = query.startTime as InBetween<Date>;
      expect(window).toBeInstanceOf(InBetween);

      const spanMs: number =
        window.endValue.getTime() - window.startValue.getTime();
      // 120 seconds, allowing a small margin for clock advance during the call.
      expect(spanMs).toBeGreaterThanOrEqual(119 * 1000);
      expect(spanMs).toBeLessThanOrEqual(121 * 1000);
    });
  });

  describe("round-trip", () => {
    test("fromJSON(toJSON(x)) preserves a populated monitor", () => {
      const monitor: MonitorStepProfileMonitor = {
        attributes: { env: "prod", replicas: 3, canary: true },
        profileType: "cpu",
        profileTypes: ["cpu", "heap"],
        telemetryServiceIds: [ObjectID.generate(), ObjectID.generate()],
        entityKeys: ["host-1"],
        lastXSecondsOfProfiles: 300,
      };

      const json: JSONObject = MonitorStepProfileMonitorUtil.toJSON(monitor);
      const roundTripped: MonitorStepProfileMonitor =
        MonitorStepProfileMonitorUtil.fromJSON(json);

      expect(roundTripped.attributes).toEqual(monitor.attributes);
      expect(roundTripped.profileType).toBe(monitor.profileType);
      expect(roundTripped.profileTypes).toEqual(monitor.profileTypes);
      expect(roundTripped.entityKeys).toEqual(monitor.entityKeys);
      expect(roundTripped.lastXSecondsOfProfiles).toBe(
        monitor.lastXSecondsOfProfiles,
      );
      expect(
        roundTripped.telemetryServiceIds.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual(
        monitor.telemetryServiceIds.map((id: ObjectID) => {
          return id.toString();
        }),
      );
    });

    test("fromJSON defaults entityKeys to an empty array when absent", () => {
      const parsed: MonitorStepProfileMonitor =
        MonitorStepProfileMonitorUtil.fromJSON({
          attributes: {},
          profileType: "",
          profileTypes: [],
          telemetryServiceIds: [],
          lastXSecondsOfProfiles: 60,
        });

      expect(parsed.entityKeys).toEqual([]);
    });
  });
});
