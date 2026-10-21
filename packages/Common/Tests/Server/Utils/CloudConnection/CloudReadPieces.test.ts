import { describe, expect, test } from "@jest/globals";
import {
  Settled,
  mapWithConcurrency,
} from "../../../../Server/Utils/CloudConnection/CloudConcurrency";
import {
  CLOUD_CONNECTION_ID_ATTRIBUTE,
  CloudMetricGroup,
  MAX_DATAPOINTS_PER_PAYLOAD,
  buildMetricsPayloads,
  connectionResourceAttributes,
  countPayloadPoints,
  kvlistAttribute,
  resolveCloudResourceOf,
  storedAttributesOf,
  stringAttribute,
} from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import {
  AWS_METRIC_DELAY_MS,
  MetricWindow,
  getMetricWindow,
  getMetricWindowPolicy,
} from "../../../../Server/Utils/CloudConnection/CloudMetricWindows";
import { CloudReadBudget } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { CloudMonitoredResource } from "../../../../Types/Cloud/CloudMonitoredResource";
import { JSONArray, JSONObject } from "../../../../Types/JSON";

/*
 * The pieces every cloud's read shares: the OTLP/JSON export in the
 * receivers' shape (split so no request grows past a limit, stored the way
 * the ingest stores it), the window each read asks for so no datapoint is
 * written twice, the budget a read stops at, and running calls side by side
 * without one failure stopping the others.
 */

function group(points: number, name: string = "m"): CloudMetricGroup {
  const values: Array<{ timeMs: number; value: number }> = [];

  for (let index: number = 0; index < points; index++) {
    values.push({ timeMs: 1000 + index, value: index });
  }

  return {
    resourceAttributes: [stringAttribute("service.name", "svc")],
    metrics: [
      {
        name,
        unit: "1",
        datapointSets: [
          { attributes: [stringAttribute("a", "b")], points: values },
        ],
      },
    ],
  };
}

describe("the export", () => {
  test("each group is an OTel resource with one scope, its metrics gauges of double datapoints", () => {
    const payloads: Array<JSONObject> = buildMetricsPayloads([group(2, "cpu")]);

    expect(payloads).toEqual([
      {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "svc" } },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "oneuptime-cloud-connection", version: "1.0.0" },
                metrics: [
                  {
                    name: "cpu",
                    unit: "1",
                    gauge: {
                      dataPoints: [
                        {
                          startTimeUnixNano: "1000000000",
                          timeUnixNano: "1000000000",
                          asDouble: 0,
                          attributes: [
                            { key: "a", value: { stringValue: "b" } },
                          ],
                        },
                        {
                          startTimeUnixNano: "1001000000",
                          timeUnixNano: "1001000000",
                          asDouble: 1,
                          attributes: [
                            { key: "a", value: { stringValue: "b" } },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  test("requests are split before they pass the datapoint limit; a group is never split", () => {
    const half: number = MAX_DATAPOINTS_PER_PAYLOAD / 2;
    const payloads: Array<JSONObject> = buildMetricsPayloads([
      group(half),
      group(half),
      group(1),
      group(MAX_DATAPOINTS_PER_PAYLOAD + 5),
    ]);

    expect(
      payloads.map((payload: JSONObject): number => {
        return (payload["resourceMetrics"] as JSONArray).length;
      }),
    ).toEqual([2, 1, 1]);
    expect(countPayloadPoints([group(3), group(4)])).toBe(7);
  });

  test("a group or a metric with no datapoint is left out", () => {
    expect(buildMetricsPayloads([group(0)])).toEqual([]);

    const mixed: CloudMetricGroup = group(1, "kept");
    mixed.metrics.push({ name: "empty", unit: "1", datapointSets: [] });

    const metrics: JSONArray = (
      (
        (
          (
            buildMetricsPayloads([mixed])[0]!["resourceMetrics"] as JSONArray
          )[0] as JSONObject
        )["scopeMetrics"] as JSONArray
      )[0] as JSONObject
    )["metrics"] as JSONArray;

    expect(
      metrics.map((metric: unknown) => {
        return (metric as JSONObject)["name"];
      }),
    ).toEqual(["kept"]);
  });

  test("a connection's resources carry its service, its cloud and its id", () => {
    expect(
      connectionResourceAttributes({
        serviceName: "Production AWS",
        connectionId: "conn-1",
        cloudProvider: "aws",
      }),
    ).toEqual([
      { key: "service.name", value: { stringValue: "Production AWS" } },
      { key: "cloud.provider", value: { stringValue: "aws" } },
      { key: CLOUD_CONNECTION_ID_ATTRIBUTE, value: { stringValue: "conn-1" } },
    ]);
  });

  test("stored attributes are the ingest's: resource keys prefixed, kvlists flattened", () => {
    expect(
      storedAttributesOf(
        [stringAttribute("cloud.region", "us-east-1")],
        [
          stringAttribute("Namespace", "AWS/EC2"),
          kvlistAttribute("Dimensions", [stringAttribute("InstanceId", "i-1")]),
        ],
      ),
    ).toEqual({
      "resource.cloud.region": "us-east-1",
      Namespace: "AWS/EC2",
      "Dimensions.InstanceId": "i-1",
    });
  });

  test("the resource of a datapoint is the ingest resolver's", () => {
    const resource: CloudMonitoredResource | null = resolveCloudResourceOf({
      metricName: "amazonaws.com/AWS/EC2/CPUUtilization",
      resourceAttributes: [
        stringAttribute("cloud.account.id", "123456789012"),
        stringAttribute("cloud.region", "us-east-1"),
      ],
      datapointAttributes: [
        stringAttribute("Namespace", "AWS/EC2"),
        kvlistAttribute("Dimensions", [stringAttribute("InstanceId", "i-1")]),
      ],
    });

    expect(resource?.providerResourceId).toBe(
      "arn:aws:ec2:us-east-1:123456789012:instance/i-1",
    );
    expect(
      resolveCloudResourceOf({
        metricName: "http.requests",
        resourceAttributes: [],
        datapointAttributes: [],
      }),
    ).toBeNull();
  });
});

describe("the window a read asks for", () => {
  const NOW: Date = new Date("2026-10-21T12:07:30Z");

  test("a first read: the last hour, ending a delay back on a whole period", () => {
    const window: MetricWindow | null = getMetricWindow({
      policy: getMetricWindowPolicy({
        periodSeconds: 300,
        delayMs: AWS_METRIC_DELAY_MS,
      }),
      now: NOW,
    });

    expect(window).toEqual({
      periodSeconds: 300,
      start: new Date("2026-10-21T10:55:00Z"),
      end: new Date("2026-10-21T11:55:00Z"),
    });
  });

  test("the next read starts where the last stopped", () => {
    const window: MetricWindow | null = getMetricWindow({
      policy: getMetricWindowPolicy({ periodSeconds: 60, delayMs: 4 * 60000 }),
      cursor: "2026-10-21T11:58:00.000Z",
      now: NOW,
    });

    expect(window).toEqual({
      periodSeconds: 60,
      start: new Date("2026-10-21T11:58:00Z"),
      end: new Date("2026-10-21T12:03:00Z"),
    });
  });

  test("nothing new since the last read is no window", () => {
    expect(
      getMetricWindow({
        policy: getMetricWindowPolicy({
          periodSeconds: 60,
          delayMs: 4 * 60000,
        }),
        cursor: "2026-10-21T12:03:00.000Z",
        now: NOW,
      }),
    ).toBeNull();
  });

  test("after a long pause it goes back six hours at most", () => {
    const window: MetricWindow | null = getMetricWindow({
      policy: getMetricWindowPolicy({ periodSeconds: 60, delayMs: 4 * 60000 }),
      cursor: "2026-10-01T00:00:00.000Z",
      now: NOW,
    });

    expect(window!.start).toEqual(new Date("2026-10-21T06:03:00Z"));
  });

  test("a cursor that is not a time is read as no cursor", () => {
    expect(
      getMetricWindow({
        policy: getMetricWindowPolicy({
          periodSeconds: 60,
          delayMs: 4 * 60000,
        }),
        cursor: "yesterday",
        now: NOW,
      })!.start,
    ).toEqual(new Date("2026-10-21T11:03:00Z"));
  });

  test("a day: a day and a half back, whole days, three at most", () => {
    const policy: ReturnType<typeof getMetricWindowPolicy> =
      getMetricWindowPolicy({
        periodSeconds: 86400,
        delayMs: AWS_METRIC_DELAY_MS,
      });

    expect(getMetricWindow({ policy, now: NOW })).toEqual({
      periodSeconds: 86400,
      start: new Date("2026-10-19T00:00:00Z"),
      end: new Date("2026-10-20T00:00:00Z"),
    });
    expect(
      getMetricWindow({ policy, cursor: "2026-10-01T00:00:00Z", now: NOW })!
        .start,
    ).toEqual(new Date("2026-10-17T00:00:00Z"));
  });

  test("an hour: an hour back at least, three hours first", () => {
    const policy: ReturnType<typeof getMetricWindowPolicy> =
      getMetricWindowPolicy({
        periodSeconds: 3600,
        delayMs: 4 * 60000,
      });

    expect(policy.delayMs).toBe(3600000);
    expect(getMetricWindow({ policy, now: NOW })).toEqual({
      periodSeconds: 3600,
      start: new Date("2026-10-21T08:00:00Z"),
      end: new Date("2026-10-21T11:00:00Z"),
    });
  });
});

describe("the budget", () => {
  test("counts what it gives, and is spent past its limit", () => {
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: 2,
      maxDurationMs: 60000,
    });

    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(true);
    expect(budget.isSpent()).toBe(false);
    expect(budget.take()).toBe(false);
    expect(budget.isSpent()).toBe(true);
    expect(budget.getUsed()).toBe(2);
  });

  test("is spent once its time is up", () => {
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: 100,
      maxDurationMs: 0,
    });

    expect(budget.take()).toBe(false);
  });
});

describe("running side by side", () => {
  test("keeps the items' order, the limit, and every outcome", async () => {
    let running: number = 0;
    let most: number = 0;

    const outcomes: Array<Settled<number>> = await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      2,
      async (item: number): Promise<number> => {
        running++;
        most = Math.max(most, running);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, (7 - item) * 2);
        });
        running--;

        if (item === 3) {
          throw new Error("three");
        }

        return item * 10;
      },
    );

    expect(most).toBe(2);
    expect(
      outcomes.map((outcome: Settled<number>) => {
        return outcome.ok ? outcome.value : (outcome.error as Error).message;
      }),
    ).toEqual([10, 20, "three", 40, 50, 60]);
  });

  test("nothing to run is nothing", async () => {
    expect(
      await mapWithConcurrency([], 4, async () => {
        return 1;
      }),
    ).toEqual([]);
  });
});
