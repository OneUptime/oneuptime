import {
  POOL_PRODUCTION,
  POOL_UNNAMED,
  RECORDED_XO_HOST,
  SCRAPE_SECONDS,
  asTheProbeSendsIt,
  readAgentOtlp,
  readScrapeText,
} from "./Helpers/XcpNgFixtures";
import {
  OpenMetricsParseResult,
  OpenMetricsSample,
  parseOpenMetricsText,
} from "../../../Utils/XcpNg/OpenMetricsText";
import XcpNgOtlpBuilder, {
  XCP_NG_PROBE_SCOPE_NAME,
  XcpNgOtlpBuildResult,
} from "../../../Utils/XcpNg/XcpNgOtlpBuilder";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { XCP_NG_RATE_TYPED_AS_COUNTER_SERIES } from "Common/Types/XcpNg/XcpNgTelemetry";
import { describe, expect, it } from "@jest/globals";

/*
 * THE PARITY THE ISSUE ASKS FOR (#10996): "the probe sends the series
 * exactly as the XCP-ng Agent would, including the rate-as-counter fix, so
 * nothing downstream can tell the two apart."
 *
 * The probe reads the very scrapes #10995 recorded from a stand-in Xen
 * Orchestra, and what it builds is held equal - resource for resource,
 * metric for metric, datapoint for datapoint, attribute for attribute,
 * value for value - to what the agent's real collector (0.165.0, with the
 * shipped config) sent OneUptime for them. The only differences are the
 * ones the agent stamps and a probe must not: oneuptime.agent.version, and
 * xen_orchestra.name (the server stamps it, from the connection) - and the
 * scope, which nothing reads.
 */

const SCOPE: { name: string; version: string } = {
  name: XCP_NG_PROBE_SCOPE_NAME,
  version: "test",
};

function buildFromScrape(
  scrape: 1 | 2,
  previous?: Map<string, OpenMetricsSample>,
): XcpNgOtlpBuildResult {
  const parsed: OpenMetricsParseResult = parseOpenMetricsText(
    readScrapeText(scrape),
  );

  return XcpNgOtlpBuilder.build({
    samples: parsed.samples,
    scrapeTimeMs: SCRAPE_SECONDS[scrape] * 1000,
    target: { host: RECORDED_XO_HOST, port: 443 },
    scopeVersion: SCOPE.version,
    previousUntimedSeries: previous,
  });
}

function metricsOf(resource: JSONObject): Array<JSONObject> {
  return ((resource["scopeMetrics"] as JSONArray)[0] as JSONObject)[
    "metrics"
  ] as Array<JSONObject>;
}

function attributeOf(resource: JSONObject, key: string): unknown {
  const attribute: JSONObject | undefined = (
    (resource["resource"] as JSONObject)["attributes"] as Array<JSONObject>
  ).find((candidate: JSONObject): boolean => {
    return candidate["key"] === key;
  });

  return (attribute?.["value"] as JSONObject | undefined)?.["stringValue"];
}

describe("XCP-ng probe: what it sends is what the XCP-ng Agent sends", () => {
  for (const scrape of [1, 2] as const) {
    it(`scrape ${scrape}: equal to the agent's recorded export, but for what only the agent stamps`, () => {
      const built: XcpNgOtlpBuildResult = buildFromScrape(scrape);

      expect(built.resourceMetrics).toEqual(
        asTheProbeSendsIt(readAgentOtlp(scrape).resourceMetrics, SCOPE),
      );
    });
  }

  it("makes one resource per pool, named by its UUID, the unnamed one without a name", () => {
    const built: XcpNgOtlpBuildResult = buildFromScrape(1);

    expect(built.resourceCount).toBe(2);
    expect(built.poolIds).toEqual([POOL_UNNAMED, POOL_PRODUCTION].sort());

    const resources: Array<JSONObject> =
      built.resourceMetrics as Array<JSONObject>;
    const production: JSONObject = resources.find((resource: JSONObject) => {
      return attributeOf(resource, "xcp_ng.pool.id") === POOL_PRODUCTION;
    })!;
    const unnamed: JSONObject = resources.find((resource: JSONObject) => {
      return attributeOf(resource, "xcp_ng.pool.id") === POOL_UNNAMED;
    })!;

    expect(attributeOf(production, "xcp_ng.pool.name")).toBe("Production");
    expect(attributeOf(unnamed, "xcp_ng.pool.name")).toBeUndefined();
    expect(attributeOf(production, "server.address")).toBe(RECORDED_XO_HOST);
    expect(attributeOf(production, "server.port")).toBe("443");
    expect(attributeOf(production, "url.scheme")).toBe("https");
  });

  it("never claims to be the agent, nor names the Xen Orchestra itself", () => {
    for (const resource of buildFromScrape(1)
      .resourceMetrics as Array<JSONObject>) {
      expect(attributeOf(resource, "oneuptime.agent.version")).toBeUndefined();
      expect(attributeOf(resource, "xen_orchestra.name")).toBeUndefined();
      expect(attributeOf(resource, "service.name")).toBeUndefined();
      expect(attributeOf(resource, "pool_id")).toBeUndefined();
    }
  });

  it("keeps the eight rates Xen Orchestra types counter as gauges, with the values served - also where they go down", () => {
    const first: Array<JSONObject> = buildFromScrape(1)
      .resourceMetrics as Array<JSONObject>;
    const second: Array<JSONObject> = buildFromScrape(2)
      .resourceMetrics as Array<JSONObject>;

    const valueOf: (
      resources: Array<JSONObject>,
      name: string,
    ) => Array<number> = (
      resources: Array<JSONObject>,
      name: string,
    ): Array<number> => {
      const values: Array<number> = [];
      for (const resource of resources) {
        for (const metric of metricsOf(resource)) {
          if (metric["name"] !== name) {
            continue;
          }
          expect(metric["sum"]).toBeUndefined();
          expect(metric["gauge"]).toBeDefined();
          expect(metric["metadata"]).toEqual([
            { key: "prometheus.type", value: { stringValue: "counter" } },
          ]);
          for (const point of (metric["gauge"] as JSONObject)[
            "dataPoints"
          ] as Array<JSONObject>) {
            expect(point["startTimeUnixNano"]).toBeUndefined();
            values.push(point["asDouble"] as number);
          }
        }
      }
      return values;
    };

    let wentDown: number = 0;
    for (const name of XCP_NG_RATE_TYPED_AS_COUNTER_SERIES) {
      const before: Array<number> = valueOf(first, name);
      const after: Array<number> = valueOf(second, name);
      expect(before.length).toBeGreaterThan(0);
      if (after.length > 0 && after[0]! < before[0]!) {
        wentDown++;
      }
    }

    // A counter cannot go down; these do, as rates do.
    expect(wentDown).toBeGreaterThan(0);
  });

  it("leaves out Xen Orchestra's own series and the host power that names no pool", () => {
    const built: XcpNgOtlpBuildResult = buildFromScrape(1);

    expect(built.droppedNotXcpCount).toBeGreaterThan(0);
    expect(built.droppedWithoutPoolCount).toBe(1);

    for (const resource of built.resourceMetrics as Array<JSONObject>) {
      for (const metric of metricsOf(resource)) {
        expect(String(metric["name"]).startsWith("xcp_")).toBe(true);
        expect(metric["name"]).not.toBe("xcp_host_power_consumption_watts");
      }
    }
  });

  it("marks the pool Xen Orchestra lost stale, once, as the receiver does", () => {
    const first: XcpNgOtlpBuildResult = buildFromScrape(1);

    // Scrape 2 without the unnamed pool: Xen Orchestra lost it.
    const lost: string = readScrapeText(2)
      .split("\n")
      .filter((line: string) => {
        return (
          !line.includes(`pool_id="${POOL_UNNAMED}"`) &&
          !line.includes('host_name="xcp-lab-01"')
        );
      })
      .join("\n");

    const second: XcpNgOtlpBuildResult = XcpNgOtlpBuilder.build({
      samples: parseOpenMetricsText(lost).samples,
      scrapeTimeMs: SCRAPE_SECONDS[2] * 1000,
      target: { host: RECORDED_XO_HOST, port: 443 },
      scopeVersion: "test",
      previousUntimedSeries: first.untimedSeries,
    });

    const unnamed: JSONObject = (
      second.resourceMetrics as Array<JSONObject>
    ).find((resource: JSONObject) => {
      return attributeOf(resource, "xcp_ng.pool.id") === POOL_UNNAMED;
    })!;

    expect(metricsOf(unnamed)).toEqual([
      {
        name: "xcp_pool_connected",
        description: "Indicates if a pool is connected (1) or not (0)",
        gauge: {
          dataPoints: [
            { timeUnixNano: `${SCRAPE_SECONDS[2]}000000000`, flags: 1 },
          ],
        },
        metadata: [{ key: "prometheus.type", value: { stringValue: "gauge" } }],
      },
    ]);

    // And only once: the next read has nothing more of it.
    const third: XcpNgOtlpBuildResult = XcpNgOtlpBuilder.build({
      samples: parseOpenMetricsText(lost).samples,
      scrapeTimeMs: (SCRAPE_SECONDS[2] + 60) * 1000,
      target: { host: RECORDED_XO_HOST, port: 443 },
      scopeVersion: "test",
      previousUntimedSeries: second.untimedSeries,
    });

    expect(third.poolIds).toEqual([POOL_PRODUCTION]);
  });

  it("summarizes each pool's hosts, VMs and storage repositories as Xen Orchestra reports them", () => {
    const parsed: OpenMetricsParseResult = parseOpenMetricsText(
      readScrapeText(1),
    );

    expect(XcpNgOtlpBuilder.summarizePools(parsed.samples)).toEqual([
      {
        poolId: POOL_UNNAMED,
        hostCount: 1,
        runningHostCount: 1,
        vmCount: 1,
        runningVmCount: 1,
        storageRepositoryCount: 1,
      },
      {
        poolId: POOL_PRODUCTION,
        poolName: "Production",
        hostCount: 3,
        runningHostCount: 2,
        vmCount: 4,
        runningVmCount: 2,
        storageRepositoryCount: 3,
      },
    ]);
  });
});
