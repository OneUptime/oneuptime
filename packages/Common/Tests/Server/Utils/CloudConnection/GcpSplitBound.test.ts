import { describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudReadResult,
  GcpSplitLearned,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { storedAttributesOf } from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import GcpCloudConnector, {
  GCP_SPLIT_LEARN_EMPTY_EVERY_MS,
  GCP_SPLIT_LEARN_EVERY_MS,
  GCP_SPLIT_MAX_LEARNED_RESOURCES,
  GcpAddedMetricAsk,
  getGcpAddedMetricsToAsk,
  getGcpSplitLearnKey,
  getGcpSplitResourcesUnseen,
  isGcpSplitLearnDue,
  learnGcpSplitFromRead,
  planGcpSplitReads,
  toGcpSplitLearned,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpCloudConnector";
import GcpMonitoring, {
  GcpSplitValue,
  GcpTimeSeries,
  getGcpPromQlMetricLabel,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpMonitoring";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
  CloudAddedMetric,
  CloudAddedMetricScope,
  getCloudAddedMetricKey,
} from "../../../../Types/Cloud/CloudAddedMetrics";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  estimateCloudAddedMetricCost,
  getGcpSplitLearnsPerMonth,
  getReadsPerMonth,
} from "../../../../Types/CloudConnection/CloudConnectionCost";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  FakeRoute,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * #10076: GOOGLE CLOUD BILLS EVERY SERIES A SPLIT RETURNS, SO A SPLIT IS
 * BOUNDED AT THE READ.
 *
 * Cloud Monitoring bills each read by the time series it returns - at
 * least one a call - and timeSeries.list has no top-N, so a split by a
 * label of 30 values cost 30 series a resource each read while OneUptime
 * kept 10. Now a split is read for each resource's busiest values alone:
 * learned once an hour by a PromQL topk, which returns those alone, and
 * read with metric.labels.<label>=one_of(...).
 *
 * The fake Google here answers as Cloud Monitoring does: timeSeries.list by
 * its filter (resource and metric labels, = and one_of), its cross-series
 * reducer and groupByFields; the Prometheus API's instant query by the
 * PromQL topk the read sends, over the same series; and it counts what each
 * call returns as Google bills it, the larger of the series returned and
 * one. The series are a VM's processes as the Ops Agent reports them:
 * agent.googleapis.com/processes/cpu_time, a series per command, pid and
 * user or system time.
 */

const PROJECT_ID: string = "acme-prod";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const KEY: string = JSON.stringify({
  type: "service_account",
  project_id: PROJECT_ID,
  client_email: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});
// 12:07: Cloud Monitoring's minute window ends four minutes back: 12:03.
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const MINUTE_MS: number = 60 * 1000;

const CPU: string = "compute.googleapis.com/instance/cpu/utilization";
const PROCESS_CPU: string = "agent.googleapis.com/processes/cpu_time";
const SPLIT_LABEL: string = "command";
const RESOURCE_KEYS: Array<string> = ["instance_id", "project_id", "zone"];

const connector: GcpCloudConnector = new GcpCloudConnector();

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.GCP,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.GcpServiceAccountKey,
      projectIds: PROJECT_ID,
    },
    secrets: { serviceAccountJson: KEY },
  };
}

function vmLabels(instanceId: string): Record<string, string> {
  return {
    project_id: PROJECT_ID,
    zone: "us-central1-a",
    instance_id: instanceId,
  };
}

function cpuSeries(instanceId: string): JSONObject {
  return {
    metric: { type: CPU, labels: {} },
    resource: { type: "gce_instance", labels: vmLabels(instanceId) },
    metadata: { systemLabels: { name: `vm-${instanceId}` } },
    points: [
      {
        interval: { endTime: "2026-10-21T12:00:00Z" },
        value: { doubleValue: 0.4 },
      },
    ],
  };
}

/*
 * A process's CPU time as the Ops Agent reports it: a series for its user
 * time and one for its system time, whose split read adds them up.
 */
function processSeries(
  instanceId: string,
  command: string,
  busy: number,
): Array<JSONObject> {
  return ["user", "syst"].map((part: string, index: number): JSONObject => {
    return {
      metric: {
        type: PROCESS_CPU,
        labels: {
          command,
          command_line: `/usr/bin/${command} --serve`,
          owner: "root",
          pid: String(1000 + busy),
          user_or_syst: part,
        },
      },
      resource: { type: "gce_instance", labels: vmLabels(instanceId) },
      points: [
        {
          interval: { endTime: "2026-10-21T12:00:00Z" },
          value: { int64Value: String(index === 0 ? busy * 10 : busy) },
        },
        {
          interval: { endTime: "2026-10-21T11:59:00Z" },
          value: { int64Value: String(index === 0 ? busy * 10 : busy) },
        },
      ],
    };
  });
}

// A VM running `count` commands, cmd-00 the quietest, each one busier than the last.
function processesOf(instanceId: string, count: number): Array<JSONObject> {
  const series: Array<JSONObject> = [];

  for (let index: number = 0; index < count; index++) {
    series.push(
      ...processSeries(
        instanceId,
        `cmd-${String(index).padStart(2, "0")}`,
        index + 1,
      ),
    );
  }

  return series;
}

// ---- A fake Cloud Monitoring, as Google answers and bills ------------------

interface ParsedFilter {
  metricType: string;
  resourceType: string;
  resourceLabels: Array<[string, Array<string>]>;
  metricLabels: Array<[string, Array<string>]>;
}

function valuesOf(text: string): Array<string> {
  return Array.from(text.matchAll(/"([^"]*)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function parseFilter(filter: string): ParsedFilter {
  const parsed: ParsedFilter = {
    metricType: "",
    resourceType: "",
    resourceLabels: [],
    metricLabels: [],
  };

  for (const part of filter.split(" AND ")) {
    const match: RegExpMatchArray | null = part.match(
      /^(metric\.type|resource\.type|resource\.labels\.([a-z_]+)|metric\.labels\.([a-z_]+))=(.*)$/,
    );

    if (!match) {
      throw new Error(`The fake cannot read this filter: ${part}`);
    }

    const values: Array<string> = valuesOf(match[4]!);

    if (match[1] === "metric.type") {
      parsed.metricType = values[0]!;
    } else if (match[1] === "resource.type") {
      parsed.resourceType = values[0]!;
    } else if (match[2]) {
      parsed.resourceLabels.push([match[2], values]);
    } else {
      parsed.metricLabels.push([match[3]!, values]);
    }
  }

  return parsed;
}

function labelsOf(series: JSONObject, kind: "metric" | "resource"): JSONObject {
  return ((series[kind] as JSONObject)["labels"] as JSONObject) || {};
}

function pointValue(point: JSONObject): number {
  const value: JSONObject = point["value"] as JSONObject;

  return Number(value["doubleValue"] ?? value["int64Value"]);
}

// A series' points, all added up: how busy it was.
function busyOf(series: JSONObject): number {
  return (series["points"] as Array<JSONObject>).reduce(
    (sum: number, point: JSONObject): number => {
      return sum + pointValue(point);
    },
    0,
  );
}

interface Billed {
  // Each call's series as Google bills it: the series returned, or one.
  list: Array<number>;
  promql: Array<number>;
}

interface FakeGoogle extends FakeProviderApi {
  lists: Array<URL>;
  queries: Array<string>;
  billed: Billed;
  setSeries: (series: Record<string, Array<JSONObject>>) => void;
}

function createFakeGoogle(
  options: {
    series?: Record<string, Array<JSONObject>>;
    // The Prometheus API's own answer, before any other: a refusal, say.
    promQl?: (() => FakeResponse | undefined) | undefined;
    list?: ((url: URL) => FakeResponse | undefined) | undefined;
  } = {},
): FakeGoogle {
  let all: Record<string, Array<JSONObject>> = options.series || {};
  const lists: Array<URL> = [];
  const queries: Array<string> = [];
  const billed: Billed = { list: [], promql: [] };

  const matches: (
    series: JSONObject,
    filter: ParsedFilter,
    project: string,
  ) => boolean = (
    series: JSONObject,
    filter: ParsedFilter,
    project: string,
  ): boolean => {
    const resource: JSONObject = labelsOf(series, "resource");
    const metric: JSONObject = labelsOf(series, "metric");

    return (
      resource["project_id"] === project &&
      (!filter.resourceType ||
        (series["resource"] as JSONObject)["type"] === filter.resourceType) &&
      filter.resourceLabels.every(
        ([name, values]: [string, Array<string>]): boolean => {
          return values.includes(String(resource[name]));
        },
      ) &&
      filter.metricLabels.every(
        ([name, values]: [string, Array<string>]): boolean => {
          return values.includes(String(metric[name]));
        },
      )
    );
  };

  const routes: Array<FakeRoute> = [
    {
      host: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "ya29.token", expires_in: 3599 });
      },
    },
    {
      host: "monitoring.googleapis.com",
      path: /^\/v3\/projects\/[^/]+\/timeSeries$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        lists.push(url);

        const own: FakeResponse | undefined = options.list?.(url);

        if (own) {
          return own;
        }

        const project: string = url.pathname.split("/")[3]!;
        const filter: ParsedFilter = parseFilter(
          url.searchParams.get("filter") || "",
        );
        const found: Array<JSONObject> = (all[filter.metricType] || []).filter(
          (series: JSONObject): boolean => {
            return matches(series, filter, project);
          },
        );
        const reducer: string | null = url.searchParams.get(
          "aggregation.crossSeriesReducer",
        );
        const hourly: boolean =
          url.searchParams.get("aggregation.alignmentPeriod") === "3600s";
        let answer: Array<JSONObject> = found;

        // The other labels added up, keeping the fields named (groupByFields).
        if (reducer) {
          const fields: Array<string> = url.searchParams.getAll(
            "aggregation.groupByFields",
          );
          const groups: Map<string, Array<JSONObject>> = new Map();

          for (const series of found) {
            const key: string = JSON.stringify(
              fields.map((field: string): string => {
                const [kind, , name] = field.split(".");

                return String(
                  labelsOf(series, kind === "metric" ? "metric" : "resource")[
                    name!
                  ],
                );
              }),
            );
            const group: Array<JSONObject> = groups.get(key) || [];

            group.push(series);
            groups.set(key, group);
          }

          answer = Array.from(groups.values()).map(
            (group: Array<JSONObject>): JSONObject => {
              const metric: JSONObject = {};
              const resource: JSONObject = {};

              for (const field of fields) {
                const [kind, , name] = field.split(".");

                if (kind === "metric") {
                  metric[name!] = labelsOf(group[0]!, "metric")[name!]!;
                } else {
                  resource[name!] = labelsOf(group[0]!, "resource")[name!]!;
                }
              }

              const byTime: Map<string, Array<number>> = new Map();

              for (const series of group) {
                for (const point of series["points"] as Array<JSONObject>) {
                  const end: string = hourly
                    ? "2026-10-21T12:03:00Z"
                    : String(
                        (point["interval"] as JSONObject)["endTime"] as string,
                      );
                  const values: Array<number> = byTime.get(end) || [];

                  values.push(pointValue(point));
                  byTime.set(end, values);
                }
              }

              return {
                metric: { type: filter.metricType, labels: metric },
                resource: {
                  type: (group[0]!["resource"] as JSONObject)["type"],
                  labels: resource,
                },
                points: Array.from(byTime.entries()).map(
                  ([end, values]: [string, Array<number>]): JSONObject => {
                    const sum: number = values.reduce(
                      (total: number, value: number): number => {
                        return total + value;
                      },
                      0,
                    );

                    return {
                      interval: { endTime: end },
                      value: {
                        doubleValue:
                          reducer === "REDUCE_MEAN" ? sum / values.length : sum,
                      },
                    };
                  },
                ),
              };
            },
          );
        }

        billed.list.push(Math.max(1, answer.length));

        return json({ timeSeries: answer });
      },
    },
    {
      host: "monitoring.googleapis.com",
      path: /^\/v1\/projects\/[^/]+\/location\/global\/prometheus\/api\/v1\/query$/,
      method: "POST",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        const form: Record<string, string> = request.body as Record<
          string,
          string
        >;
        const query: string = form["query"] || "";

        queries.push(query);

        const own: FakeResponse | undefined = options.promQl?.();

        if (own) {
          return own;
        }

        const result: JSONArray = evaluateTopk(query, all);

        billed.promql.push(Math.max(1, result.length));

        return json({
          status: "success",
          data: { resultType: "vector", result },
        });
      },
    },
  ];

  return {
    ...createFakeProviderApi(routes),
    lists,
    queries,
    billed,
    setSeries: (series: Record<string, Array<JSONObject>>): void => {
      all = series;
    },
  };
}

// A PromQL string literal's text.
function unquote(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}

/*
 * The topk query the read sends, evaluated as Prometheus would over the
 * fake's series: the selector's series, each ranked by its points (rate) or
 * their mean (avg_over_time), added up by the labels kept, the busiest of
 * each resource.
 */
function evaluateTopk(
  query: string,
  all: Record<string, Array<JSONObject>>,
): JSONArray {
  const match: RegExpMatchArray | null = query.match(
    /^topk by \(([^)]*)\) \((\d+), (sum|avg) by \(([^)]*)\) \((rate|avg_over_time)\(\{(.*)\}\[(\d+)s\]\)\)\)$/,
  );

  if (!match) {
    throw new Error(`The fake cannot read this query: ${query}`);
  }

  const perResource: Array<string> = match[1]!.split(", ");
  const top: number = Number(match[2]);
  const across: string = match[3]!;
  const keep: Array<string> = match[4]!.split(", ");
  const perSeries: string = match[5]!;
  const matchers: Array<{ name: string; isPattern: boolean; value: string }> =
    Array.from(
      match[6]!.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)(=~|=)"((?:[^"\\]|\\.)*)"/g),
    ).map((matcher: RegExpMatchArray) => {
      return {
        name: matcher[1]!,
        isPattern: matcher[2] === "=~",
        value: unquote(matcher[3]!),
      };
    });
  const named: (name: string) => string = (name: string): string => {
    return (
      matchers.find((matcher: { name: string }): boolean => {
        return matcher.name === name;
      })?.value || ""
    );
  };

  // A series' labels as PromQL names them: a metric label sharing a resource label's key is metric_<key>.
  const promLabels: (series: JSONObject) => Record<string, string> = (
    series: JSONObject,
  ): Record<string, string> => {
    const resource: JSONObject = labelsOf(series, "resource");
    const labels: Record<string, string> = {};

    for (const [key, value] of Object.entries(resource)) {
      labels[key] = String(value);
    }

    for (const [key, value] of Object.entries(labelsOf(series, "metric"))) {
      labels[key in resource ? `metric_${key}` : key] = String(value);
    }

    return labels;
  };

  const selected: Array<{ labels: Record<string, string>; score: number }> = (
    all[named("__name__")] || []
  )
    .filter((series: JSONObject): boolean => {
      if (
        (series["resource"] as JSONObject)["type"] !==
        named("monitored_resource")
      ) {
        return false;
      }

      const labels: Record<string, string> = promLabels(series);

      return matchers
        .filter((matcher: { name: string }): boolean => {
          return !["__name__", "monitored_resource"].includes(matcher.name);
        })
        .every(
          (matcher: { name: string; isPattern: boolean; value: string }) => {
            return matcher.isPattern
              ? new RegExp(`^(?:${matcher.value})$`).test(
                  labels[matcher.name] || "",
                )
              : labels[matcher.name] === matcher.value;
          },
        );
    })
    .map((series: JSONObject) => {
      const points: number = (series["points"] as Array<JSONObject>).length;

      return {
        labels: promLabels(series),
        score:
          perSeries === "rate"
            ? busyOf(series)
            : busyOf(series) / Math.max(1, points),
      };
    });

  const kept: Map<
    string,
    { labels: Record<string, string>; scores: Array<number> }
  > = new Map();

  for (const entry of selected) {
    const labels: Record<string, string> = {};

    for (const name of keep) {
      labels[name] = entry.labels[name] || "";
    }

    const key: string = JSON.stringify(labels);
    const found: { labels: Record<string, string>; scores: Array<number> } =
      kept.get(key) || { labels, scores: [] };

    found.scores.push(entry.score);
    kept.set(key, found);
  }

  const byResource: Map<
    string,
    Array<{ labels: Record<string, string>; score: number }>
  > = new Map();

  for (const entry of kept.values()) {
    const sum: number = entry.scores.reduce((total: number, score: number) => {
      return total + score;
    }, 0);
    const key: string = JSON.stringify(
      perResource.map((name: string): string => {
        return entry.labels[name] || "";
      }),
    );
    const list: Array<{ labels: Record<string, string>; score: number }> =
      byResource.get(key) || [];

    list.push({
      labels: entry.labels,
      score: across === "sum" ? sum : sum / entry.scores.length,
    });
    byResource.set(key, list);
  }

  const result: JSONArray = [];

  for (const list of byResource.values()) {
    for (const entry of [...list]
      .sort((a: { score: number }, b: { score: number }): number => {
        return b.score - a.score;
      })
      .slice(0, top)) {
      result.push({
        metric: entry.labels,
        value: [NOW.getTime() / 1000, String(entry.score)],
      });
    }
  }

  return result;
}

// ---- The additions, the state and what a read wrote ------------------------

function addition(overrides: Partial<CloudAddedMetric> = {}): CloudAddedMetric {
  const metric: CloudAddedMetric = {
    key: "",
    provider: CloudProvider.GCP,
    scope: CloudAddedMetricScope.Type,
    resourceType: "gce_instance",
    name: PROCESS_CPU,
    aggregation: "ALIGN_RATE",
    unit: "us/s",
    splitBy: SPLIT_LABEL,
    resourceLabelKeys: RESOURCE_KEYS,
    addedAt: NOW.toISOString(),
    ...overrides,
  };

  return { ...metric, key: getCloudAddedMetricKey(metric) };
}

function ownAddition(instanceId: string): CloudAddedMetric {
  return addition({
    scope: CloudAddedMetricScope.Resource,
    cloudResourceId: `row-${instanceId}`,
    accountId: PROJECT_ID,
    resourceLabels: vmLabels(instanceId),
  });
}

// A project known to have VMs: its VM metrics, and their additions, are asked every read.
function withVms(
  state: CloudConnectionPullState = {},
): CloudConnectionPullState {
  return {
    gcpResourceTypesSeen: {
      [PROJECT_ID]: {
        gce_instance: new Date(NOW.getTime() - MINUTE_MS).toISOString(),
      },
    },
    ...state,
  };
}

async function readAt(
  fake: FakeGoogle,
  added: Array<CloudAddedMetric>,
  state: CloudConnectionPullState,
  at: Date = NOW,
): Promise<CloudReadResult> {
  return await connector.read(settings(), {
    transport: fake.transport,
    now: () => {
      return at;
    },
    state,
    serviceName: "Google Cloud",
    connectionId: "33333333-3333-4333-8333-333333333333",
    maxRequests: 3000,
    maxDurationMs: 60000,
    addedMetrics: added,
  });
}

// The split's own timeSeries.list calls, by their filters.
function splitLists(fake: FakeGoogle): Array<URL> {
  return fake.lists.filter((url: URL): boolean => {
    return (
      parseFilter(url.searchParams.get("filter") || "").metricType ===
      PROCESS_CPU
    );
  });
}

// What Google billed for the split: each of its calls' series, at least one a call.
function billedForSplit(fake: FakeGoogle): number {
  const lists: Array<URL> = fake.lists;
  let total: number = 0;

  lists.forEach((url: URL, index: number) => {
    if (
      parseFilter(url.searchParams.get("filter") || "").metricType ===
      PROCESS_CPU
    ) {
      total += fake.billed.list[index] || 0;
    }
  });

  return (
    total +
    fake.billed.promql.reduce((sum: number, series: number): number => {
      return sum + series;
    }, 0)
  );
}

// "<instance>:<command>" for each value of the split the read wrote.
function writtenValues(result: CloudReadResult): Array<string> {
  const written: Array<string> = [];

  for (const payload of result.payloads) {
    for (const rm of payload["resourceMetrics"] as JSONArray) {
      const resourceAttributes: JSONArray = (
        (rm as JSONObject)["resource"] as JSONObject
      )["attributes"] as JSONArray;

      for (const sm of (rm as JSONObject)["scopeMetrics"] as JSONArray) {
        for (const metric of (sm as JSONObject)["metrics"] as JSONArray) {
          if ((metric as JSONObject)["name"] !== PROCESS_CPU) {
            continue;
          }

          for (const point of ((metric as JSONObject)["gauge"] as JSONObject)[
            "dataPoints"
          ] as JSONArray) {
            const stored: JSONObject = storedAttributesOf(
              resourceAttributes as never,
              (point as JSONObject)["attributes"] as never,
            ) as JSONObject;

            written.push(
              `${stored["resource.instance_id"]}:${stored[SPLIT_LABEL]}`,
            );
          }
        }
      }
    }
  }

  return Array.from(new Set(written)).sort();
}

function commands(from: number, to: number): Array<string> {
  const names: Array<string> = [];

  for (let index: number = from; index <= to; index++) {
    names.push(`cmd-${String(index).padStart(2, "0")}`);
  }

  return names;
}

function metricLabelValuesOf(url: URL): Array<string> | undefined {
  return parseFilter(url.searchParams.get("filter") || "").metricLabels.find(
    ([name]: [string, Array<string>]): boolean => {
      return name === SPLIT_LABEL;
    },
  )?.[1];
}

function resourceValuesOf(url: URL, label: string): Array<string> | undefined {
  return parseFilter(url.searchParams.get("filter") || "").resourceLabels.find(
    ([name]: [string, Array<string>]): boolean => {
      return name === label;
    },
  )?.[1];
}

// ---- Asking Google for some values only ------------------------------------

describe("a call asks Google for some of a label's values only", () => {
  test("one value, or several with one_of: as strings, a number's too", () => {
    expect(
      GcpMonitoring.buildFilter({
        metricType: PROCESS_CPU,
        resourceType: "gce_instance",
        resourceLabels: { instance_id: "1001" },
        metricLabelIn: { label: SPLIT_LABEL, values: ["nginx"] },
      }),
    ).toBe(
      `metric.type="${PROCESS_CPU}" AND metric.labels.command="nginx" AND resource.type="gce_instance" AND resource.labels.instance_id="1001"`,
    );
    // An INT64 label is a string to the filter, as Google's own docs write it.
    expect(
      GcpMonitoring.buildFilter({
        metricType: "loadbalancing.googleapis.com/https/request_count",
        resourceType: "https_lb_rule",
        metricLabelIn: {
          label: "response_code",
          values: ["200", "404", "503"],
        },
      }),
    ).toBe(
      'metric.type="loadbalancing.googleapis.com/https/request_count" AND metric.labels.response_code=one_of("200","404","503") AND resource.type="https_lb_rule"',
    );
    // None: every value.
    expect(
      GcpMonitoring.buildFilter({
        metricType: PROCESS_CPU,
        metricLabelIn: { label: SPLIT_LABEL, values: [] },
      }),
    ).toBe(`metric.type="${PROCESS_CPU}"`);
  });
});

describe("the PromQL that learns a split's busiest values", () => {
  test("a rate: each value's per-second rate added up by its sum, the busiest 10 of each VM, of this project alone", () => {
    expect(
      GcpMonitoring.buildTopSplitValuesQuery({
        projectId: PROJECT_ID,
        metricType: PROCESS_CPU,
        aligner: "ALIGN_RATE",
        resourceType: "gce_instance",
        split: {
          label: SPLIT_LABEL,
          reducer: "REDUCE_SUM",
          resourceLabelKeys: ["zone", "instance_id", "project_id"],
        },
        top: 10,
        lookBackSeconds: 3600,
      }),
    ).toBe(
      'topk by (instance_id, project_id, zone) (10, sum by (instance_id, project_id, zone, command) (rate({__name__="agent.googleapis.com/processes/cpu_time", monitored_resource="gce_instance", project_id="acme-prod"}[3600s])))',
    );
  });

  test("a level by its mean; a batch's resources by their labels, the varying one an anchored pattern of its values", () => {
    expect(
      GcpMonitoring.buildTopSplitValuesQuery({
        projectId: PROJECT_ID,
        metricType: "cloudsql.googleapis.com/database/postgresql/num_backends",
        aligner: "ALIGN_MEAN",
        resourceType: "cloudsql_database",
        resourceLabels: { project_id: PROJECT_ID, region: "us-central1" },
        resourceLabelIn: {
          label: "database_id",
          values: ["acme-prod:orders.v2", "acme-prod:billing"],
        },
        split: {
          label: "database",
          reducer: "REDUCE_MEAN",
          resourceLabelKeys: ["database_id", "project_id", "region"],
        },
        top: 10,
        lookBackSeconds: 3600,
      }),
    ).toBe(
      'topk by (database_id, project_id, region) (10, avg by (database_id, project_id, region, database) (avg_over_time({__name__="cloudsql.googleapis.com/database/postgresql/num_backends", monitored_resource="cloudsql_database", project_id="acme-prod", region="us-central1", database_id=~"acme-prod:orders\\\\.v2|acme-prod:billing"}[3600s])))',
    );
  });

  test("a metric label that shares a resource label's key is metric_<key> to PromQL", () => {
    expect(getGcpPromQlMetricLabel("zone", RESOURCE_KEYS)).toBe("metric_zone");
    expect(getGcpPromQlMetricLabel("command", RESOURCE_KEYS)).toBe("command");
    expect(
      GcpMonitoring.buildTopSplitValuesQuery({
        projectId: PROJECT_ID,
        metricType:
          "compute.googleapis.com/instance/network/received_bytes_count",
        aligner: "ALIGN_RATE",
        resourceType: "gce_instance",
        split: {
          label: "zone",
          reducer: "REDUCE_SUM",
          resourceLabelKeys: RESOURCE_KEYS,
        },
        top: 10,
        lookBackSeconds: 3600,
      }),
    ).toContain("sum by (instance_id, project_id, zone, metric_zone)");
  });

  test("Prometheus's answer: each series' labels and value; a refusal throws", () => {
    expect(
      GcpMonitoring.readPromQlVector({
        status: "success",
        data: {
          resultType: "vector",
          result: [
            {
              metric: { instance_id: "1001", command: "nginx" },
              value: [1761048180, "12.5"],
            },
            { metric: { instance_id: "1001", command: "cron" }, value: [] },
          ],
        },
      }),
    ).toEqual([
      { labels: { instance_id: "1001", command: "nginx" }, value: 12.5 },
      { labels: { instance_id: "1001", command: "cron" }, value: NaN },
    ]);
    expect(() => {
      GcpMonitoring.readPromQlVector({
        status: "error",
        errorType: "bad_data",
        error: 'unknown function "topk2"',
      });
    }).toThrow('unknown function "topk2"');
  });
});

// ---- What a learning keeps, and what a read then asks ----------------------

function valueOf(
  instanceId: string,
  value: string,
  score: number,
): GcpSplitValue {
  return { resourceLabels: vmLabels(instanceId), value, score };
}

describe("what a learning keeps", () => {
  test("a resource of the cap's values or more is read for its busiest; one of fewer for every value", () => {
    const values: Array<GcpSplitValue> = [
      ...commands(0, 11).map((command: string, index: number) => {
        return valueOf("1001", command, index);
      }),
      valueOf("1002", "nginx", 5),
      valueOf("1002", "cron", 1),
    ];
    const learned: GcpSplitLearned = toGcpSplitLearned({
      values,
      label: SPLIT_LABEL,
      at: NOW,
      via: "promql",
    });

    expect(learned).toEqual({
      at: NOW.toISOString(),
      via: "promql",
      capped: [
        {
          resource: vmLabels("1001"),
          // The busiest first: cmd-11 down to cmd-02.
          values: commands(2, 11).reverse(),
        },
      ],
      others: [vmLabels("1002")],
    });
  });

  test("a value no filter can quote is never asked for; past the most kept, the busiest resources stay", () => {
    const quoted: GcpSplitLearned = toGcpSplitLearned({
      values: [
        ...commands(0, 9).map((command: string, index: number) => {
          return valueOf("1001", command, index + 1);
        }),
        valueOf("1001", 'say "hi"', 100),
      ],
      label: SPLIT_LABEL,
      at: NOW,
      via: "list",
    });

    expect(quoted.capped[0]!.values).not.toContain('say "hi"');
    expect(quoted.capped[0]!.values).toHaveLength(
      CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
    );

    const many: Array<GcpSplitValue> = [];

    for (
      let index: number = 0;
      index < GCP_SPLIT_MAX_LEARNED_RESOURCES + 5;
      index++
    ) {
      many.push(valueOf(String(10000 + index), "nginx", index));
    }

    const kept: GcpSplitLearned = toGcpSplitLearned({
      values: many,
      label: SPLIT_LABEL,
      at: NOW,
      via: "promql",
    });

    expect(kept.others).toHaveLength(GCP_SPLIT_MAX_LEARNED_RESOURCES);
    // The five quietest went.
    expect(kept.others).not.toContainEqual(vmLabels("10000"));
    expect(kept.others).toContainEqual(
      vmLabels(String(10000 + GCP_SPLIT_MAX_LEARNED_RESOURCES + 4)),
    );
  });

  test("learned again an hour later while some resource is read for its busiest; a quarter of an hour while none reported; never while every value is read", () => {
    const at: (minutesAgo: number) => string = (minutesAgo: number): string => {
      return new Date(NOW.getTime() - minutesAgo * MINUTE_MS).toISOString();
    };
    const capped: GcpSplitLearned = {
      at: at(59),
      via: "promql",
      capped: [{ resource: vmLabels("1001"), values: ["nginx"] }],
      others: [],
    };

    expect(isGcpSplitLearnDue(undefined, NOW)).toBe(true);
    expect(isGcpSplitLearnDue(capped, NOW)).toBe(false);
    expect(isGcpSplitLearnDue({ ...capped, at: at(60) }, NOW)).toBe(true);
    expect(GCP_SPLIT_LEARN_EVERY_MS).toBe(60 * MINUTE_MS);

    const empty: GcpSplitLearned = {
      at: at(14),
      via: "promql",
      capped: [],
      others: [],
    };

    expect(isGcpSplitLearnDue(empty, NOW)).toBe(false);
    expect(isGcpSplitLearnDue({ ...empty, at: at(15) }, NOW)).toBe(true);
    expect(GCP_SPLIT_LEARN_EMPTY_EVERY_MS).toBe(15 * MINUTE_MS);

    // Every value read: each read learns from itself.
    expect(
      isGcpSplitLearnDue(
        { ...empty, at: at(600), others: [vmLabels("1002")] },
        NOW,
      ),
    ).toBe(false);
    // A time that is no time, or one ahead of now: learned again.
    expect(isGcpSplitLearnDue({ ...capped, at: "not a time" }, NOW)).toBe(true);
    expect(isGcpSplitLearnDue({ ...capped, at: at(-5) }, NOW)).toBe(true);
  });

  test("a learning's key: its project, metric, split and resources, in any order", () => {
    const ask: GcpAddedMetricAsk = {
      metric: {
        metricType: PROCESS_CPU,
        aligner: "ALIGN_RATE",
        unit: "us/s",
        group: "Traffic" as never,
        resourceType: "gce_instance",
        resourceTypes: ["gce_instance"],
        storedName: PROCESS_CPU,
        isRetired: false,
      },
      resourceType: "gce_instance",
      resourceLabels: { project_id: PROJECT_ID, zone: "us-central1-a" },
      resourceLabelIn: { label: "instance_id", values: ["1001", "1002"] },
      split: {
        label: SPLIT_LABEL,
        reducer: "REDUCE_SUM",
        resourceLabelKeys: RESOURCE_KEYS,
      },
    };
    const key: string = getGcpSplitLearnKey(PROJECT_ID, ask);

    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(
      getGcpSplitLearnKey(PROJECT_ID, {
        ...ask,
        resourceLabelIn: { label: "instance_id", values: ["1002", "1001"] },
      }),
    ).toBe(key);
    expect(getGcpSplitLearnKey("acme-staging", ask)).not.toBe(key);
    expect(
      getGcpSplitLearnKey(PROJECT_ID, {
        ...ask,
        resourceLabelIn: {
          label: "instance_id",
          values: ["1001", "1002", "1003"],
        },
      }),
    ).not.toBe(key);
    expect(
      getGcpSplitLearnKey(PROJECT_ID, {
        ...ask,
        split: { ...ask.split!, label: "owner" },
      }),
    ).not.toBe(key);
  });
});

describe("the calls a split is read in", () => {
  function typeAsk(): GcpAddedMetricAsk {
    return getGcpAddedMetricsToAsk({
      added: [addition()],
      projectId: PROJECT_ID,
      seenResourceTypes: new Set<string>(["gce_instance"]),
    })[0]!;
  }

  test("nothing capped: the ask as it is, every value", () => {
    const ask: GcpAddedMetricAsk = typeAsk();

    expect(
      planGcpSplitReads({
        ask,
        learned: {
          at: NOW.toISOString(),
          via: "promql",
          capped: [],
          others: [vmLabels("1001")],
        },
      }),
    ).toEqual([ask]);
  });

  test("VMs of the same busiest values share a call; ones that fit together join; the rest are read for every value, each VM in one call", () => {
    const ten: Array<string> = commands(0, 9);
    const planned: Array<GcpAddedMetricAsk> = planGcpSplitReads({
      ask: typeAsk(),
      learned: {
        at: NOW.toISOString(),
        via: "promql",
        capped: [
          { resource: vmLabels("1001"), values: ten },
          { resource: vmLabels("1002"), values: [...ten].reverse() },
          // Ten values of which five are new: no room beside the first ten.
          { resource: vmLabels("1003"), values: commands(5, 14) },
        ],
        others: [vmLabels("1004"), vmLabels("1005")],
      },
    });

    expect(
      planned.map((ask: GcpAddedMetricAsk) => {
        return {
          instances: ask.resources!.map((labels: Record<string, string>) => {
            return labels["instance_id"];
          }),
          values: ask.metricLabelIn?.values,
        };
      }),
    ).toEqual([
      { instances: ["1001", "1002"], values: ten },
      { instances: ["1003"], values: commands(5, 14) },
      { instances: ["1004", "1005"], values: undefined },
    ]);
    // Each call narrowed to its own VMs, as a batch is (#9810).
    expect(planned[0]!.resourceLabelIn).toEqual({
      label: "instance_id",
      values: ["1001", "1002"],
    });
    expect(planned[1]!.resourceLabels).toEqual(vmLabels("1003"));
  });

  test("a batch's own resources the learning never saw are read for every value", () => {
    const batch: GcpAddedMetricAsk = getGcpAddedMetricsToAsk({
      added: [ownAddition("1001"), ownAddition("1002"), ownAddition("1003")],
      projectId: PROJECT_ID,
      seenResourceTypes: new Set<string>(),
    })[0]!;
    const planned: Array<GcpAddedMetricAsk> = planGcpSplitReads({
      ask: batch,
      learned: {
        at: NOW.toISOString(),
        via: "promql",
        capped: [{ resource: vmLabels("1002"), values: ["nginx", "java"] }],
        // 1003 reported nothing in the hour: neither capped nor here.
        others: [vmLabels("1001")],
      },
    });

    expect(
      planned.map((ask: GcpAddedMetricAsk) => {
        return [
          ask.resources!.map((labels: Record<string, string>) => {
            return labels["instance_id"];
          }),
          ask.metricLabelIn?.values,
        ];
      }),
    ).toEqual([
      [["1002"], ["java", "nginx"]],
      [["1001", "1003"], undefined],
    ]);
  });

  test("however the values fall, no call asks for more than the cap's values, and every resource is read in one call", () => {
    let seed: number = 7;
    const random: () => number = (): number => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };

    for (let round: number = 0; round < 200; round++) {
      const capped: Array<{
        resource: Record<string, string>;
        values: Array<string>;
      }> = [];
      const others: Array<Record<string, string>> = [];
      const resources: number = 1 + Math.floor(random() * 30);

      for (let index: number = 0; index < resources; index++) {
        const labels: Record<string, string> = vmLabels(String(1000 + index));

        if (random() < 0.6) {
          const values: Set<string> = new Set<string>();

          while (values.size < CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES) {
            values.add(`cmd-${Math.floor(random() * 25)}`);
          }

          capped.push({ resource: labels, values: Array.from(values) });
        } else {
          others.push(labels);
        }
      }

      const planned: Array<GcpAddedMetricAsk> = planGcpSplitReads({
        ask: typeAsk(),
        learned: { at: NOW.toISOString(), via: "promql", capped, others },
      });

      // None capped: the type's own call, every VM and every value.
      if (capped.length === 0) {
        expect(planned).toEqual([typeAsk()]);
        continue;
      }

      const readIn: Map<string, number> = new Map();

      for (const ask of planned) {
        expect((ask.metricLabelIn?.values || []).length).toBeLessThanOrEqual(
          CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
        );

        for (const labels of ask.resources || []) {
          readIn.set(
            labels["instance_id"]!,
            (readIn.get(labels["instance_id"]!) || 0) + 1,
          );
        }
      }

      for (let index: number = 0; index < resources; index++) {
        expect(readIn.get(String(1000 + index))).toBe(1);
      }

      // A capped VM's call asks for its own busiest values, all of them.
      for (const entry of capped) {
        const call: GcpAddedMetricAsk = planned.find(
          (ask: GcpAddedMetricAsk): boolean => {
            return (ask.resources || []).some(
              (labels: Record<string, string>) => {
                return labels["instance_id"] === entry.resource["instance_id"];
              },
            );
          },
        )!;

        for (const value of entry.values) {
          expect(call.metricLabelIn!.values).toContain(value);
        }
      }
    }
  });
});

describe("what a read of every value learns", () => {
  const split: {
    label: string;
    reducer: string;
    resourceLabelKeys: Array<string>;
  } = {
    label: SPLIT_LABEL,
    reducer: "REDUCE_SUM",
    resourceLabelKeys: RESOURCE_KEYS,
  };

  function seriesOf(instanceId: string, count: number): Array<GcpTimeSeries> {
    return commands(0, count - 1).map(
      (command: string, index: number): GcpTimeSeries => {
        return {
          metricType: PROCESS_CPU,
          metricLabels: { [SPLIT_LABEL]: command },
          resourceType: "gce_instance",
          resourceLabels: vmLabels(instanceId),
          metadataName: "",
          points: [{ timeMs: 1, value: index + 1 }],
        };
      },
    );
  }

  test("a resource that now has the cap's values is read for its busiest from the next read, at no cost", () => {
    const learned: GcpSplitLearned = {
      at: NOW.toISOString(),
      via: "promql",
      capped: [],
      others: [vmLabels("1002")],
    };
    const updated: GcpSplitLearned | null = learnGcpSplitFromRead({
      learned,
      series: seriesOf("1002", 14),
      split,
    });

    expect(updated).toEqual({
      ...learned,
      capped: [
        { resource: vmLabels("1002"), values: commands(4, 13).reverse() },
      ],
      others: [],
    });
  });

  test("nothing new: unchanged; a resource it never saw is kept with the others", () => {
    const learned: GcpSplitLearned = {
      at: NOW.toISOString(),
      via: "promql",
      capped: [],
      others: [vmLabels("1002")],
    };

    expect(
      learnGcpSplitFromRead({ learned, series: seriesOf("1002", 3), split }),
    ).toBeNull();
    expect(
      learnGcpSplitFromRead({ learned, series: seriesOf("1003", 2), split })
        ?.others,
    ).toEqual([vmLabels("1002"), vmLabels("1003")]);
  });

  test("a type's resource the learning never saw, found by its key metrics, makes it due", () => {
    const learned: GcpSplitLearned = {
      at: NOW.toISOString(),
      via: "promql",
      capped: [{ resource: vmLabels("1001"), values: ["nginx"] }],
      others: [vmLabels("1002")],
    };

    expect(
      getGcpSplitResourcesUnseen({
        learned,
        split,
        found: [{ ...vmLabels("1001"), extra: "kept aside" }, vmLabels("1002")],
      }),
    ).toBe(0);
    expect(
      getGcpSplitResourcesUnseen({
        learned,
        split,
        found: [vmLabels("1001"), vmLabels("1003"), vmLabels("1003")],
      }),
    ).toBe(1);
    // Every value read: the read itself finds new resources.
    expect(
      getGcpSplitResourcesUnseen({
        learned: { ...learned, capped: [] },
        split,
        found: [vmLabels("1003")],
      }),
    ).toBe(0);
  });
});

// ---- A read, end to end, against Google ------------------------------------

describe("a split read against Google, as it answers and bills", () => {
  test("a type's split by a label of 30 values: Google returns the busiest 10 of the VM that has them, and every value of the VM that has 3", async () => {
    const fake: FakeGoogle = createFakeGoogle({
      series: {
        [CPU]: [cpuSeries("1001"), cpuSeries("1002")],
        [PROCESS_CPU]: [...processesOf("1001", 30), ...processesOf("1002", 3)],
      },
    });

    const result: CloudReadResult = await readAt(fake, [addition()], withVms());

    // Learned first, with PromQL: the 10 busiest of each VM alone.
    expect(fake.queries).toEqual([
      'topk by (instance_id, project_id, zone) (10, sum by (instance_id, project_id, zone, command) (rate({__name__="agent.googleapis.com/processes/cpu_time", monitored_resource="gce_instance", project_id="acme-prod"}[3600s])))',
    ]);
    expect(fake.billed.promql).toEqual([13]);

    // Then read: 1001 for its busiest 10 alone, 1002 for every value.
    const lists: Array<URL> = splitLists(fake);

    expect(lists).toHaveLength(2);
    expect(metricLabelValuesOf(lists[0]!)).toEqual(commands(20, 29));
    expect(resourceValuesOf(lists[0]!, "instance_id")).toEqual(["1001"]);
    expect(metricLabelValuesOf(lists[1]!)).toBeUndefined();
    expect(resourceValuesOf(lists[1]!, "instance_id")).toEqual(["1002"]);
    // Still split as before: the other labels added up by their sum.
    expect(lists[0]!.searchParams.get("aggregation.crossSeriesReducer")).toBe(
      "REDUCE_SUM",
    );
    expect(lists[0]!.searchParams.getAll("aggregation.groupByFields")).toEqual([
      "metric.label.command",
      "resource.label.instance_id",
      "resource.label.project_id",
      "resource.label.zone",
    ]);

    // Google returned - and billed - 10 and 3, where it returned 33 a read.
    expect(billedForSplit(fake)).toBe(13 + 13);
    expect(writtenValues(result)).toEqual([
      ...commands(20, 29).map((command: string): string => {
        return `1001:${command}`;
      }),
      "1002:cmd-00",
      "1002:cmd-01",
      "1002:cmd-02",
    ]);
    expect(result.warnings).toEqual([]);

    // What it learned is kept, for the next reads.
    const learned: Array<GcpSplitLearned> = Object.values(
      result.nextState.gcpSplitValues || {},
    );

    expect(learned).toEqual([
      {
        at: NOW.toISOString(),
        via: "promql",
        capped: [
          { resource: vmLabels("1001"), values: commands(20, 29).reverse() },
        ],
        others: [vmLabels("1002")],
      },
    ]);
  });

  test("an hour of reads costs Google what the estimate says: the cap's series a read, and as many again for the hour's learning", async () => {
    const fake: FakeGoogle = createFakeGoogle({
      series: {
        [CPU]: [cpuSeries("1001")],
        [PROCESS_CPU]: processesOf("1001", 30),
      },
    });
    let state: CloudConnectionPullState = withVms();

    // A read every five minutes, for an hour.
    for (let read: number = 0; read < 12; read++) {
      const result: CloudReadResult = await readAt(
        fake,
        [ownAddition("1001")],
        state,
        new Date(NOW.getTime() + read * 5 * MINUTE_MS),
      );

      expect(writtenValues(result)).toHaveLength(10);
      state = { ...result.nextState, ...withVms() };
    }

    // One learning, then each read for the 10 alone.
    expect(fake.queries).toHaveLength(1);
    expect(billedForSplit(fake)).toBe(10 + 12 * 10);

    const estimate: number = estimateCloudAddedMetricCost({
      provider: CloudProvider.GCP,
      resources: 1,
      readIntervalInMinutes: 5,
      isSplit: true,
      seriesPerResource: CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
    }).monthlyUnits;

    // The month's estimate is that hour, every hour of a 30-day month.
    expect(estimate).toBe((10 + 12 * 10) * getGcpSplitLearnsPerMonth());
    expect(estimate).toBe(
      10 * (getReadsPerMonth(5) + getGcpSplitLearnsPerMonth()),
    );

    // An hour on, it is learned again.
    await readAt(
      fake,
      [ownAddition("1001")],
      state,
      new Date(NOW.getTime() + 60 * MINUTE_MS),
    );

    expect(fake.queries).toHaveLength(2);
  });

  test("where PromQL cannot rank the values, they are learned from a list of the hour, every value once, and the reads are still for the busiest", async () => {
    const fake: FakeGoogle = createFakeGoogle({
      series: {
        [CPU]: [cpuSeries("1001")],
        [PROCESS_CPU]: processesOf("1001", 30),
      },
      promQl: (): FakeResponse => {
        return json(
          {
            status: "error",
            errorType: "bad_data",
            error:
              'invalid parameter "query": rate() cannot be applied to this metric',
          },
          400,
        );
      },
    });

    const result: CloudReadResult = await readAt(
      fake,
      [ownAddition("1001")],
      withVms(),
    );
    const lists: Array<URL> = splitLists(fake);

    // The learning: one point for the hour, every value.
    expect(lists[0]!.searchParams.get("aggregation.alignmentPeriod")).toBe(
      "3600s",
    );
    expect(lists[0]!.searchParams.get("interval.startTime")).toBe(
      "2026-10-21T11:03:00.000Z",
    );
    expect(metricLabelValuesOf(lists[0]!)).toBeUndefined();
    // The read: the busiest 10 alone.
    expect(lists[1]!.searchParams.get("aggregation.alignmentPeriod")).toBe(
      "60s",
    );
    expect(metricLabelValuesOf(lists[1]!)).toEqual(commands(20, 29));
    expect(writtenValues(result)).toHaveLength(10);
    // 30 once for the hour, then 10 a read; and the read says so.
    expect(billedForSplit(fake)).toBe(30 + 10);
    expect(result.warnings).toEqual([
      `Cloud Monitoring could not rank the values of ${PROCESS_CPU} by ${SPLIT_LABEL} with PromQL, so its busiest values were learned from all of them this hour.`,
    ]);
    expect(Object.values(result.nextState.gcpSplitValues || {})[0]!.via).toBe(
      "list",
    );
  });

  test("a split whose values cannot be learned is not read for every value: it is read once they are", async () => {
    let isDown: boolean = true;
    const fake: FakeGoogle = createFakeGoogle({
      series: {
        [CPU]: [cpuSeries("1001")],
        [PROCESS_CPU]: processesOf("1001", 30),
      },
      promQl: (): FakeResponse | undefined => {
        return isDown ? json({ error: "unavailable" }, 503) : undefined;
      },
      list: (url: URL): FakeResponse | undefined => {
        return isDown &&
          parseFilter(url.searchParams.get("filter") || "").metricType ===
            PROCESS_CPU
          ? json(
              { error: { code: 503, message: "The service is unavailable." } },
              503,
            )
          : undefined;
      },
    });

    const first: CloudReadResult = await readAt(
      fake,
      [ownAddition("1001")],
      withVms(),
    );

    // The learning's list alone: nothing read for every value.
    expect(splitLists(fake)).toHaveLength(1);
    expect(writtenValues(first)).toEqual([]);
    expect(first.warnings.join(" ")).toContain(
      `Could not learn which values of ${PROCESS_CPU} by ${SPLIT_LABEL} to read:`,
    );
    expect(first.nextState.gcpSplitValues).toEqual({});

    // Learned at the next read, and read.
    isDown = false;

    const second: CloudReadResult = await readAt(
      fake,
      [ownAddition("1001")],
      { ...first.nextState, ...withVms() },
      new Date(NOW.getTime() + 5 * MINUTE_MS),
    );

    expect(writtenValues(second)).toHaveLength(10);
    expect(second.warnings).toEqual([]);
  });

  test("a learning that fails an hour on keeps the values it last learned, and says so", async () => {
    const fake: FakeGoogle = createFakeGoogle({
      series: {
        [CPU]: [cpuSeries("1001")],
        [PROCESS_CPU]: processesOf("1001", 30),
      },
    });
    const first: CloudReadResult = await readAt(
      fake,
      [ownAddition("1001")],
      withVms(),
    );
    const failing: FakeGoogle = createFakeGoogle({
      series: {
        [CPU]: [cpuSeries("1001")],
        [PROCESS_CPU]: processesOf("1001", 30),
      },
      promQl: (): FakeResponse => {
        return json({ error: "unavailable" }, 503);
      },
      list: (url: URL): FakeResponse | undefined => {
        return url.searchParams.get("aggregation.alignmentPeriod") === "3600s"
          ? json({ error: { code: 503 } }, 503)
          : undefined;
      },
    });

    const later: CloudReadResult = await readAt(
      failing,
      [ownAddition("1001")],
      { ...first.nextState, ...withVms() },
      new Date(NOW.getTime() + 61 * MINUTE_MS),
    );

    expect(metricLabelValuesOf(splitLists(failing)[1]!)).toEqual(
      commands(20, 29),
    );
    expect(writtenValues(later)).toHaveLength(10);
    expect(later.warnings.join(" ")).toContain(
      ", so the last ones learned were read:",
    );
    expect(later.nextState.gcpSplitValues).toEqual(
      first.nextState.gcpSplitValues,
    );
  });

  test("a VM whose values pass the cap is read for every value once, and for its busiest from the next read, without asking PromQL", async () => {
    const fake: FakeGoogle = createFakeGoogle({
      series: {
        [CPU]: [cpuSeries("1002")],
        [PROCESS_CPU]: processesOf("1002", 3),
      },
    });
    const first: CloudReadResult = await readAt(
      fake,
      [ownAddition("1002")],
      withVms(),
    );

    expect(metricLabelValuesOf(splitLists(fake)[0]!)).toBeUndefined();
    expect(writtenValues(first)).toHaveLength(3);

    // It runs 14 commands now: read for every value, as nothing said otherwise.
    fake.setSeries({
      [CPU]: [cpuSeries("1002")],
      [PROCESS_CPU]: processesOf("1002", 14),
    });

    const second: CloudReadResult = await readAt(
      fake,
      [ownAddition("1002")],
      { ...first.nextState, ...withVms() },
      new Date(NOW.getTime() + 5 * MINUTE_MS),
    );

    expect(metricLabelValuesOf(splitLists(fake)[1]!)).toBeUndefined();
    // Kept: the busiest 10 of the 14.
    expect(writtenValues(second)).toHaveLength(10);

    const third: CloudReadResult = await readAt(
      fake,
      [ownAddition("1002")],
      { ...second.nextState, ...withVms() },
      new Date(NOW.getTime() + 10 * MINUTE_MS),
    );

    expect(fake.queries).toHaveLength(1);
    expect(metricLabelValuesOf(splitLists(fake)[2]!)).toEqual(commands(4, 13));
    expect(writtenValues(third)).toHaveLength(10);
  });

  test("a VM of the type that starts reporting is learned at the next read, not an hour on", async () => {
    const fake: FakeGoogle = createFakeGoogle({
      series: {
        [CPU]: [cpuSeries("1001")],
        [PROCESS_CPU]: processesOf("1001", 30),
      },
    });
    const first: CloudReadResult = await readAt(fake, [addition()], withVms());

    fake.setSeries({
      [CPU]: [cpuSeries("1001"), cpuSeries("1003")],
      [PROCESS_CPU]: [...processesOf("1001", 30), ...processesOf("1003", 4)],
    });

    // Found by its CPU, which the learning never saw: due again at once.
    const second: CloudReadResult = await readAt(
      fake,
      [addition()],
      { ...first.nextState, ...withVms() },
      new Date(NOW.getTime() + 5 * MINUTE_MS),
    );

    expect(fake.queries).toHaveLength(1);
    expect(Object.values(second.nextState.gcpSplitValues || {})[0]!.at).toBe(
      new Date(0).toISOString(),
    );

    const third: CloudReadResult = await readAt(
      fake,
      [addition()],
      { ...second.nextState, ...withVms() },
      new Date(NOW.getTime() + 10 * MINUTE_MS),
    );

    expect(fake.queries).toHaveLength(2);
    expect(writtenValues(third)).toContain("1003:cmd-03");
  });

  test("VMs' own additions are learned together, narrowed to their own VMs, and read each for its values", async () => {
    const fake: FakeGoogle = createFakeGoogle({
      series: {
        [CPU]: [cpuSeries("1001"), cpuSeries("1002"), cpuSeries("1003")],
        [PROCESS_CPU]: [
          ...processesOf("1001", 30),
          ...processesOf("1002", 2),
          // Not added for 1003: never asked, never billed.
          ...processesOf("1003", 40),
        ],
      },
    });

    const result: CloudReadResult = await readAt(
      fake,
      [ownAddition("1001"), ownAddition("1002")],
      withVms(),
    );

    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0]).toContain(
      'project_id="acme-prod", zone="us-central1-a", instance_id=~"1001|1002"',
    );
    expect(fake.billed.promql).toEqual([12]);
    expect(writtenValues(result)).not.toContain("1003:cmd-39");
    expect(
      writtenValues(result).filter((value: string): boolean => {
        return value.startsWith("1001:");
      }),
    ).toHaveLength(10);
    expect(billedForSplit(fake)).toBe(12 + 12);
  });

  test("a learning no longer asked is not kept", async () => {
    const fake: FakeGoogle = createFakeGoogle({
      series: {
        [CPU]: [cpuSeries("1001")],
        [PROCESS_CPU]: processesOf("1001", 30),
      },
    });
    const first: CloudReadResult = await readAt(
      fake,
      [ownAddition("1001")],
      withVms(),
    );

    expect(Object.keys(first.nextState.gcpSplitValues || {})).toHaveLength(1);

    // Removed: its learning goes with it.
    const second: CloudReadResult = await readAt(
      fake,
      [],
      { ...first.nextState, ...withVms() },
      new Date(NOW.getTime() + 5 * MINUTE_MS),
    );

    expect(second.nextState.gcpSplitValues).toEqual({});
  });
});
