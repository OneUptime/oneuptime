import {
  XcpNgNormalizeResult,
  XcpNgVmStatusReading,
  getXcpNgDatapointIdentity,
  isXcpNgVmStoppedAfterRunning,
  normalizeXcpNgEnvelope,
  readXcpNgVmStatuses,
} from "../../../../Server/Utils/Telemetry/XcpNgSeriesNormalizer";
import {
  XCP_NG_DERIVED_SERIES_SCOPE_NAME,
  XCP_NG_ID_ATTRIBUTE,
  XCP_NG_RATE_TYPED_AS_COUNTER_SERIES,
  XCP_NG_SCOPE_ATTRIBUTE,
  XcpNgDerivedSeries,
  XcpNgScope,
} from "../../../../Types/XcpNg/XcpNgTelemetry";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  PRODUCTION_POOL_ID,
  SCRAPE_1_NOW_SECONDS,
  SCRAPE_2_NOW_SECONDS,
  UNNAMED_POOL_ID,
  getAttributeOf,
  getDatapoints,
  getResourceOfPool,
  parseOpenMetrics,
  readRecordedScrape,
  toAgentResourceMetrics,
} from "./XcpNgScrapeFixture";
import { describe, expect, test } from "@jest/globals";

/*
 * XcpNgSeriesNormalizer on the recorded scrape: the counter trap's safety
 * net, the xcp_ng.scope / xcp_ng.id stamps on every datapoint, and the 0/1
 * health series derived from Xen Orchestra's status labels.
 */

const HOST_PROD1: string = "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d";
const HOST_PROD2: string = "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7";
const HOST_PROD3: string = "f0e1d2c3-b4a5-4968-8776-655443322110";
const VM_WEB01: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const VM_APP02: string = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
const VM_WIN03: string = "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a";
const SR_NFS: string = "1d2c3b4a-5e6f-4789-9abc-def012345678";
const VDI_WEB01: string = "aa11bb22-cc33-4d44-8e55-ff6677889900";

function poolEnvelope(
  scrape: 1 | 2,
  poolId: string,
  options: { rateSeriesAsSums?: boolean; staleSeries?: Array<string> } = {},
): JSONObject {
  return getResourceOfPool(
    toAgentResourceMetrics(parseOpenMetrics(readRecordedScrape(scrape)), {
      scrapeSeconds: scrape === 1 ? SCRAPE_1_NOW_SECONDS : SCRAPE_2_NOW_SECONDS,
      rateSeriesAsSums: options.rateSeriesAsSums,
      staleSeries: options.staleSeries,
    }),
    poolId,
  );
}

function derivedValue(
  envelope: JSONObject,
  metricName: string,
  uuid: string,
): number | undefined {
  const found: { datapoint: JSONObject } | undefined = getDatapoints(
    envelope,
  ).find((entry: { metricName: string; datapoint: JSONObject }) => {
    return (
      entry.metricName === metricName &&
      getAttributeOf(entry.datapoint, "uuid") === uuid
    );
  });
  return found ? (found.datapoint["asDouble"] as number) : undefined;
}

function derivedScopes(envelope: JSONObject): Array<JSONObject> {
  return ((envelope["scopeMetrics"] as JSONArray) || []).filter(
    (scopeMetric: unknown) => {
      return (
        ((scopeMetric as JSONObject)["scope"] as JSONObject)?.["name"] ===
        XCP_NG_DERIVED_SERIES_SCOPE_NAME
      );
    },
  ) as Array<JSONObject>;
}

describe("XcpNgSeriesNormalizer", () => {
  describe("the counter trap's safety net", () => {
    test("the eight rate series arriving as cumulative sums become gauges with their values untouched", () => {
      const envelope: JSONObject = poolEnvelope(1, PRODUCTION_POOL_ID, {
        rateSeriesAsSums: true,
      });
      const before: Map<string, Array<number>> = new Map();
      for (const { metricName, datapoint } of getDatapoints(envelope)) {
        if (XCP_NG_RATE_TYPED_AS_COUNTER_SERIES.includes(metricName)) {
          before.set(metricName, [
            ...(before.get(metricName) || []),
            datapoint["asDouble"] as number,
          ]);
        }
      }
      expect(before.size).toBe(8);

      const result: XcpNgNormalizeResult = normalizeXcpNgEnvelope({
        envelope,
        poolIdentifier: PRODUCTION_POOL_ID,
        ranRecentlyVmUuids: new Set(),
      });
      expect(result.convertedRateSums).toBe(8);

      for (const { metricName, datapoint, metric } of getDatapoints(envelope)) {
        if (!XCP_NG_RATE_TYPED_AS_COUNTER_SERIES.includes(metricName)) {
          continue;
        }
        expect(metric["sum"]).toBeUndefined();
        expect(metric["gauge"]).toBeDefined();
        expect(before.get(metricName)).toContain(datapoint["asDouble"]);
      }
    });

    test("the agent's gauges are left as they are", () => {
      const envelope: JSONObject = poolEnvelope(1, PRODUCTION_POOL_ID);
      expect(
        normalizeXcpNgEnvelope({
          envelope,
          poolIdentifier: PRODUCTION_POOL_ID,
          ranRecentlyVmUuids: new Set(),
        }).convertedRateSums,
      ).toBe(0);
    });

    test("a sum that is not one of the eight stays a sum", () => {
      const envelope: JSONObject = {
        scopeMetrics: [
          {
            metrics: [
              {
                name: "xcp_host_cpu_average",
                sum: { dataPoints: [{ attributes: [], asDouble: 1 }] },
              },
            ],
          },
        ],
      };
      expect(
        normalizeXcpNgEnvelope({
          envelope,
          poolIdentifier: PRODUCTION_POOL_ID,
          ranRecentlyVmUuids: new Set(),
        }).convertedRateSums,
      ).toBe(0);
      const metric: JSONObject = (
        ((envelope["scopeMetrics"] as JSONArray)[0] as JSONObject)[
          "metrics"
        ] as JSONArray
      )[0] as JSONObject;
      expect(metric["sum"]).toBeDefined();
    });

    test("a rate the scrape split in two (both gauge and sum) is left alone", () => {
      const envelope: JSONObject = {
        scopeMetrics: [
          {
            metrics: [
              {
                name: "xcp_vm_disk_read_bytes_total",
                gauge: { dataPoints: [] },
                sum: { dataPoints: [] },
              },
            ],
          },
        ],
      };
      expect(
        normalizeXcpNgEnvelope({
          envelope,
          poolIdentifier: PRODUCTION_POOL_ID,
          ranRecentlyVmUuids: new Set(),
        }).convertedRateSums,
      ).toBe(0);
    });
  });

  describe("one way to name an object", () => {
    const envelope: JSONObject = poolEnvelope(1, PRODUCTION_POOL_ID);
    normalizeXcpNgEnvelope({
      envelope,
      poolIdentifier: PRODUCTION_POOL_ID,
      ranRecentlyVmUuids: new Set(),
    });

    test("every datapoint carries xcp_ng.scope and xcp_ng.id", () => {
      for (const { datapoint, metricName } of getDatapoints(envelope)) {
        expect([
          metricName,
          getAttributeOf(datapoint, XCP_NG_SCOPE_ATTRIBUTE),
        ]).toEqual([metricName, expect.any(String)]);
        expect([
          metricName,
          getAttributeOf(datapoint, XCP_NG_ID_ATTRIBUTE),
        ]).toEqual([metricName, expect.any(String)]);
      }
    });

    test.each([
      ["xcp_pool_connected", XcpNgScope.Pool, PRODUCTION_POOL_ID],
      ["xcp_host_status", XcpNgScope.Host, HOST_PROD1],
      ["xcp_host_cpu_average", XcpNgScope.Host, HOST_PROD1],
      ["xcp_vm_status", XcpNgScope.VM, VM_WEB01],
      ["xcp_vm_cpu_usage", XcpNgScope.VM, VM_WEB01],
      ["xcp_sr_physical_size_bytes", XcpNgScope.StorageRepository, SR_NFS],
      ["xcp_vdi_virtual_size_bytes", XcpNgScope.VDI, VDI_WEB01],
    ])(
      "%s is stamped %s",
      (metricName: string, scope: XcpNgScope, id: string) => {
        const points: Array<{ datapoint: JSONObject }> = getDatapoints(
          envelope,
        ).filter((entry: { metricName: string }) => {
          return entry.metricName === metricName;
        });
        expect(points.length).toBeGreaterThan(0);
        for (const { datapoint } of points) {
          expect(getAttributeOf(datapoint, XCP_NG_SCOPE_ATTRIBUTE)).toBe(scope);
        }
        expect(
          points.some((entry: { datapoint: JSONObject }) => {
            return getAttributeOf(entry.datapoint, XCP_NG_ID_ATTRIBUTE) === id;
          }),
        ).toBe(true);
      },
    );

    test("a host's disk series per storage repository is the host's, by its uuid", () => {
      const point: { datapoint: JSONObject } | undefined = getDatapoints(
        envelope,
      ).find((entry: { metricName: string }) => {
        return entry.metricName === "xcp_host_disk_latency_seconds";
      });
      expect(getAttributeOf(point!.datapoint, XCP_NG_SCOPE_ATTRIBUTE)).toBe(
        XcpNgScope.Host,
      );
      expect(getAttributeOf(point!.datapoint, "sr_uuid")).toBeDefined();
    });

    test("a second pass never stamps twice", () => {
      normalizeXcpNgEnvelope({
        envelope,
        poolIdentifier: PRODUCTION_POOL_ID,
        ranRecentlyVmUuids: new Set(),
      });
      for (const { datapoint } of getDatapoints(envelope)) {
        const keys: Array<string> = (
          (datapoint["attributes"] as JSONArray) || []
        ).map((a: unknown) => {
          return (a as JSONObject)["key"] as string;
        });
        expect(
          keys.filter((k: string) => {
            return k === XCP_NG_SCOPE_ATTRIBUTE;
          }),
        ).toHaveLength(1);
      }
    });

    test("getXcpNgDatapointIdentity: not an XCP-ng series, no identity", () => {
      expect(
        getXcpNgDatapointIdentity({
          metricName: "pve_up",
          datapoint: { attributes: [] },
          poolIdentifier: PRODUCTION_POOL_ID,
        }),
      ).toBe(null);
    });

    test("getXcpNgDatapointIdentity: a series missing its object's label has a scope and no id", () => {
      expect(
        getXcpNgDatapointIdentity({
          metricName: "xcp_host_cpu_average",
          datapoint: { attributes: [] },
          poolIdentifier: PRODUCTION_POOL_ID,
        }),
      ).toEqual({ scope: XcpNgScope.Host, id: null });
    });

    test("getXcpNgDatapointIdentity: an XOSTOR series is named by its storage repository", () => {
      expect(
        getXcpNgDatapointIdentity({
          metricName: "xcp_xostor_up",
          datapoint: {
            attributes: [
              { key: "sr_uuid", value: { stringValue: SR_NFS.toUpperCase() } },
            ],
          },
          poolIdentifier: PRODUCTION_POOL_ID,
        }),
      ).toEqual({ scope: XcpNgScope.Xostor, id: SR_NFS });
    });
  });

  describe("health as numbers", () => {
    test("hosts: running and enabled as 0/1, per host", () => {
      const envelope: JSONObject = poolEnvelope(1, PRODUCTION_POOL_ID);
      normalizeXcpNgEnvelope({
        envelope,
        poolIdentifier: PRODUCTION_POOL_ID,
        ranRecentlyVmUuids: new Set(),
      });
      expect(
        derivedValue(envelope, XcpNgDerivedSeries.HostRunning, HOST_PROD1),
      ).toBe(1);
      expect(
        derivedValue(envelope, XcpNgDerivedSeries.HostRunning, HOST_PROD2),
      ).toBe(1);
      expect(
        derivedValue(envelope, XcpNgDerivedSeries.HostRunning, HOST_PROD3),
      ).toBe(0);
      expect(
        derivedValue(envelope, XcpNgDerivedSeries.HostEnabled, HOST_PROD1),
      ).toBe(1);
      expect(
        derivedValue(envelope, XcpNgDerivedSeries.HostEnabled, HOST_PROD2),
      ).toBe(0);
      expect(
        derivedValue(envelope, XcpNgDerivedSeries.HostEnabled, HOST_PROD3),
      ).toBe(1);
    });

    test("VMs: running as 0/1, control domains left out (they have no status series)", () => {
      const envelope: JSONObject = poolEnvelope(1, PRODUCTION_POOL_ID);
      normalizeXcpNgEnvelope({
        envelope,
        poolIdentifier: PRODUCTION_POOL_ID,
        ranRecentlyVmUuids: new Set(),
      });
      expect(
        derivedValue(envelope, XcpNgDerivedSeries.VmRunning, VM_WEB01),
      ).toBe(1);
      expect(
        derivedValue(envelope, XcpNgDerivedSeries.VmRunning, VM_APP02),
      ).toBe(0);
      expect(
        derivedValue(envelope, XcpNgDerivedSeries.VmRunning, VM_WIN03),
      ).toBe(0);
      expect(
        derivedValue(
          envelope,
          XcpNgDerivedSeries.VmRunning,
          "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e",
        ),
      ).toBeUndefined();
    });

    test("a VM halted after it ran in the last day reads 1, the rest 0", () => {
      const envelope: JSONObject = poolEnvelope(2, PRODUCTION_POOL_ID);
      normalizeXcpNgEnvelope({
        envelope,
        poolIdentifier: PRODUCTION_POOL_ID,
        // web-01 ran a minute ago; win-03 too, but it is suspended.
        ranRecentlyVmUuids: new Set([VM_WEB01, VM_WIN03]),
      });
      expect(
        derivedValue(
          envelope,
          XcpNgDerivedSeries.VmStoppedAfterRunning,
          VM_WEB01,
        ),
      ).toBe(1);
      expect(
        derivedValue(
          envelope,
          XcpNgDerivedSeries.VmStoppedAfterRunning,
          VM_WIN03,
        ),
      ).toBe(0);
      expect(
        derivedValue(
          envelope,
          XcpNgDerivedSeries.VmStoppedAfterRunning,
          VM_APP02,
        ),
      ).toBe(0);
    });

    test("a VM halted that nobody saw running in the last day reads 0", () => {
      const envelope: JSONObject = poolEnvelope(1, PRODUCTION_POOL_ID);
      normalizeXcpNgEnvelope({
        envelope,
        poolIdentifier: PRODUCTION_POOL_ID,
        ranRecentlyVmUuids: new Set(),
      });
      expect(
        derivedValue(
          envelope,
          XcpNgDerivedSeries.VmStoppedAfterRunning,
          VM_APP02,
        ),
      ).toBe(0);
    });

    test("derived series carry the status labels but not the state ones, and the identity stamps", () => {
      const envelope: JSONObject = poolEnvelope(1, PRODUCTION_POOL_ID);
      normalizeXcpNgEnvelope({
        envelope,
        poolIdentifier: PRODUCTION_POOL_ID,
        ranRecentlyVmUuids: new Set(),
      });
      const point: { datapoint: JSONObject } | undefined = getDatapoints(
        envelope,
      ).find((entry: { metricName: string; datapoint: JSONObject }) => {
        return (
          entry.metricName === XcpNgDerivedSeries.HostRunning &&
          getAttributeOf(entry.datapoint, "uuid") === HOST_PROD1
        );
      });
      expect(getAttributeOf(point!.datapoint, "power_state")).toBeUndefined();
      expect(getAttributeOf(point!.datapoint, "enabled")).toBeUndefined();
      expect(getAttributeOf(point!.datapoint, "host_name")).toBe("xcp-prod-01");
      expect(getAttributeOf(point!.datapoint, "tags")).toBe("rack-a");
      expect(getAttributeOf(point!.datapoint, XCP_NG_SCOPE_ATTRIBUTE)).toBe(
        XcpNgScope.Host,
      );
      expect(getAttributeOf(point!.datapoint, XCP_NG_ID_ATTRIBUTE)).toBe(
        HOST_PROD1,
      );
      expect(point!.datapoint["timeUnixNano"]).toBe(
        `${SCRAPE_1_NOW_SECONDS}000000000`,
      );
    });

    test("the derived series are one scope of their own, appended once", () => {
      const envelope: JSONObject = poolEnvelope(1, PRODUCTION_POOL_ID);
      const result: XcpNgNormalizeResult = normalizeXcpNgEnvelope({
        envelope,
        poolIdentifier: PRODUCTION_POOL_ID,
        ranRecentlyVmUuids: new Set(),
      });
      const scopes: Array<JSONObject> = derivedScopes(envelope);
      expect(scopes).toHaveLength(1);
      const names: Array<string> = (
        (scopes[0]!["metrics"] as JSONArray) || []
      ).map((m: unknown) => {
        return (m as JSONObject)["name"] as string;
      });
      expect(names.sort()).toEqual(
        [
          XcpNgDerivedSeries.HostEnabled,
          XcpNgDerivedSeries.HostRunning,
          XcpNgDerivedSeries.VmRunning,
          XcpNgDerivedSeries.VmStoppedAfterRunning,
        ].sort(),
      );
      // 3 hosts x 2 + 4 VMs x 2.
      expect(result.derivedDatapoints).toBe(14);
    });

    test("a pool with one host and one VM derives theirs", () => {
      const envelope: JSONObject = poolEnvelope(1, UNNAMED_POOL_ID);
      const result: XcpNgNormalizeResult = normalizeXcpNgEnvelope({
        envelope,
        poolIdentifier: UNNAMED_POOL_ID,
        ranRecentlyVmUuids: new Set(),
      });
      expect(result.derivedDatapoints).toBe(4);
    });

    test("a block with no status series derives nothing and appends no scope", () => {
      const envelope: JSONObject = {
        scopeMetrics: [
          {
            metrics: [
              {
                name: "xcp_host_cpu_average",
                gauge: {
                  dataPoints: [
                    {
                      attributes: [
                        { key: "uuid", value: { stringValue: HOST_PROD1 } },
                      ],
                      asDouble: 0.5,
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      expect(
        normalizeXcpNgEnvelope({
          envelope,
          poolIdentifier: PRODUCTION_POOL_ID,
          ranRecentlyVmUuids: new Set(),
        }).derivedDatapoints,
      ).toBe(0);
      expect(derivedScopes(envelope)).toHaveLength(0);
    });

    test("a status series that just disappeared (a deleted VM, a removed host) derives nothing", () => {
      const envelope: JSONObject = poolEnvelope(1, PRODUCTION_POOL_ID, {
        staleSeries: ["xcp_vm_status", "xcp_host_status"],
      });
      const result: XcpNgNormalizeResult = normalizeXcpNgEnvelope({
        envelope,
        poolIdentifier: PRODUCTION_POOL_ID,
        ranRecentlyVmUuids: new Set([VM_WEB01, VM_APP02]),
      });
      expect(result.derivedDatapoints).toBe(0);
      expect(derivedScopes(envelope)).toHaveLength(0);
    });

    test("an envelope without scopeMetrics gets one only when something is derived", () => {
      const empty: JSONObject = {};
      normalizeXcpNgEnvelope({
        envelope: empty,
        poolIdentifier: PRODUCTION_POOL_ID,
        ranRecentlyVmUuids: new Set(),
      });
      expect(empty["scopeMetrics"]).toBeUndefined();
    });
  });

  describe("readXcpNgVmStatuses", () => {
    test("every VM's status in the block, lower-case UUIDs", () => {
      const readings: Array<XcpNgVmStatusReading> = readXcpNgVmStatuses(
        poolEnvelope(2, PRODUCTION_POOL_ID),
      );
      expect(readings).toHaveLength(4);
      expect(
        readings.find((r: XcpNgVmStatusReading) => {
          return r.uuid === VM_WEB01;
        })?.powerState,
      ).toBe("Halted");
      for (const reading of readings) {
        expect(reading.uuid).toBe(reading.uuid.toLowerCase());
      }
    });

    test("staleness markers are not statuses", () => {
      expect(
        readXcpNgVmStatuses(
          poolEnvelope(1, PRODUCTION_POOL_ID, {
            staleSeries: ["xcp_vm_status"],
          }),
        ),
      ).toEqual([]);
    });

    test("an envelope without metrics has no statuses", () => {
      expect(readXcpNgVmStatuses({})).toEqual([]);
      expect(readXcpNgVmStatuses({ scopeMetrics: [{}] })).toEqual([]);
    });
  });

  describe("isXcpNgVmStoppedAfterRunning", () => {
    test.each([
      ["Halted", true, true],
      ["Paused", true, true],
      ["Suspended", true, false],
      ["Running", true, false],
      ["Halted", false, false],
      ["Paused", false, false],
      ["Something new", true, false],
    ])(
      "%s, ran recently %s -> %s",
      (powerState: string, ranRecently: boolean, expected: boolean) => {
        expect(isXcpNgVmStoppedAfterRunning({ powerState, ranRecently })).toBe(
          expected,
        );
      },
    );
  });
});
