import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import ObjectID from "../../../Types/ObjectID";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CEPH_LATEST_READINGS_LIMIT,
  CEPH_LATEST_WINDOW_MINUTES,
  CephHealthCheckReadings,
  CephPgStateReadings,
  loadCephHealthChecks,
  loadCephLatestPerLabel,
  loadCephPgStates,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephReadings";
import { getCephShortVersion } from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephResourceUtils";

/*
 * What the Ceph pages read from the cluster's metrics beside its inventory
 * (Pages/Ceph/Utils/CephReadings): the checks Ceph raises and each pool's
 * placement groups by state - the newest reading per series in the last 10
 * minutes. The Overview, the Pools list and a pool's page read them alike.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

interface MetricRequest {
  query: {
    name: string;
    projectId: string;
    time: InBetween<Date>;
    attributes: Record<string, string>;
  };
  limit: number;
  sort: Record<string, SortOrder>;
}

// AnalyticsModelAPI.getList spied on, as jest-mock's spyOn types it.
type GetListSpy = SpyInstance<
  (
    ...args: Parameters<typeof AnalyticsModelAPI.getList>
  ) => ReturnType<typeof AnalyticsModelAPI.getList>
>;

let requests: Array<MetricRequest> = [];
let series: Record<string, Array<Record<string, unknown>>> = {};

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

// Newest first, as the read asks for them.
function point(
  minutes: number,
  value: number,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return { time: minutesAgo(minutes), value: value, attributes: attributes };
}

beforeEach(() => {
  requests = [];
  series = {};
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  const spy: GetListSpy = jest.spyOn(AnalyticsModelAPI, "getList");
  spy.mockImplementation((...args: Array<unknown>) => {
    const request: MetricRequest = args[0] as MetricRequest;
    requests.push(request);
    const data: Array<Record<string, unknown>> =
      series[request.query.name] || [];
    return Promise.resolve({
      data: data,
      count: data.length,
    } as unknown) as ReturnType<typeof AnalyticsModelAPI.getList>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the newest reading per label", () => {
  test("reads the cluster's series of the last 10 minutes, newest first, and keeps each label's first", async () => {
    series["ceph_pg_degraded"] = [
      point(1, 4, { pool_id: "1" }),
      point(1, 0, { pool_id: "2" }),
      point(2, 9, { pool_id: "1" }),
      point(1, 3, {}),
    ];
    const latest: Map<string, { value: number }> = await loadCephLatestPerLabel(
      {
        clusterName: "ceph-prod",
        metricName: "ceph_pg_degraded",
        labelAttribute: "pool_id",
      },
    );

    expect(
      Array.from(latest.entries()).map(
        ([key, entry]: [string, { value: number }]) => {
          return [key, entry.value];
        },
      ),
    ).toEqual([
      ["1", 4],
      ["2", 0],
    ]);

    const request: MetricRequest = requests[0]!;
    expect(request.query.name).toBe("ceph_pg_degraded");
    expect(request.query.projectId).toBe(PROJECT_ID);
    expect(request.query.attributes).toEqual({
      "resource.ceph.cluster.name": "ceph-prod",
    });
    expect(request.sort).toEqual({ time: SortOrder.Descending });
    expect(request.limit).toBe(CEPH_LATEST_READINGS_LIMIT);
    expect(
      (request.query.time.endValue.getTime() -
        request.query.time.startValue.getTime()) /
        60000,
    ).toBe(CEPH_LATEST_WINDOW_MINUTES);
  });
});

describe("the checks Ceph raised", () => {
  test("are the checks whose newest reading is 1, with Ceph's severity", async () => {
    series["ceph_health_detail"] = [
      point(1, 1, { name: "OSD_DOWN", severity: "HEALTH_WARN" }),
      point(1, 0, { name: "MON_DOWN", severity: "HEALTH_WARN" }),
      point(1, 1, { name: "PG_DAMAGED", severity: "HEALTH_ERR" }),
      // An older reading of a check that has cleared since.
      point(5, 1, { name: "MON_DOWN", severity: "HEALTH_WARN" }),
    ];
    const readings: CephHealthCheckReadings =
      await loadCephHealthChecks("ceph-prod");

    expect(readings.isExported).toBe(true);
    expect(readings.checks).toEqual([
      { name: "OSD_DOWN", severity: "HEALTH_WARN" },
      { name: "PG_DAMAGED", severity: "HEALTH_ERR" },
    ]);
  });

  test("a Ceph that exports none (older than Quincy) says so", async () => {
    const readings: CephHealthCheckReadings =
      await loadCephHealthChecks("ceph-prod");
    expect(readings).toEqual({ checks: [], isExported: false });
  });
});

describe("each pool's placement groups", () => {
  test("are its newest counts per state, and the cluster's are their sums", async () => {
    series["ceph_pg_total"] = [
      point(1, 128, { pool_id: "1" }),
      point(1, 64, { pool_id: "2" }),
    ];
    series["ceph_pg_active"] = [
      point(1, 128, { pool_id: "1" }),
      point(1, 60, { pool_id: "2" }),
    ];
    series["ceph_pg_clean"] = [
      point(1, 120, { pool_id: "1" }),
      point(1, 60, { pool_id: "2" }),
    ];
    series["ceph_pg_degraded"] = [point(1, 8, { pool_id: "1" })];
    const readings: CephPgStateReadings = await loadCephPgStates("ceph-prod");

    expect(readings.byPool.get("1")).toEqual({
      total: 128,
      active: 128,
      clean: 120,
      degraded: 8,
      undersized: null,
    });
    expect(readings.byPool.get("2")).toEqual({
      total: 64,
      active: 60,
      clean: 60,
      degraded: null,
      undersized: null,
    });
    expect(readings.totals).toEqual({
      total: 192,
      active: 188,
      clean: 180,
      degraded: 8,
      undersized: null,
    });
  });

  test("an older Ceph's cluster-wide counts are the totals, and no pool has states of its own", async () => {
    series["ceph_pg_total"] = [point(1, 256, {})];
    series["ceph_pg_active"] = [point(1, 250, {})];
    const readings: CephPgStateReadings = await loadCephPgStates("ceph-prod");

    expect(readings.byPool.size).toBe(0);
    expect(readings.totals).toEqual({
      total: 256,
      active: 250,
      clean: null,
      degraded: null,
      undersized: null,
    });
  });

  test("with nothing read, there are no totals", async () => {
    const readings: CephPgStateReadings = await loadCephPgStates("ceph-prod");
    expect(readings.totals).toBeNull();
  });
});

describe("a daemon's version", () => {
  /*
   * As Ceph's metadata writes it, the build's hash and all: on a phone the
   * whole string ran past the Overview hero's edge.
   */
  test("is its release and the release's name, not the build's hash", () => {
    expect(
      getCephShortVersion(
        "ceph version 18.2.4 (e7ad5345525c7aa95470c26863873b581076945d) reef (stable)",
      ),
    ).toBe("18.2.4 (reef)");
    expect(
      getCephShortVersion(
        "ceph version 17.2.7 (b12291d110049b2f35e32e0de30d70e9a4c060d2) quincy (stable)",
      ),
    ).toBe("17.2.7 (quincy)");
    expect(getCephShortVersion("ceph version 19.2.0")).toBe("19.2.0");
  });

  test("any other text is kept as it is", () => {
    expect(getCephShortVersion("18.2.4")).toBe("18.2.4");
    expect(getCephShortVersion("  custom-build  ")).toBe("custom-build");
  });
});
