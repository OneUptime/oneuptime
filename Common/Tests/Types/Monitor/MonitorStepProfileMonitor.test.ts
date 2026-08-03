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
    test("builds no filters for the empty default when the time window is off", () => {
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

    test("omits entity keys when the list is empty or undefined", () => {
      expect(
        MonitorStepProfileMonitorUtil.toQuery({
          ...MonitorStepProfileMonitorUtil.getDefault(),
          entityKeys: [],
          lastXSecondsOfProfiles: 0,
        }).entityKeys,
      ).toBeUndefined();

      // Monitors saved before entityKeys existed carry it as undefined.
      expect(
        MonitorStepProfileMonitorUtil.toQuery({
          ...MonitorStepProfileMonitorUtil.getDefault(),
          entityKeys: undefined,
          lastXSecondsOfProfiles: 0,
        }).entityKeys,
      ).toBeUndefined();
    });

    test("passes attributes through when non-empty", () => {
      const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        attributes: { env: "prod", pid: 42 },
        lastXSecondsOfProfiles: 0,
      });

      expect(query.attributes).toEqual({ env: "prod", pid: 42 });
    });

    test("omits attributes when the dictionary is empty", () => {
      expect(
        MonitorStepProfileMonitorUtil.toQuery({
          ...MonitorStepProfileMonitorUtil.getDefault(),
          attributes: {},
          lastXSecondsOfProfiles: 0,
        }).attributes,
      ).toBeUndefined();
    });

    test("filters by profile types (array) as an Includes", () => {
      const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        profileTypes: ["cpu", "heap"],
        lastXSecondsOfProfiles: 0,
      });

      expect(query.profileType).toBeInstanceOf(Includes);
      expect((query.profileType as Includes).values).toEqual(["cpu", "heap"]);
    });

    test("filters by the single profileType as a Search", () => {
      const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        profileType: "cpu",
        lastXSecondsOfProfiles: 0,
      });

      expect(query.profileType).toBeInstanceOf(Search);
      expect((query.profileType as Search<string>).value).toBe("cpu");
    });

    test("omits the profile type filter when neither is set", () => {
      expect(
        MonitorStepProfileMonitorUtil.toQuery({
          ...MonitorStepProfileMonitorUtil.getDefault(),
          profileTypes: [],
          profileType: "",
          lastXSecondsOfProfiles: 0,
        }).profileType,
      ).toBeUndefined();
    });

    test("documents current behavior: a non-empty single profileType overrides the profileTypes array", () => {
      /*
       * Both `profileTypes` (array -> Includes) and `profileType` (string ->
       * Search) are written to the SAME `query.profileType` field, and the
       * single value is applied last, so it wins. The sibling Log/Trace
       * monitors keep their array and free-text filters on separate query
       * columns; this collision looks unintended and is flagged in the PR.
       * Locking the behavior down here so any future change is deliberate.
       */
      const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        profileTypes: ["cpu", "heap"],
        profileType: "wall",
        lastXSecondsOfProfiles: 0,
      });

      expect(query.profileType).toBeInstanceOf(Search);
      expect((query.profileType as Search<string>).value).toBe("wall");
    });

    test("builds a trailing startTime window from lastXSecondsOfProfiles", () => {
      const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        lastXSecondsOfProfiles: 120,
      });

      expect(query.startTime).toBeInstanceOf(InBetween);

      const window: InBetween<Date> = query.startTime as InBetween<Date>;
      const spanMs: number =
        window.endValue.getTime() - window.startValue.getTime();

      expect(Math.abs(spanMs - 120 * 1000)).toBeLessThan(2000);
      expect(window.startValue.getTime()).toBeLessThan(
        window.endValue.getTime(),
      );
    });

    test("omits the time window when lastXSecondsOfProfiles is 0", () => {
      expect(
        MonitorStepProfileMonitorUtil.toQuery({
          ...MonitorStepProfileMonitorUtil.getDefault(),
          lastXSecondsOfProfiles: 0,
        }).startTime,
      ).toBeUndefined();
    });
  });

  describe("toJSON / round trip", () => {
    test("normalizes an undefined entityKeys to an empty array", () => {
      const json: JSONObject = MonitorStepProfileMonitorUtil.toJSON({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        entityKeys: undefined,
      });

      expect(json["entityKeys"]).toEqual([]);
    });

    test("round-trips a fully populated monitor", () => {
      const original: MonitorStepProfileMonitor = {
        attributes: { env: "prod", pid: 42 },
        profileType: "cpu",
        profileTypes: ["cpu", "heap"],
        telemetryServiceIds: [ObjectID.generate()],
        entityKeys: ["host-1"],
        lastXSecondsOfProfiles: 300,
      };

      const roundTripped: MonitorStepProfileMonitor =
        MonitorStepProfileMonitorUtil.fromJSON(
          MonitorStepProfileMonitorUtil.toJSON(original),
        );

      expect(roundTripped.attributes).toEqual(original.attributes);
      expect(roundTripped.profileType).toBe(original.profileType);
      expect(roundTripped.profileTypes).toEqual(original.profileTypes);
      expect(roundTripped.entityKeys).toEqual(original.entityKeys);
      expect(roundTripped.lastXSecondsOfProfiles).toBe(
        original.lastXSecondsOfProfiles,
      );
      expect(roundTripped.telemetryServiceIds.map(String)).toEqual(
        original.telemetryServiceIds.map(String),
      );
    });

    test("fromJSON defaults attributes and entityKeys when absent", () => {
      const monitor: MonitorStepProfileMonitor =
        MonitorStepProfileMonitorUtil.fromJSON({
          telemetryServiceIds: [],
        } as JSONObject);

      expect(monitor.attributes).toEqual({});
      expect(monitor.entityKeys).toEqual([]);
    });
  });
});
