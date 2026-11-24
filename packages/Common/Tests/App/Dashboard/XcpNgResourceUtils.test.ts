import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import XcpNgResource from "../../../Models/DatabaseModels/XcpNgResource";
import ObjectID from "../../../Types/ObjectID";
import { EMPTY_VALUE_MARK } from "../../../Types/EmptyValueMark";
import XcpNgResourceKind from "../../../Types/XcpNg/XcpNgResourceKind";
import { createTranslator, Translator } from "../../../Types/Translator";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

/*
 * The ground the XCP-ng pool pages stand on (Pages/XcpNg/Utils/
 * XcpNgResourceUtils): figures in the reader's digits, an object's name and
 * route, the filter that picks one object's series, the unit a chart draws
 * a catalog unit in - and the inventory reads (Components/XcpNg/
 * XcpNgInventoryReads), what they ask the API for.
 */

interface ListRequest {
  modelType: new () => { tableName?: string };
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  select: Record<string, boolean>;
  sort: Record<string, SortOrder>;
}

const mockRequests: Array<ListRequest> = [];
let mockRows: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: ListRequest): Promise<unknown> => {
        mockRequests.push(request);
        const Model: new () => { tableName?: string } = request.modelType;
        return Promise.resolve({
          data: mockRows.map((fields: Record<string, unknown>) => {
            return Object.assign(new Model(), fields);
          }),
          count: mockRows.length,
        });
      },
    },
  };
});

import {
  fetchXcpNgInventoryRow,
  fetchXcpNgInventoryRows,
  fetchXcpNgRowsOnHost,
  fetchXcpNgVirtualDisks,
} from "../../../../App/FeatureSet/Dashboard/src/Components/XcpNg/XcpNgInventoryReads";
import {
  XCP_NG_INVENTORY_SELECT,
  XCP_NG_METRIC_STALE_MS,
  XCP_NG_POOL_RESOURCE_ATTRIBUTE,
  externalIdFromRouteParam,
  formatXcpNgBytes,
  formatXcpNgBytesForChart,
  formatXcpNgLoad,
  formatXcpNgPercent,
  formatXcpNgUptime,
  formatXcpNgWatts,
  getXcpNgChartUnit,
  getXcpNgDisplayName,
  getXcpNgObjectAttributes,
  getXcpNgShortId,
  isXcpNgReadingFresh,
  routeParamFromExternalId,
  toXcpNgDate,
  toXcpNgNumber,
  xcpNgRatioToPercent,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/Utils/XcpNgResourceUtils";
import { getAllXcpNgMetrics } from "../../../Types/Monitor/XcpNgMetricCatalog";
import ValueFormatter from "../../../Utils/ValueFormatter";
import { XcpNgScope } from "../../../Types/XcpNg/XcpNgTelemetry";

const GIB: number = 1024 * 1024 * 1024;
const POOL_ID: ObjectID = new ObjectID("71000000-0000-4000-8000-000000000001");
const ENGLISH: Translator = createTranslator(undefined, "en");

beforeEach(() => {
  mockRequests.length = 0;
  mockRows = [];
});

describe("numbers and dates as a column holds them", () => {
  test("a number, a bigint's string, or nothing", () => {
    expect(toXcpNgNumber(5)).toBe(5);
    expect(toXcpNgNumber("214748364800")).toBe(214748364800);
    expect(toXcpNgNumber("")).toBeNull();
    expect(toXcpNgNumber(null)).toBeNull();
    expect(toXcpNgNumber(undefined)).toBeNull();
    expect(toXcpNgNumber("garbage")).toBeNull();
    expect(toXcpNgNumber(Infinity)).toBeNull();
  });

  test("a date, an ISO string off the wire, or nothing", () => {
    const at: Date = new Date("2026-11-24T12:00:00.000Z");
    expect(toXcpNgDate(at)).toBe(at);
    expect(toXcpNgDate("2026-11-24T12:00:00.000Z")?.getTime()).toBe(
      at.getTime(),
    );
    expect(toXcpNgDate("not a date")).toBeNull();
    expect(toXcpNgDate(null)).toBeNull();
    expect(toXcpNgDate("")).toBeNull();
  });

  test("a reading is fresh for 15 minutes, as a pool stays Connected", () => {
    const now: Date = new Date("2026-11-24T12:00:00.000Z");
    expect(XCP_NG_METRIC_STALE_MS).toBe(15 * 60 * 1000);
    expect(
      isXcpNgReadingFresh(
        { metricsUpdatedAt: new Date(now.getTime() - 14 * 60 * 1000) },
        now,
      ),
    ).toBe(true);
    expect(
      isXcpNgReadingFresh(
        { metricsUpdatedAt: new Date(now.getTime() - 16 * 60 * 1000) },
        now,
      ),
    ).toBe(false);
    expect(isXcpNgReadingFresh({ metricsUpdatedAt: undefined }, now)).toBe(
      false,
    );
  });
});

describe("figures in the reader's digits", () => {
  test("sizes in binary units, held to their unit; no reading is the empty mark", () => {
    expect(formatXcpNgBytes(36.2 * GIB)).toBe("36.2\u00A0GiB");
    expect(formatXcpNgBytes(512)).toBe("512\u00A0B");
    expect(formatXcpNgBytes(null)).toBe(EMPTY_VALUE_MARK);
    expect(formatXcpNgBytes(NaN)).toBe(EMPTY_VALUE_MARK);
    // A chart's axis gets English: the chart writes the reader's digits.
    expect(formatXcpNgBytesForChart(1536 * GIB)).toBe("1.5\u00A0TiB");
  });

  test("a share with one decimal; a load with two; power in whole watts", () => {
    expect(formatXcpNgPercent(85.44)).toBe("85.4%");
    expect(formatXcpNgPercent(85.44, 0)).toBe("85%");
    expect(formatXcpNgPercent(undefined)).toBe(EMPTY_VALUE_MARK);
    expect(formatXcpNgLoad(2.484)).toBe("2.48");
    expect(formatXcpNgLoad(null)).toBe(EMPTY_VALUE_MARK);
    expect(formatXcpNgWatts(241.4)).toBe("241\u00A0W");
    expect(formatXcpNgWatts(undefined)).toBe(EMPTY_VALUE_MARK);
  });

  test("an uptime in the reader's short units; nothing for none", () => {
    expect(formatXcpNgUptime(3 * 86400 + 4 * 3600, ENGLISH)).toBe("3d 4h");
    expect(formatXcpNgUptime(4 * 3600 + 12 * 60, ENGLISH)).toBe("4h 12m");
    expect(formatXcpNgUptime(12 * 60, ENGLISH)).toBe("12m");
    // Under a minute still says it runs.
    expect(formatXcpNgUptime(20, ENGLISH)).toBe("1m");
    expect(formatXcpNgUptime(0, ENGLISH)).toBe("");
    expect(formatXcpNgUptime(null, ENGLISH)).toBe("");
  });
});

describe("an object's name and route", () => {
  test("a UUID travels as one path segment, and comes back as it was", () => {
    const uuid: string = "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d";
    expect(routeParamFromExternalId(uuid)).toBe(uuid);
    expect(externalIdFromRouteParam(routeParamFromExternalId("a/b c"))).toBe(
      "a/b c",
    );
    // A malformed escape is read as written, never thrown.
    expect(externalIdFromRouteParam("%E0%A4%A")).toBe("%E0%A4%A");
  });

  test("Xen Orchestra's name, else the start of its UUID", () => {
    expect(
      getXcpNgDisplayName({ name: "web-01", externalId: "e8a5b2c1-x" }),
    ).toBe("web-01");
    expect(
      getXcpNgDisplayName({
        name: "  ",
        externalId: "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
      }),
    ).toBe("e8a5b2c1");
    expect(getXcpNgDisplayName(null, "AB12CD34-1111")).toBe("ab12cd34");
    expect(getXcpNgShortId(undefined)).toBe("");
  });
});

describe("the filter that picks one object's series", () => {
  test("the pool's UUID as stored, the object's kind and its UUID, as ingest stamps them", () => {
    expect(XCP_NG_POOL_RESOURCE_ATTRIBUTE).toBe("resource.xcp_ng.pool.id");
    expect(
      getXcpNgObjectAttributes({
        poolIdentifier: "b7569d99-30f8-178a-7d94-801de3e29b5b",
        scope: XcpNgScope.VM,
        externalId: "e8a5b2c1",
      }),
    ).toEqual({
      "resource.xcp_ng.pool.id": "b7569d99-30f8-178a-7d94-801de3e29b5b",
      "xcp_ng.scope": "vm",
      "xcp_ng.id": "e8a5b2c1",
    });
  });
});

describe("the unit a chart draws a catalog unit in", () => {
  test("a ratio as a percent, seconds as s, a count as none, a rate keeps its slash", () => {
    expect(getXcpNgChartUnit("ratio")).toBe("%");
    expect(getXcpNgChartUnit("seconds")).toBe("s");
    expect(getXcpNgChartUnit("count")).toBe("");
    expect(getXcpNgChartUnit(undefined)).toBe("");
    expect(getXcpNgChartUnit("")).toBe("");
    expect(getXcpNgChartUnit("bytes/s")).toBe("bytes/s");
    expect(getXcpNgChartUnit("ops/s")).toBe("ops/s");
    expect(getXcpNgChartUnit("W")).toBe("W");
    expect(getXcpNgChartUnit("{errors/s}")).toBe("{errors}/s");
    expect(xcpNgRatioToPercent(0.425)).toBeCloseTo(42.5);
  });

  test("every catalog unit becomes one the chart's formatter writes without braces or words", () => {
    for (const metric of getAllXcpNgMetrics()) {
      const unit: string = getXcpNgChartUnit(metric.unit);
      const written: string = ValueFormatter.formatValue(12, unit);
      expect({ metric: metric.id, written }).toEqual({
        metric: metric.id,
        written: expect.not.stringMatching(/[{}]/),
      });
    }
  });

  test("a per-second rate reads as one: bytes scale, errors keep their slash", () => {
    expect(ValueFormatter.formatValue(1500000, "bytes/s")).toMatch(/\/s$/);
    expect(ValueFormatter.formatValue(3, "{errors}/s")).toBe("3\u00A0errors/s");
  });
});

describe("the inventory reads", () => {
  test("a pool's rows, or one kind's, every column the pages read, by name", async () => {
    mockRows = [{ kind: "Host", externalId: "h1", name: "xcp-01" }];
    const rows: Array<XcpNgResource> = await fetchXcpNgInventoryRows({
      xcpNgPoolId: POOL_ID,
      kind: XcpNgResourceKind.Host,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBeInstanceOf(XcpNgResource);
    const request: ListRequest = mockRequests[0]!;
    expect(new request.modelType().tableName).toBe("XcpNgResource");
    expect(request.query).toEqual({ xcpNgPoolId: POOL_ID, kind: "Host" });
    expect(request.select).toBe(XCP_NG_INVENTORY_SELECT);
    expect(request.sort).toEqual({ name: SortOrder.Ascending });
    expect(request.limit).toBeGreaterThanOrEqual(1000);

    await fetchXcpNgInventoryRows({ xcpNgPoolId: POOL_ID });
    expect(mockRequests[1]!.query).toEqual({ xcpNgPoolId: POOL_ID });
  });

  test("the select holds every column a page, a list or the topology reads", () => {
    for (const column of [
      "kind",
      "externalId",
      "name",
      "powerState",
      "isUp",
      "isEnabled",
      "isControlDomain",
      "parentHostExternalId",
      "parentHostName",
      "storageRepositoryExternalId",
      "storageRepositoryName",
      "vmExternalId",
      "vmName",
      "uptimeSeconds",
      "lastRunningAt",
      "latestCpuPercent",
      "cpuCount",
      "runningVcpuCount",
      "loadAverage",
      "latestMemoryBytes",
      "maxMemoryBytes",
      "latestMemoryPercent",
      "latestDiskBytes",
      "maxDiskBytes",
      "virtualAllocationBytes",
      "srType",
      "contentType",
      "isShared",
      "powerWatts",
      "tags",
      "metricsUpdatedAt",
      "lastSeenAt",
    ]) {
      expect({ column, selected: XCP_NG_INVENTORY_SELECT[column] }).toEqual({
        column,
        selected: true,
      });
    }
  });

  test("one object by its UUID, or null when the pool no longer reports it", async () => {
    mockRows = [];
    expect(
      await fetchXcpNgInventoryRow({
        xcpNgPoolId: POOL_ID,
        kind: XcpNgResourceKind.VM,
        externalId: "vm-1",
      }),
    ).toBeNull();
    expect(mockRequests[0]!.query).toEqual({
      xcpNgPoolId: POOL_ID,
      kind: "VM",
      externalId: "vm-1",
    });
    expect(mockRequests[0]!.limit).toBe(1);

    mockRows = [{ kind: "VM", externalId: "vm-1", name: "web" }];
    expect(
      (
        await fetchXcpNgInventoryRow({
          xcpNgPoolId: POOL_ID,
          kind: XcpNgResourceKind.VM,
          externalId: "vm-1",
        })
      )?.name,
    ).toBe("web");
  });

  test("what one host holds: every row that names it as its host", async () => {
    await fetchXcpNgRowsOnHost({ xcpNgPoolId: POOL_ID, hostExternalId: "h1" });
    expect(mockRequests[0]!.query).toEqual({
      xcpNgPoolId: POOL_ID,
      parentHostExternalId: "h1",
    });
    // No host, no read.
    expect(
      await fetchXcpNgRowsOnHost({ xcpNgPoolId: POOL_ID, hostExternalId: "" }),
    ).toEqual([]);
    expect(mockRequests).toHaveLength(1);
  });

  test("a VM's virtual disks, or a storage repository's; neither named, no read", async () => {
    await fetchXcpNgVirtualDisks({ xcpNgPoolId: POOL_ID, vmExternalId: "v1" });
    expect(mockRequests[0]!.query).toEqual({
      xcpNgPoolId: POOL_ID,
      kind: "VDI",
      vmExternalId: "v1",
    });
    await fetchXcpNgVirtualDisks({
      xcpNgPoolId: POOL_ID,
      storageRepositoryExternalId: "s1",
    });
    expect(mockRequests[1]!.query).toEqual({
      xcpNgPoolId: POOL_ID,
      kind: "VDI",
      storageRepositoryExternalId: "s1",
    });
    expect(await fetchXcpNgVirtualDisks({ xcpNgPoolId: POOL_ID })).toEqual([]);
    expect(mockRequests).toHaveLength(2);
  });
});
