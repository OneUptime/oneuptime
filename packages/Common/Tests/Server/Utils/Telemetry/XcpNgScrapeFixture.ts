import fs from "fs";
import path from "path";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  XCP_NG_POOL_ID_ATTRIBUTE,
  XCP_NG_POOL_NAME_ATTRIBUTE,
  XCP_NG_RATE_TYPED_AS_COUNTER_SERIES,
  XEN_ORCHESTRA_NAME_ATTRIBUTE,
} from "../../../../Types/XcpNg/XcpNgTelemetry";

/*
 * The recorded Xen Orchestra scrapes (Fixtures/XcpNg/XenOrchestraScrape1.txt
 * and 2.txt: two pools behind one Xen Orchestra, in xo-server-openmetrics
 * 1.9.4's own format - see Tests/Ops/Fixtures/XcpNg/XenOrchestraScrape.js,
 * which writes them, and XenOrchestraScrapeFixturesInStep, which keeps the
 * copies here identical to it) read back as samples, and turned into the
 * OTLP the XCP-ng Agent sends: the xcp_* series only, one resource per
 * pool carrying xcp_ng.pool.id / xcp_ng.pool.name / xen_orchestra.name, the
 * eight rate series as gauges (or as the sums a collector configured by
 * hand would send, to test the ingest's safety net), timestamps in
 * nanoseconds.
 */

export const XCP_NG_FIXTURE_DIR: string = path.join(
  __dirname,
  "Fixtures",
  "XcpNg",
);

export const SCRAPE_1_NOW_SECONDS: number = 1795000000;
export const SCRAPE_2_NOW_SECONDS: number = 1795000060;

export const PRODUCTION_POOL_ID: string =
  "b7569d99-30f8-178a-7d94-801de3e29b5b";
export const UNNAMED_POOL_ID: string = "2ad2c2ec-1d43-4a5c-9c62-e8d0b6a4c3f1";

export interface OpenMetricsSample {
  name: string;
  type: string;
  help: string;
  labels: Record<string, string>;
  value: number;
  timestampSeconds: number | null;
}

export function readRecordedScrape(scrape: 1 | 2): string {
  return fs.readFileSync(
    path.join(XCP_NG_FIXTURE_DIR, `XenOrchestraScrape${scrape}.txt`),
    "utf8",
  );
}

function parseLabels(body: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const re: RegExp = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null = re.exec(body);
  while (match) {
    const key: string = match[1]!;
    const value: string = match[2]!
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    // An empty label value is no label, as Prometheus parsers read it.
    if (value !== "") {
      labels[key] = value;
    }
    match = re.exec(body);
  }
  return labels;
}

// One sample line: name, optional {labels}, value, optional timestamp.
const SAMPLE_LINE: RegExp =
  /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{.*\})? (\S+)(?: (\S+))?$/;

/*
 * A small OpenMetrics reader for the recorded scrape: # HELP / # TYPE,
 * `name{labels} value [timestamp]`, and the final # EOF.
 */
export function parseOpenMetrics(text: string): Array<OpenMetricsSample> {
  const types: Map<string, string> = new Map();
  const helps: Map<string, string> = new Map();
  const samples: Array<OpenMetricsSample> = [];
  for (const line of text.split("\n")) {
    if (line === "" || line === "# EOF") {
      continue;
    }
    if (line.startsWith("# TYPE ")) {
      const [, , name, type] = line.split(" ");
      types.set(name!, type!);
      continue;
    }
    if (line.startsWith("# HELP ")) {
      const rest: string = line.slice("# HELP ".length);
      const space: number = rest.indexOf(" ");
      helps.set(rest.slice(0, space), rest.slice(space + 1));
      continue;
    }
    const match: RegExpExecArray | null = SAMPLE_LINE.exec(line);
    if (!match) {
      throw new Error(`Unreadable sample line: ${line}`);
    }
    const name: string = match[1]!;
    samples.push({
      name,
      type: types.get(name) || "unknown",
      help: helps.get(name) || "",
      labels: match[2] ? parseLabels(match[2].slice(1, -1)) : {},
      value: Number(match[3]),
      timestampSeconds: match[4] !== undefined ? Number(match[4]) : null,
    });
  }
  return samples;
}

function attribute(key: string, value: string): JSONObject {
  return { key, value: { stringValue: value } };
}

export interface AgentOtlpOptions {
  // When the scrape happened: the time of a sample that carries none.
  scrapeSeconds: number;
  xenOrchestraName?: string;
  agentVersion?: string;
  /*
   * Leave the eight rate series as cumulative sums, as a collector without
   * the agent's transform would send them.
   */
  rateSeriesAsSums?: boolean;
  // Mark these series' datapoints as staleness markers (flags = 1).
  staleSeries?: Array<string>;
}

/*
 * The OTLP resourceMetrics the XCP-ng Agent sends for a scrape: one entry
 * per pool, as its groupbyattrs + resource processors make them.
 */
export function toAgentResourceMetrics(
  samples: Array<OpenMetricsSample>,
  options: AgentOtlpOptions,
): Array<JSONObject> {
  const byPool: Map<
    string,
    { name: string | null; byMetric: Map<string, Array<OpenMetricsSample>> }
  > = new Map();

  for (const sample of samples) {
    if (!sample.name.startsWith("xcp_")) {
      continue;
    }
    const poolId: string | undefined = sample.labels["pool_id"];
    if (!poolId) {
      // The agent drops what names no pool (the IPMI host power, xo_*).
      continue;
    }
    let pool:
      | { name: string | null; byMetric: Map<string, Array<OpenMetricsSample>> }
      | undefined = byPool.get(poolId);
    if (!pool) {
      pool = { name: sample.labels["pool_name"] || null, byMetric: new Map() };
      byPool.set(poolId, pool);
    }
    const list: Array<OpenMetricsSample> = pool.byMetric.get(sample.name) || [];
    list.push(sample);
    pool.byMetric.set(sample.name, list);
  }

  const resourceMetrics: Array<JSONObject> = [];
  for (const [poolId, pool] of byPool) {
    const resourceAttributes: JSONArray = [
      attribute(XCP_NG_POOL_ID_ATTRIBUTE, poolId),
    ];
    if (pool.name) {
      resourceAttributes.push(attribute(XCP_NG_POOL_NAME_ATTRIBUTE, pool.name));
    }
    resourceAttributes.push(
      attribute(
        XEN_ORCHESTRA_NAME_ATTRIBUTE,
        options.xenOrchestraName || "xo-lab",
      ),
    );
    resourceAttributes.push(
      attribute("oneuptime.agent.version", options.agentVersion || "0.165.0"),
    );

    const metrics: Array<JSONObject> = [];
    for (const [name, list] of pool.byMetric) {
      const dataPoints: Array<JSONObject> = list.map(
        (sample: OpenMetricsSample) => {
          const attributes: JSONArray = Object.entries(sample.labels)
            .filter(([key]: [string, string]) => {
              return key !== "pool_id" && key !== "pool_name";
            })
            .map(([key, value]: [string, string]) => {
              return attribute(key, value);
            });
          const seconds: number =
            sample.timestampSeconds ?? options.scrapeSeconds;
          const point: JSONObject = {
            attributes,
            timeUnixNano: `${seconds}000000000`,
            asDouble: sample.value,
          };
          if ((options.staleSeries || []).includes(name)) {
            point["flags"] = 1;
          }
          return point;
        },
      );
      const isRate: boolean =
        XCP_NG_RATE_TYPED_AS_COUNTER_SERIES.includes(name);
      if (isRate && options.rateSeriesAsSums) {
        metrics.push({
          name,
          sum: {
            dataPoints,
            aggregationTemporality: 2,
            isMonotonic: true,
          },
        });
      } else {
        metrics.push({ name, gauge: { dataPoints } });
      }
    }

    resourceMetrics.push({
      resource: { attributes: resourceAttributes },
      scopeMetrics: [
        {
          scope: {
            name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/prometheusreceiver",
            version: "0.165.0",
          },
          metrics,
        },
      ],
    });
  }
  return resourceMetrics;
}

export function getResourceOfPool(
  resourceMetrics: Array<JSONObject>,
  poolId: string,
): JSONObject {
  const found: JSONObject | undefined = resourceMetrics.find(
    (rm: JSONObject) => {
      const attributes: JSONArray =
        ((rm["resource"] as JSONObject)["attributes"] as JSONArray) || [];
      return attributes.some((a: JSONObject | unknown) => {
        const entry: JSONObject = a as JSONObject;
        return (
          entry["key"] === XCP_NG_POOL_ID_ATTRIBUTE &&
          (entry["value"] as JSONObject)["stringValue"] === poolId
        );
      });
    },
  );
  if (!found) {
    throw new Error(`No resource for pool ${poolId}`);
  }
  return found;
}

// Every [metricName, datapoint] pair of a resource, in order.
export function getDatapoints(
  resourceMetric: JSONObject,
): Array<{ metricName: string; datapoint: JSONObject; metric: JSONObject }> {
  const result: Array<{
    metricName: string;
    datapoint: JSONObject;
    metric: JSONObject;
  }> = [];
  for (const scopeMetric of (resourceMetric["scopeMetrics"] as JSONArray) ||
    []) {
    for (const metric of ((scopeMetric as JSONObject)[
      "metrics"
    ] as JSONArray) || []) {
      const m: JSONObject = metric as JSONObject;
      const body: JSONObject | undefined = (m["gauge"] || m["sum"]) as
        | JSONObject
        | undefined;
      for (const dp of (body?.["dataPoints"] as JSONArray) || []) {
        result.push({
          metricName: m["name"] as string,
          datapoint: dp as JSONObject,
          metric: m,
        });
      }
    }
  }
  return result;
}

export function getAttributeOf(
  datapoint: JSONObject,
  key: string,
): string | undefined {
  for (const a of (datapoint["attributes"] as JSONArray) || []) {
    const entry: JSONObject = a as JSONObject;
    if (entry["key"] === key) {
      return (entry["value"] as JSONObject)["stringValue"] as string;
    }
  }
  return undefined;
}
