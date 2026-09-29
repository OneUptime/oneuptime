import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import Label from "../../../../Models/DatabaseModels/Label";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import { MutableMetricService } from "../../../../Server/Services/MutableMetricService";
import logger from "../../../../Server/Utils/Logger";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import SloMetricUtil from "../../../../Server/Utils/Slo/SloMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SloMetricType from "../../../../Types/ServiceLevelObjective/SloMetricType";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import SloMetricTypeUtil from "../../../../Utils/Slo/SloMetricType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * SloMetricUtil turns one SLO evaluation into oneuptime.slo.* rows in
 * MetricItemV3. What is pinned here is everything a reader depends on and no
 * type system checks:
 *
 *   - the row is keyed to the SLO (primaryEntityId / primaryEntityType), with
 *     exactly the columns monitor metric rows carry;
 *   - the attributes the SLO Metrics page filters on, plus the SLO's labels,
 *     are stamped and published in attributeKeys (the pickers read keys);
 *   - missing and non-finite readings are skipped, never written as 0;
 *   - retention follows the shared monitor-metric knob, with the same default
 *     and <= 0 guard, and is never a history-length retention;
 *   - one insert per evaluation, and a catalog row per written name carrying
 *     the unit and description the page charts with.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SLO_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SLO_NAME: string = "Checkout availability";

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// One realistic evaluation: At Risk, 64s of an 864s budget left, 22x burn.
const FULL_VALUES: Partial<Record<SloMetricType, number>> = {
  [SloMetricType.SliPercent]: 99.0740740741,
  [SloMetricType.TargetPercent]: 99,
  [SloMetricType.ErrorBudgetRemainingPercent]: 7.4074074074,
  [SloMetricType.ErrorBudgetRemainingSeconds]: 64,
  [SloMetricType.BurnRate]: 22.2222222222,
  [SloMetricType.Status]: 1,
};

function makeLabel(name: string): Label {
  const label: Label = new Label();
  label.name = name;
  return label;
}

describe("SloMetricUtil.saveSloMetrics", () => {
  let insertedRows: Array<JSONObject>;
  let insertCalls: number;
  let indexedMaps: Array<Dictionary<MetricType>>;

  /*
   * The retention is cached for five minutes, as in MonitorMetricUtil. Every
   * test runs a simulated day after the previous one, so none of them reads a
   * retention another test cached.
   */
  let currentTime: number = new Date("2026-09-01T12:00:00.000Z").getTime();

  beforeEach(() => {
    insertedRows = [];
    insertCalls = 0;
    indexedMaps = [];
    currentTime += DAY_IN_MS;

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(currentTime);
    });
    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        insertCalls++;
        insertedRows.push(...rows);
      });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          metricNameServiceNameMap: Dictionary<MetricType>;
        }): Promise<void> => {
          indexedMaps.push(data.metricNameServiceNameMap);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function save(
    input: {
      values?: Partial<Record<SloMetricType, number | null | undefined>>;
      sloName?: string | undefined;
      labels?: Array<Label> | undefined;
    } = {},
  ): Promise<void> {
    await SloMetricUtil.saveSloMetrics({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      sloName: "sloName" in input ? input.sloName : SLO_NAME,
      labels: input.labels,
      values: input.values || FULL_VALUES,
    });
  }

  function namesWritten(): Array<string> {
    return insertedRows.map((row: JSONObject): string => {
      return row["name"] as string;
    });
  }

  function rowNamed(metricType: SloMetricType): JSONObject {
    const row: JSONObject | undefined = insertedRows.find(
      (candidate: JSONObject): boolean => {
        return candidate["name"] === metricType;
      },
    );

    expect(row).toBeDefined();
    return row!;
  }

  function expectedRetentionDate(days: number): string {
    return OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(currentTime), days),
    );
  }

  describe("rows", () => {
    test("writes one row per reading, in catalog order, in ONE insert", async () => {
      await save();

      expect(insertCalls).toBe(1);
      expect(namesWritten()).toEqual(SloMetricTypeUtil.getAll());
    });

    test("keys every row to the SLO, not to a monitor or a service", async () => {
      await save();

      for (const row of insertedRows) {
        expect(row["primaryEntityId"]).toBe(SLO_ID.toString());
        expect(row["primaryEntityType"]).toBe(
          ServiceType.ServiceLevelObjective,
        );
        expect(row["projectId"]).toBe(PROJECT_ID.toString());
      }
    });

    test("carries each reading as the row value, including a negative budget and a Healthy 0", async () => {
      await save({
        values: {
          [SloMetricType.ErrorBudgetRemainingSeconds]: -1136,
          [SloMetricType.ErrorBudgetRemainingPercent]: -31.48,
          [SloMetricType.Status]: 0,
        },
      });

      expect(rowNamed(SloMetricType.ErrorBudgetRemainingSeconds)["value"]).toBe(
        -1136,
      );
      expect(rowNamed(SloMetricType.ErrorBudgetRemainingPercent)["value"]).toBe(
        -31.48,
      );
      expect(rowNamed(SloMetricType.Status)["value"]).toBe(0);
    });

    test("is a Gauge point with the shape of a monitor metric row", async () => {
      await save();

      const row: JSONObject = rowNamed(SloMetricType.SliPercent);
      const now: Date = new Date(currentTime);

      expect(row["metricPointType"]).toBe(MetricPointType.Gauge);
      expect(row["createdAt"]).toBe(OneUptimeDate.toClickhouseDateTime(now));
      expect(row["time"]).toBe(row["createdAt"]);
      expect(row["timeUnixNano"]).toBe(
        OneUptimeDate.toUnixNano(now).toString(),
      );
      expect(row["aggregationTemporality"]).toBeNull();
      expect(row["startTime"]).toBeNull();
      expect(row["startTimeUnixNano"]).toBeNull();
      expect(row["isMonotonic"]).toBeNull();
      expect(row["count"]).toBeNull();
      expect(row["sum"]).toBeNull();
      expect(row["min"]).toBeNull();
      expect(row["max"]).toBeNull();
      expect(row["bucketCounts"]).toEqual([]);
      expect(row["explicitBounds"]).toEqual([]);
      expect(typeof row["_id"]).toBe("string");
    });

    test("writes exactly the columns MonitorMetricUtil.buildMonitorMetricRow writes (the lockstep)", async () => {
      await save();

      /*
       * Private on purpose, and read here on purpose: the comment on both
       * builders says they move together, and this is what makes that true.
       */
      const monitorRow: JSONObject = await (
        MonitorMetricUtil as unknown as {
          buildMonitorMetricRow: (data: {
            projectId: ObjectID;
            monitorId: ObjectID;
            metricName: string;
            value: number | null | undefined;
            attributes: JSONObject;
          }) => Promise<JSONObject>;
        }
      ).buildMonitorMetricRow({
        projectId: PROJECT_ID,
        monitorId: SLO_ID,
        metricName: "oneuptime.monitor.online",
        value: 1,
        attributes: { monitorId: SLO_ID.toString() },
      });

      const sloRow: JSONObject = rowNamed(SloMetricType.SliPercent);

      expect(Object.keys(sloRow).sort()).toEqual(
        Object.keys(monitorRow).sort(),
      );

      for (const column of [
        "aggregationTemporality",
        "startTime",
        "startTimeUnixNano",
        "isMonotonic",
        "count",
        "sum",
        "min",
        "max",
        "bucketCounts",
        "explicitBounds",
      ]) {
        expect(sloRow[column]).toEqual(monitorRow[column]);
      }
    });

    test("stamps every row of one evaluation with the same timestamp, so the SLI and its target overlay exactly", async () => {
      await save();

      const times: Set<unknown> = new Set(
        insertedRows.map((row: JSONObject): unknown => {
          return row["timeUnixNano"];
        }),
      );

      expect(times.size).toBe(1);
    });

    test("gives every row its own id", async () => {
      await save();

      const ids: Set<unknown> = new Set(
        insertedRows.map((row: JSONObject): unknown => {
          return row["_id"];
        }),
      );

      expect(ids.size).toBe(insertedRows.length);
    });
  });

  describe("attributes", () => {
    test("stamps the bare sloId, projectId and sloName the SLO Metrics page filters on", async () => {
      await save();

      for (const row of insertedRows) {
        const attributes: JSONObject = row["attributes"] as JSONObject;

        expect(attributes["sloId"]).toBe(SLO_ID.toString());
        expect(attributes["projectId"]).toBe(PROJECT_ID.toString());
        expect(attributes["sloName"]).toBe(SLO_NAME);
      }
    });

    test("never writes a resource.* key, which the bare-key filters could not match", async () => {
      await save({ labels: [makeLabel("tier:gold")] });

      for (const row of insertedRows) {
        for (const key of Object.keys(row["attributes"] as JSONObject)) {
          expect(key.startsWith("resource.")).toBe(false);
        }
      }
    });

    test("never stamps status, target or window settings as attributes, which would split one line into many", async () => {
      await save();

      expect(
        Object.keys(
          rowNamed(SloMetricType.SliPercent)["attributes"] as JSONObject,
        ).sort(),
      ).toEqual(["projectId", "sloId", "sloName"]);
    });

    test.each([
      ["absent", undefined],
      ["empty", ""],
      ["blank", "   "],
    ])(
      "omits sloName when the name is %s instead of recording an empty dimension",
      async (_name: string, sloName: string | undefined) => {
        await save({ sloName: sloName });

        for (const row of insertedRows) {
          expect(
            Object.prototype.hasOwnProperty.call(row["attributes"], "sloName"),
          ).toBe(false);
        }
      },
    );

    test("turns the SLO's labels into oneuptime.label.* attributes", async () => {
      await save({
        labels: [makeLabel("customer-facing"), makeLabel("tier:gold")],
      });

      for (const row of insertedRows) {
        const attributes: JSONObject = row["attributes"] as JSONObject;

        expect(attributes["oneuptime.label.customer_facing"]).toBe("true");
        expect(attributes["oneuptime.label.tier"]).toBe("gold");
      }
    });

    test("publishes the merged keys, labels included, in sorted attributeKeys - what the pickers read", async () => {
      await save({ labels: [makeLabel("tier:gold")] });

      for (const row of insertedRows) {
        expect(row["attributeKeys"]).toEqual(
          Object.keys(row["attributes"] as JSONObject).sort(),
        );
        expect(row["attributeKeys"]).toContain("oneuptime.label.tier");
      }
    });

    test("adds no oneuptime.* attribute for an SLO without labels", async () => {
      await save({ labels: [] });

      for (const row of insertedRows) {
        expect(row["attributeKeys"]).toEqual(["projectId", "sloId", "sloName"]);
      }
    });

    test("gives each row its own attribute objects, so mutating one row cannot rewrite the others", async () => {
      await save();

      const first: JSONObject = insertedRows[0]!;
      const second: JSONObject = insertedRows[1]!;

      expect(first["attributes"]).not.toBe(second["attributes"]);
      expect(first["attributeKeys"]).not.toBe(second["attributeKeys"]);
    });
  });

  describe("readings that are not written", () => {
    test.each([
      ["null", null],
      ["undefined", undefined],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["-Infinity", -Infinity],
    ])(
      "a %s burn rate is skipped, never written as 0, and the other series still land",
      async (_name: string, value: number | null | undefined) => {
        await save({
          values: { ...FULL_VALUES, [SloMetricType.BurnRate]: value },
        });

        expect(namesWritten()).not.toContain(SloMetricType.BurnRate);
        expect(namesWritten()).toHaveLength(
          SloMetricTypeUtil.getAll().length - 1,
        );
        expect(insertCalls).toBe(1);
      },
    );

    test("a reading the caller did not pass at all is simply absent", async () => {
      await save({ values: { [SloMetricType.SliPercent]: 100 } });

      expect(namesWritten()).toEqual([SloMetricType.SliPercent]);
    });

    test("an evaluation with no finite reading inserts nothing, reads no config and registers no name", async () => {
      await save({
        values: {
          [SloMetricType.SliPercent]: NaN,
          [SloMetricType.Status]: null,
        },
      });

      expect(insertCalls).toBe(0);
      expect(indexedMaps).toHaveLength(0);
      expect(GlobalConfigService.findOneBy).not.toHaveBeenCalled();
    });

    test("ignores a key that is not an SLO metric, so only catalogued names can be written", async () => {
      await save({
        values: {
          ...FULL_VALUES,
          ["oneuptime.slo.made.up" as SloMetricType]: 5,
        },
      });

      expect(namesWritten()).toEqual(SloMetricTypeUtil.getAll());
    });
  });

  describe("retention", () => {
    test("defaults to 30 days when GlobalConfig has no value", async () => {
      await save();

      for (const row of insertedRows) {
        expect(row["retentionDate"]).toBe(expectedRetentionDate(30));
      }
    });

    test("follows GlobalConfig.monitorMetricRetentionInDays, the knob monitor metrics share", async () => {
      const config: GlobalConfig = new GlobalConfig();
      config.monitorMetricRetentionInDays = 7;
      jest
        .spyOn(GlobalConfigService, "findOneBy")
        .mockResolvedValue(config as never);

      await save();

      expect(rowNamed(SloMetricType.SliPercent)["retentionDate"]).toBe(
        expectedRetentionDate(7),
      );
    });

    test.each([0, -5])(
      "a configured retention of %s days falls back to 30 instead of expiring the row on arrival",
      async (days: number) => {
        const config: GlobalConfig = new GlobalConfig();
        config.monitorMetricRetentionInDays = days;
        jest
          .spyOn(GlobalConfigService, "findOneBy")
          .mockResolvedValue(config as never);

        await save();

        expect(rowNamed(SloMetricType.SliPercent)["retentionDate"]).toBe(
          expectedRetentionDate(30),
        );
      },
    );

    test("a GlobalConfig failure falls back to 30 days and still writes the evaluation", async () => {
      jest
        .spyOn(GlobalConfigService, "findOneBy")
        .mockRejectedValue(new Error("postgres down") as never);
      jest.spyOn(logger, "error").mockReturnValue(undefined as never);

      await save();

      expect(insertCalls).toBe(1);
      expect(rowNamed(SloMetricType.SliPercent)["retentionDate"]).toBe(
        expectedRetentionDate(30),
      );
    });

    test("reads GlobalConfig at most once per five minutes, however many SLOs evaluate", async () => {
      await save();
      await save();

      expect(GlobalConfigService.findOneBy).toHaveBeenCalledTimes(1);

      currentTime += 6 * 60 * 1000;
      await save();

      expect(GlobalConfigService.findOneBy).toHaveBeenCalledTimes(2);
    });

    test("never writes a history-length retention: SloHistory keeps 400 days, metric rows do not", async () => {
      await save();

      expect(rowNamed(SloMetricType.SliPercent)["retentionDate"]).not.toBe(
        expectedRetentionDate(400),
      );
    });
  });

  describe("the MetricType catalog", () => {
    test("registers every written name with the unit and description the SLO page charts with", async () => {
      await save();

      expect(indexedMaps).toHaveLength(1);

      const map: Dictionary<MetricType> = indexedMaps[0]!;

      expect(Object.keys(map).sort()).toEqual(
        [...SloMetricTypeUtil.getAll()].sort(),
      );

      for (const metricType of SloMetricTypeUtil.getAll()) {
        expect(map[metricType]!.name).toBe(metricType);
        expect(map[metricType]!.unit).toBe(
          SloMetricTypeUtil.getUnit(metricType),
        );
        expect(map[metricType]!.description).toBe(
          SloMetricTypeUtil.getDescription(metricType),
        );
      }
    });

    test("registers only the names it wrote", async () => {
      await save({
        values: {
          [SloMetricType.SliPercent]: 99.5,
          [SloMetricType.BurnRate]: NaN,
        },
      });

      expect(Object.keys(indexedMaps[0]!)).toEqual([SloMetricType.SliPercent]);
    });

    test("pins the units a dashboard legend is compared against", async () => {
      await save();

      const map: Dictionary<MetricType> = indexedMaps[0]!;

      expect(map[SloMetricType.SliPercent]!.unit).toBe("%");
      expect(map[SloMetricType.ErrorBudgetRemainingSeconds]!.unit).toBe(
        "seconds",
      );
      expect(map[SloMetricType.BurnRate]!.unit).toBe("x");
      expect(map[SloMetricType.Status]!.unit).toBe("");
    });

    test("a failing insert propagates to the worker's own try/catch and registers nothing", async () => {
      jest
        .spyOn(MetricService, "insertJsonRows")
        .mockRejectedValue(new Error("clickhouse down") as never);

      await expect(save()).rejects.toThrow("clickhouse down");
      expect(indexedMaps).toHaveLength(0);
    });

    test("a failing catalog write is logged, never thrown - the rows are already stored", async () => {
      jest
        .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
        .mockRejectedValue(new Error("redis down") as never);
      jest.spyOn(logger, "error").mockReturnValue(undefined as never);

      await expect(save()).resolves.toBeUndefined();

      // The .catch handler runs on a later microtask than the resolved save.
      await Promise.resolve();
      await Promise.resolve();

      expect(insertCalls).toBe(1);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("read routing", () => {
    test.each(SloMetricTypeUtil.getAll())(
      "%s is read from MetricItemV3, where it is written - not from the mutable table",
      (metricType: SloMetricType) => {
        expect(MutableMetricService.isMutableMetricName(metricType)).toBe(
          false,
        );
      },
    );
  });
});
