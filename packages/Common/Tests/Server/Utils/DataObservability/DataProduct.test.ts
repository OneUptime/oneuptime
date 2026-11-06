import { describe, expect, test } from "@jest/globals";
import {
  DataProductFreshness,
  DataProductSla,
  DataProductStatus,
  formatTimeOfDay,
  getDataProductFreshness,
  getDataProductSlaError,
  getLateAt,
  getLatestDeadline,
  isTableLate,
  parseTimeOfDay,
  readDataProductSla,
} from "../../../../Types/DataObservability/DataProductFreshness";
import {
  formatDataAsOf,
  getDataProductBadgeText,
  renderDataProductBadge,
} from "../../../../Types/DataObservability/DataProductBadge";
import {
  DataProductAttribute,
  DataProductMetricName,
} from "../../../../Types/DataObservability/DataProductMetric";
import { buildDataProductMonitorStep } from "../../../../Types/Monitor/DataProductMonitorStep";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { JSONObject } from "../../../../Types/JSON";
import {
  buildDataProductMetricRow,
  planDataProductUpdate,
} from "../../../../Server/Utils/DataObservability/DataProductCheck";
import { getDataProductMonitorName } from "../../../../Server/Utils/DataObservability/DataProductSync";

/*
 * A DATA PRODUCT: TABLES SOMEONE RELIES ON, AND A PROMISE ABOUT THEM.
 *
 * Its SLA - fresh by a time of day, within a maximum age, or both - says
 * when each table is late; the product is late when any is, and its data is
 * as of the oldest last change. Its monitor is Degraded while a table is
 * late, its row is written only when something changed, and its badge says
 * what its data is as of in words as well as colour.
 */

const BY_SEVEN: DataProductSla = {
  freshByMinuteOfDay: 7 * 60,
  maxDataAgeInMinutes: null,
};
const WITHIN_TWO_HOURS: DataProductSla = {
  freshByMinuteOfDay: null,
  maxDataAgeInMinutes: 120,
};

function at(text: string): Date {
  return new Date(text);
}

describe("a time of day", () => {
  test("is read as HH:MM, and written back the same way", () => {
    expect(parseTimeOfDay("07:00")).toBe(420);
    expect(parseTimeOfDay("7:05")).toBe(425);
    expect(parseTimeOfDay(" 23:59 ")).toBe(1439);
    expect(parseTimeOfDay("24:00")).toBe(null);
    expect(parseTimeOfDay("7am")).toBe(null);
    expect(parseTimeOfDay(420)).toBe(null);
    expect(formatTimeOfDay(425)).toBe("07:05");
  });

  test("its latest deadline is today's once it has passed, else yesterday's", () => {
    expect(getLatestDeadline(at("2026-11-03T08:00:00Z"), 420)).toEqual(
      at("2026-11-03T07:00:00Z"),
    );
    expect(getLatestDeadline(at("2026-11-03T03:00:00Z"), 420)).toEqual(
      at("2026-11-02T07:00:00Z"),
    );
  });
});

describe("fresh by a time of day", () => {
  test("a table must change each day by the deadline; until then yesterday's load stands", () => {
    const changed: Date = at("2026-11-02T06:30:00Z");

    expect(getLateAt({ lastChangedAt: changed, sla: BY_SEVEN })).toEqual(
      at("2026-11-03T07:00:00Z"),
    );
    expect(
      isTableLate({
        lastChangedAt: changed,
        now: at("2026-11-03T03:00:00Z"),
        sla: BY_SEVEN,
      }),
    ).toBe(false);
    expect(
      isTableLate({
        lastChangedAt: changed,
        now: at("2026-11-03T07:00:00Z"),
        sla: BY_SEVEN,
      }),
    ).toBe(true);
  });

  test("a load that is always half an hour late is late every day for that half hour", () => {
    // Yesterday's load landed at 07:30, after its own deadline.
    const changed: Date = at("2026-11-02T07:30:00Z");

    expect(
      isTableLate({
        lastChangedAt: changed,
        now: at("2026-11-03T07:10:00Z"),
        sla: BY_SEVEN,
      }),
    ).toBe(true);
    // Today's lands at 07:30: on time again until tomorrow's deadline.
    expect(
      isTableLate({
        lastChangedAt: at("2026-11-03T07:30:00Z"),
        now: at("2026-11-03T07:35:00Z"),
        sla: BY_SEVEN,
      }),
    ).toBe(false);
  });
});

describe("a maximum age", () => {
  test("a table is late once its last change is older than it", () => {
    const changed: Date = at("2026-11-03T10:00:00Z");

    expect(
      isTableLate({
        lastChangedAt: changed,
        now: at("2026-11-03T11:59:00Z"),
        sla: WITHIN_TWO_HOURS,
      }),
    ).toBe(false);
    expect(
      isTableLate({
        lastChangedAt: changed,
        now: at("2026-11-03T12:00:00Z"),
        sla: WITHIN_TWO_HOURS,
      }),
    ).toBe(true);
  });

  test("with a deadline too, whichever comes first", () => {
    expect(
      getLateAt({
        lastChangedAt: at("2026-11-03T06:00:00Z"),
        sla: { freshByMinuteOfDay: 420, maxDataAgeInMinutes: 120 },
      }),
    ).toEqual(at("2026-11-03T08:00:00Z"));
  });

  test("a table never seen changing says nothing either way", () => {
    expect(
      isTableLate({
        lastChangedAt: null,
        now: at("2026-11-03T12:00:00Z"),
        sla: WITHIN_TWO_HOURS,
      }),
    ).toBe(null);
  });
});

describe("a data product's freshness", () => {
  const now: Date = at("2026-11-03T12:00:00Z");

  test("late when any table is, its data as of the oldest last change", () => {
    const freshness: DataProductFreshness = getDataProductFreshness({
      tables: [
        { dataAssetId: "orders", lastChangedAt: at("2026-11-03T11:30:00Z") },
        { dataAssetId: "refunds", lastChangedAt: at("2026-11-03T09:00:00Z") },
        { dataAssetId: "new_table", lastChangedAt: null },
      ],
      now,
      sla: WITHIN_TWO_HOURS,
    });

    expect(freshness).toEqual({
      status: DataProductStatus.Late,
      lateDataAssetIds: ["refunds"],
      dataAsOf: at("2026-11-03T09:00:00Z"),
      unknownCount: 1,
    });
  });

  test("on time when none is; unknown while no table has been seen changing", () => {
    expect(
      getDataProductFreshness({
        tables: [
          { dataAssetId: "orders", lastChangedAt: at("2026-11-03T11:30:00Z") },
        ],
        now,
        sla: WITHIN_TWO_HOURS,
      }).status,
    ).toBe(DataProductStatus.OnTime);
    expect(
      getDataProductFreshness({
        tables: [{ dataAssetId: "orders", lastChangedAt: null }],
        now,
        sla: WITHIN_TWO_HOURS,
      }).status,
    ).toBe(DataProductStatus.Unknown);
    expect(
      getDataProductFreshness({ tables: [], now, sla: WITHIN_TWO_HOURS })
        .status,
    ).toBe(DataProductStatus.Unknown);
  });
});

describe("a data product's SLA, as saved", () => {
  test("needs a time of day, a maximum age, or both, each well formed", () => {
    expect(getDataProductSlaError({ freshByTimeOfDay: "07:00" })).toBe(null);
    expect(getDataProductSlaError({ maxDataAgeInMinutes: 120 })).toBe(null);
    expect(
      getDataProductSlaError({
        freshByTimeOfDay: "07:00",
        maxDataAgeInMinutes: "120",
        slaTargetPercentage: 99.9,
      }),
    ).toBe(null);
    expect(getDataProductSlaError({})).toContain("needs a freshness SLA");
    expect(
      getDataProductSlaError({
        freshByTimeOfDay: " ",
        maxDataAgeInMinutes: "",
      }),
    ).toContain("needs a freshness SLA");
    expect(getDataProductSlaError({ freshByTimeOfDay: "7am" })).toContain(
      "HH:MM",
    );
    expect(getDataProductSlaError({ maxDataAgeInMinutes: 5 })).toContain(
      "from 15",
    );
    expect(getDataProductSlaError({ maxDataAgeInMinutes: 90.5 })).toContain(
      "whole number",
    );
    expect(
      getDataProductSlaError({
        maxDataAgeInMinutes: 120,
        slaTargetPercentage: 100,
      }),
    ).toContain("percentage");
  });

  test("is read as minutes after midnight and an age in minutes, either empty", () => {
    expect(
      readDataProductSla({
        freshByTimeOfDay: "07:00",
        maxDataAgeInMinutes: null,
      }),
    ).toEqual({ freshByMinuteOfDay: 420, maxDataAgeInMinutes: null });
    expect(readDataProductSla({ maxDataAgeInMinutes: 120 })).toEqual({
      freshByMinuteOfDay: null,
      maxDataAgeInMinutes: 120,
    });
  });
});

describe("a data product's row", () => {
  const now: Date = at("2026-11-03T12:00:00Z");
  const onTime: DataProductFreshness = {
    status: DataProductStatus.OnTime,
    lateDataAssetIds: [],
    dataAsOf: at("2026-11-03T11:00:00Z"),
    unknownCount: 0,
  };

  test("is written when its status changes, with when it changed", () => {
    expect(
      planDataProductUpdate({
        product: {
          status: DataProductStatus.Late,
          lateTableCount: 1,
          lateDataAssetIds: ["orders"],
          dataAsOf: at("2026-11-03T08:00:00Z"),
          statusCheckedAt: at("2026-11-03T11:55:00Z"),
        },
        freshness: onTime,
        now,
      }),
    ).toEqual({
      status: DataProductStatus.OnTime,
      lateTableCount: 0,
      lateDataAssetIds: [],
      dataAsOf: at("2026-11-03T11:00:00Z"),
      statusCheckedAt: now,
      statusChangedAt: now,
    });
  });

  test("is left alone when nothing changed but the time it was checked, until an hour has passed", () => {
    const unchanged: {
      status: DataProductStatus;
      lateTableCount: number;
      lateDataAssetIds: Array<string>;
      dataAsOf: Date;
    } = {
      status: DataProductStatus.OnTime,
      lateTableCount: 0,
      lateDataAssetIds: [],
      dataAsOf: at("2026-11-03T11:00:00Z"),
    };

    expect(
      planDataProductUpdate({
        product: { ...unchanged, statusCheckedAt: at("2026-11-03T11:55:00Z") },
        freshness: onTime,
        now,
      }),
    ).toBe(null);
    expect(
      planDataProductUpdate({
        product: { ...unchanged, statusCheckedAt: at("2026-11-03T10:30:00Z") },
        freshness: onTime,
        now,
      })?.["statusChangedAt"],
    ).toBeUndefined();
  });
});

describe("a data product's metrics", () => {
  test("are tagged with the product, OneUptime's own operational data", () => {
    const productId: ObjectID = new ObjectID(
      "11111111-1111-4111-8111-111111111111",
    );
    const row: JSONObject = buildDataProductMetricRow({
      projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      dataProductId: productId,
      productName: "Revenue dashboard",
      metricName: DataProductMetricName.LateTables,
      value: 2,
      at: at("2026-11-03T12:00:00Z"),
      retentionDays: 15,
    });

    expect(row["name"]).toBe("oneuptime.data.product.late_tables");
    expect(row["primaryEntityType"]).toBe(ServiceType.DataProduct);
    expect(row["primaryEntityId"]).toBe(productId.toString());
    expect(row["value"]).toBe(2);
    expect(row["attributes"]).toEqual({
      [DataProductAttribute.ProductId]: productId.toString(),
      [DataProductAttribute.ProductName]: "Revenue dashboard",
    });
  });
});

describe("a data product's monitor", () => {
  const step: MonitorStep = buildDataProductMonitorStep({
    dataProductId: "11111111-1111-4111-8111-111111111111",
    productName: "Revenue dashboard",
    monitorName: getDataProductMonitorName("Revenue dashboard"),
    onlineMonitorStatusId: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    degradedMonitorStatusId: new ObjectID(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ),
    defaultIncidentSeverityId: new ObjectID(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ),
    defaultAlertSeverityId: new ObjectID(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ),
  });
  const json: JSONObject = JSON.parse(JSON.stringify(step.toJSON()));
  const text: string = JSON.stringify(json);

  test("reads the product's late tables, over two checks", () => {
    expect(getDataProductMonitorName("Revenue dashboard")).toBe(
      "Revenue dashboard - Data Product",
    );
    expect(text).toContain(DataProductMetricName.LateTables);
    expect(text).toContain("11111111-1111-4111-8111-111111111111");
    expect(text).toContain(RollingTime.Past10Minutes);
  });

  test("is Degraded with an incident subscribers hear of while a table is late, Operational once none is", () => {
    const criteria: Array<JSONObject> = (
      step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray || []
    ).map((instance: { data?: unknown }) => {
      return JSON.parse(JSON.stringify(instance.data)) as JSONObject;
    });
    const unhealthy: JSONObject = criteria[0]!;
    const healthy: JSONObject = criteria[1]!;

    expect(JSON.stringify(unhealthy["monitorStatusId"])).toContain(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(unhealthy["createIncidents"]).toBe(true);
    expect(unhealthy["createAlerts"]).toBe(true);
    expect(JSON.stringify(unhealthy["filters"])).toContain(
      FilterType.GreaterThan,
    );
    expect(JSON.stringify(healthy["monitorStatusId"])).toContain(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });
});

describe("a data product's badge", () => {
  test("says what the data is as of, in UTC, and 'late' as well as amber", () => {
    const asOf: Date = at("2026-11-03T07:12:00Z");

    expect(formatDataAsOf(asOf)).toBe("Nov 3, 07:12 UTC");
    expect(
      getDataProductBadgeText({
        status: DataProductStatus.OnTime,
        dataAsOf: asOf,
      }),
    ).toBe("Nov 3, 07:12 UTC");
    expect(
      getDataProductBadgeText({
        status: DataProductStatus.Late,
        dataAsOf: asOf,
      }),
    ).toBe("Nov 3, 07:12 UTC - late");
    expect(
      getDataProductBadgeText({
        status: DataProductStatus.Unknown,
        dataAsOf: null,
      }),
    ).toBe("unknown");

    const svg: string = renderDataProductBadge({
      status: DataProductStatus.Late,
      dataAsOf: asOf,
    });

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("data as of");
    expect(svg).toContain("#d97706");
    expect(svg).toContain('aria-label="data as of: Nov 3, 07:12 UTC - late"');
  });
});
