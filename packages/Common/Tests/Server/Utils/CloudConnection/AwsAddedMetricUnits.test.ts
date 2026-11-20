import { describe, expect, test } from "@jest/globals";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import {
  AWS_UNIT_CHECK_EVERY_MS,
  AWS_UNIT_PROBE_EVERY_MS,
  AWS_UNIT_PROBES_PER_READ,
  AwsUnitProbe,
  buildAwsUnitProbeQueries,
  getAwsLearnedUnit,
  isAwsUnitProbeResult,
  planAwsUnitProbes,
  readAwsUnitProbe,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsAddedMetricUnits";
import {
  AWS_CLOUDWATCH_UNITS,
  AwsMetricQuery,
  MAX_QUERIES_PER_CALL,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudWatch";
import {
  AwsAddedMetricUnitState,
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudReadResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { getAwsDocumentedMetricUnit } from "../../../../Types/Cloud/AwsMetricUnits";
import {
  CloudAddedMetric,
  CloudAddedMetricScope,
  getCloudAddedMetricKey,
} from "../../../../Types/Cloud/CloudAddedMetrics";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { JSONObject } from "../../../../Types/JSON";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  FakeMetric,
  createFakeAws,
} from "./FakeAwsApi";

/*
 * #10077: AN ADDED AWS METRIC'S UNIT IS LEARNED, AND KEPT RIGHT, BY THE READ.
 *
 * GetMetricData's answers carry no unit, and it answers a query that names
 * a unit only with the data published in it. A unit was learned that way
 * when a metric was added, and again only when its More Metrics were
 * listed. Now the read asks too, in the GetMetricData call it makes anyway:
 * a query per unit while none is known, one query a day of the unit it is
 * believed to have - so a publisher that starts sending Bytes where it sent
 * None is caught - never a call more.
 *
 * The fake CloudWatch answers as CloudWatch does: each metric's datapoints
 * carry one unit (FakeMetric.unit, None when not set), and a query of
 * another unit has no data.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
// 12:07; the CloudWatch window ends ten minutes back, on five: 11:55.
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const WINDOW_END_S: number = Date.UTC(2026, 9, 21, 11, 55) / 1000;
const WINDOW_START_S: number = WINDOW_END_S - 3600;
const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

// A metric no AWS page states the unit of: its datapoints are all there is.
const METRIC: string = "AppQueueBacklog";
const STORED: string = `amazonaws.com/AWS/EC2/${METRIC}`;

const connector: AwsCloudConnector = new AwsCloudConnector();

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      regions: "us-east-1",
    },
    secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  };
}

function addition(overrides: Partial<CloudAddedMetric> = {}): CloudAddedMetric {
  const metric: CloudAddedMetric = {
    key: "",
    provider: CloudProvider.AWS,
    scope: CloudAddedMetricScope.Resource,
    resourceType: "AWS::EC2::Instance",
    cloudResourceId: "c1d2e3f4-0000-4000-8000-000000000001",
    accountId: FAKE_ACCOUNT_ID,
    region: "us-east-1",
    dimensions: [{ name: "InstanceId", value: "i-0aaa" }],
    namespace: "AWS/EC2",
    name: METRIC,
    aggregation: "Average",
    unit: "",
    addedAt: NOW.toISOString(),
    ...overrides,
  };

  return { ...metric, key: getCloudAddedMetricKey(metric) };
}

// A point every five minutes, from the first window on, for two days: each read's window has some.
function everyFiveMinutes(value: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];

  for (
    let time: number = WINDOW_START_S;
    time < WINDOW_START_S + 2 * 24 * 3600;
    time += 300
  ) {
    points.push([time, value]);
  }

  return points;
}

// An instance, its CPU, and the added metric's series, published in `unit`.
function instance(
  unit: string | undefined,
  options: { values?: Array<[number, number]>; instanceId?: string } = {},
): Array<FakeMetric> {
  const instanceId: string = options.instanceId || "i-0aaa";

  return [
    {
      namespace: "AWS/EC2",
      metricName: "CPUUtilization",
      dimensions: [["InstanceId", instanceId]],
      values: everyFiveMinutes(12),
    },
    {
      namespace: "AWS/EC2",
      metricName: METRIC,
      dimensions: [["InstanceId", instanceId]],
      values: options.values || everyFiveMinutes(40),
      ...(unit ? { unit } : {}),
    },
  ];
}

async function readAt(
  fake: FakeAws,
  added: Array<CloudAddedMetric>,
  state: CloudConnectionPullState,
  at: Date = NOW,
): Promise<CloudReadResult> {
  return await connector.read(settings(), {
    transport: fake.transport,
    now: () => {
      return at;
    },
    sleep: async () => {},
    state,
    serviceName: "Amazon Web Services",
    connectionId: "33333333-3333-4333-8333-333333333333",
    maxRequests: 3000,
    maxDurationMs: 60000,
    addedMetrics: added,
  });
}

// The GetMetricData calls a read made, and their unit queries.
function getMetricDataCalls(fake: FakeAws): Array<JSONObject> {
  return fake.cloudWatchCalls
    .filter((call: { action: string }): boolean => {
      return call.action === "GetMetricData";
    })
    .map((call: { body: JSONObject }): JSONObject => {
      return call.body;
    });
}

function unitQueriesOf(fake: FakeAws): Array<string> {
  return getMetricDataCalls(fake).flatMap((body: JSONObject) => {
    return (body["MetricDataQueries"] as Array<JSONObject>)
      .filter((query: JSONObject): boolean => {
        return isAwsUnitProbeResult(String(query["Id"]));
      })
      .map((query: JSONObject): string => {
        const stat: JSONObject = query["MetricStat"] as JSONObject;
        const metric: JSONObject = stat["Metric"] as JSONObject;

        return `${metric["MetricName"]} ${stat["Stat"]} ${stat["Unit"]} ${stat["Period"]}`;
      });
  });
}

// The unit each payload stored the added metric with.
function storedUnits(result: CloudReadResult): Array<string> {
  const units: Array<string> = [];

  for (const payload of result.payloads) {
    for (const rm of payload["resourceMetrics"] as Array<JSONObject>) {
      for (const sm of rm["scopeMetrics"] as Array<JSONObject>) {
        for (const metric of sm["metrics"] as Array<JSONObject>) {
          if (metric["name"] === STORED) {
            units.push(String(metric["unit"] ?? ""));
          }
        }
      }
    }
  }

  return units;
}

function unitStateOf(
  result: CloudReadResult,
  added: CloudAddedMetric,
): AwsAddedMetricUnitState | undefined {
  return result.nextState.awsAddedMetricUnits?.[added.key];
}

describe("which additions a read asks the unit of, and how", () => {
  const ago: (ms: number) => string = (ms: number): string => {
    return new Date(NOW.getTime() - ms).toISOString();
  };

  function plan(
    units: Record<string, AwsAddedMetricUnitState>,
    additions: Array<{ key: string; believedUnit: string }>,
    limits: { room?: number; probesLeft?: number } = {},
  ): Array<AwsUnitProbe> {
    return planAwsUnitProbes({
      additions: additions.map(
        (entry: { key: string; believedUnit: string }, index: number) => {
          return {
            ...entry,
            queryId: `q${index}`,
            namespace: "AWS/EC2",
            metricName: METRIC,
            dimensions: [{ name: "InstanceId", value: `i-${index}` }],
          };
        },
      ),
      units,
      now: NOW,
      room: limits.room ?? MAX_QUERIES_PER_CALL,
      probesLeft: limits.probesLeft ?? AWS_UNIT_PROBES_PER_READ,
    });
  }

  test("none known: every unit; one believed and unconfirmed: that one; confirmed within the day: none", () => {
    expect(
      plan({}, [
        { key: "a", believedUnit: "" },
        { key: "b", believedUnit: "Bytes" },
        { key: "c", believedUnit: "" },
      ]).map((probe: AwsUnitProbe) => {
        return [probe.key, probe.kind, probe.unit, probe.prefix];
      }),
    ).toEqual([
      ["a", "every", undefined, "u0"],
      ["b", "check", "Bytes", "u1"],
      ["c", "every", undefined, "u2"],
    ]);
    expect(
      plan({ b: { unit: "Bytes", checkedAt: ago(DAY_MS - MINUTE_MS) } }, [
        { key: "b", believedUnit: "Count" },
      ]),
    ).toEqual([]);
    // A day on, checked again: the learned unit, not the one believed.
    expect(
      plan({ b: { unit: "Bytes", checkedAt: ago(DAY_MS) } }, [
        { key: "b", believedUnit: "Count" },
      ])[0]!.unit,
    ).toBe("Bytes");
    expect(AWS_UNIT_CHECK_EVERY_MS).toBe(DAY_MS);
  });

  test("an addition is asked once an hour at most, but at once after a check found another unit", () => {
    expect(
      plan({ a: { probedAt: ago(HOUR_MS - MINUTE_MS) } }, [
        { key: "a", believedUnit: "" },
      ]),
    ).toEqual([]);
    expect(
      plan({ a: { probedAt: ago(HOUR_MS) } }, [
        { key: "a", believedUnit: "" },
      ])[0]!.kind,
    ).toBe("every");
    expect(
      plan({ a: { unit: "None", isChanged: true, probedAt: ago(MINUTE_MS) } }, [
        { key: "a", believedUnit: "None" },
      ])[0]!.kind,
    ).toBe("every");
    expect(AWS_UNIT_PROBE_EVERY_MS).toBe(HOUR_MS);
  });

  test("a few a read, each addition once, and only within the room the call has", () => {
    const five: Array<{ key: string; believedUnit: string }> = [
      { key: "a", believedUnit: "" },
      { key: "a", believedUnit: "" },
      { key: "b", believedUnit: "" },
      { key: "c", believedUnit: "" },
      { key: "d", believedUnit: "" },
    ];

    expect(
      plan({}, five).map((probe: AwsUnitProbe): string => {
        return probe.key;
      }),
    ).toEqual(["a", "b", "c"]);
    expect(plan({}, five, { probesLeft: 1 })).toHaveLength(1);
    // Room for a check, not for every unit: no call more is made for them.
    expect(
      plan(
        {},
        [
          { key: "a", believedUnit: "" },
          { key: "b", believedUnit: "Bytes" },
        ],
        { room: AWS_CLOUDWATCH_UNITS.length - 1 },
      ).map((probe: AwsUnitProbe): string => {
        return `${probe.key} ${probe.kind}`;
      }),
    ).toEqual(["b check"]);
    expect(plan({}, five, { room: 0 })).toEqual([]);
  });

  test("a unit that is none of CloudWatch's is no unit known: every unit is asked", () => {
    expect(
      plan({}, [{ key: "a", believedUnit: "Requests per second" }])[0]!.kind,
    ).toBe("every");
  });

  test("a probe's queries: its samples per period in each unit, or in the one checked, each found again by its id", () => {
    const every: Array<AwsMetricQuery> = buildAwsUnitProbeQueries(
      {
        key: "a",
        kind: "every",
        queryId: "q0",
        namespace: "AWS/EC2",
        metricName: METRIC,
        dimensions: [{ name: "InstanceId", value: "i-0aaa" }],
        prefix: "u1",
      },
      300,
    );

    expect(every).toHaveLength(AWS_CLOUDWATCH_UNITS.length);
    expect(every[0]).toEqual({
      id: "u1x0",
      namespace: "AWS/EC2",
      metricName: METRIC,
      dimensions: [{ name: "InstanceId", value: "i-0aaa" }],
      statistic: "SampleCount",
      periodSeconds: 300,
      unit: "Seconds",
    });
    expect(
      every.map((query: AwsMetricQuery): string => {
        return query.unit || "";
      }),
    ).toEqual([...AWS_CLOUDWATCH_UNITS]);

    const check: Array<AwsMetricQuery> = buildAwsUnitProbeQueries(
      {
        key: "a",
        kind: "check",
        unit: "Bytes",
        queryId: "q0",
        namespace: "AWS/EC2",
        metricName: METRIC,
        dimensions: [],
        prefix: "u0",
      },
      300,
    );

    expect(
      check.map((query: AwsMetricQuery) => {
        return [query.id, query.unit];
      }),
    ).toEqual([[`u0x${AWS_CLOUDWATCH_UNITS.indexOf("Bytes")}`, "Bytes"]]);
    expect(isAwsUnitProbeResult("u0x4")).toBe(true);
    expect(isAwsUnitProbeResult("q3")).toBe(false);
    expect(isAwsUnitProbeResult("u0")).toBe(false);
  });
});

describe("what a probe's answers say of the unit", () => {
  const every: AwsUnitProbe = {
    key: "a",
    kind: "every",
    queryId: "q0",
    namespace: "AWS/EC2",
    metricName: METRIC,
    dimensions: [],
    prefix: "u0",
  };
  const at: string = NOW.toISOString();
  const bytes: number = AWS_CLOUDWATCH_UNITS.indexOf("Bytes");
  const none: number = AWS_CLOUDWATCH_UNITS.indexOf("None");

  test("every unit: the one with the samples; the most where it was sent in two", () => {
    expect(
      readAwsUnitProbe({
        probe: every,
        results: [
          { id: "q0", timestamps: [1, 2], values: [40, 42] },
          { id: `u0x${bytes}`, timestamps: [1, 2], values: [5, 5] },
        ],
        state: undefined,
        now: NOW,
      }),
    ).toEqual({ unit: "Bytes", checkedAt: at, probedAt: at });
    expect(
      readAwsUnitProbe({
        probe: every,
        results: [
          { id: `u0x${none}`, timestamps: [1], values: [2] },
          { id: `u0x${bytes}`, timestamps: [1, 2], values: [5, 5] },
          // Another probe's: never this one's.
          { id: `u1x${none}`, timestamps: [1, 2], values: [90, 90] },
        ],
        state: undefined,
        now: NOW,
      }).unit,
    ).toBe("Bytes");
  });

  test("every unit with no data in the window says nothing: kept as it was, asked an hour later", () => {
    expect(
      readAwsUnitProbe({
        probe: every,
        results: [],
        state: { unit: "None", isChanged: true },
        now: NOW,
      }),
    ).toEqual({ unit: "None", isChanged: false, probedAt: at });
  });

  test("a check: samples at every time the addition has a value confirm it; fewer say it changed; no value says nothing", () => {
    const check: AwsUnitProbe = { ...every, kind: "check", unit: "None" };

    expect(
      readAwsUnitProbe({
        probe: check,
        results: [
          { id: "q0", timestamps: [1, 2], values: [40, 42] },
          { id: `u0x${none}`, timestamps: [1, 2], values: [3, 3] },
        ],
        state: { unit: "None", checkedAt: "2026-10-01T00:00:00.000Z" },
        now: NOW,
      }),
    ).toEqual({ unit: "None", checkedAt: at, probedAt: at });
    // Sent in another unit since the first point.
    expect(
      readAwsUnitProbe({
        probe: check,
        results: [
          { id: "q0", timestamps: [1, 2], values: [40, 42] },
          { id: `u0x${none}`, timestamps: [1], values: [3] },
        ],
        state: { unit: "None" },
        now: NOW,
      }),
    ).toEqual({ unit: "None", isChanged: true, probedAt: at });
    expect(
      readAwsUnitProbe({
        probe: check,
        results: [{ id: `u0x${none}`, timestamps: [], values: [] }],
        state: { unit: "None" },
        now: NOW,
      }),
    ).toEqual({ unit: "None", probedAt: at });
  });

  test("what an account's reads learned is found in its own state, an organization's account's in its own", () => {
    expect(
      getAwsLearnedUnit({
        pullState: { awsAddedMetricUnits: { k: { unit: "Bytes" } } },
        key: "k",
      }),
    ).toBe("Bytes");
    expect(
      getAwsLearnedUnit({
        pullState: {
          accountStates: {
            "210987654321": { awsAddedMetricUnits: { k: { unit: "Count" } } },
          },
        },
        accountId: "210987654321",
        key: "k",
      }),
    ).toBe("Count");
    expect(
      getAwsLearnedUnit({
        pullState: { awsAddedMetricUnits: { k: { probedAt: "x" } } },
        key: "k",
      }),
    ).toBe("");
    expect(getAwsLearnedUnit({ pullState: undefined, key: "k" })).toBe("");
  });
});

describe("the read learns and keeps an added metric's unit", () => {
  test("a unit never learned is learned in the read's own GetMetricData call, and its points are written with it", async () => {
    expect(getAwsDocumentedMetricUnit("AWS/EC2", METRIC)).toBe("");

    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: instance("Bytes") } },
    });
    const added: CloudAddedMetric = addition();
    const result: CloudReadResult = await readAt(fake, [added], {});

    // No call more: the queries ride in the one that reads its values.
    expect(getMetricDataCalls(fake)).toHaveLength(1);
    expect(unitQueriesOf(fake)).toEqual(
      AWS_CLOUDWATCH_UNITS.map((unit: string): string => {
        return `${METRIC} SampleCount ${unit} 300`;
      }),
    );
    expect(storedUnits(result)).toEqual(["Bytes"]);
    expect(unitStateOf(result, added)).toEqual({
      unit: "Bytes",
      checkedAt: NOW.toISOString(),
      probedAt: NOW.toISOString(),
    });

    // Learned: the next reads ask nothing until the day is out.
    const next: CloudReadResult = await readAt(
      fake,
      [added],
      result.nextState,
      new Date(NOW.getTime() + 5 * MINUTE_MS),
    );

    expect(unitQueriesOf(fake)).toHaveLength(AWS_CLOUDWATCH_UNITS.length);
    expect(storedUnits(next)).toEqual(["Bytes"]);
  });

  test("a unit kept with the addition is checked once a day with one query, and confirmed", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: instance("Count") } },
    });
    const added: CloudAddedMetric = addition({ unit: "Count" });
    const first: CloudReadResult = await readAt(fake, [added], {});

    expect(unitQueriesOf(fake)).toEqual([`${METRIC} SampleCount Count 300`]);
    expect(unitStateOf(first, added)).toEqual({
      unit: "Count",
      checkedAt: NOW.toISOString(),
      probedAt: NOW.toISOString(),
    });

    await readAt(
      fake,
      [added],
      first.nextState,
      new Date(NOW.getTime() + 23 * HOUR_MS),
    );
    expect(unitQueriesOf(fake)).toHaveLength(1);

    await readAt(
      fake,
      [added],
      first.nextState,
      new Date(NOW.getTime() + DAY_MS),
    );
    expect(unitQueriesOf(fake)).toHaveLength(2);
  });

  test("a unit that changes - Bytes where it sent None - is found by the day's check, learned at the next read, and written with from then", async () => {
    const metrics: Array<FakeMetric> = instance("None");
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics } },
    });
    const added: CloudAddedMetric = addition({ unit: "None" });
    const first: CloudReadResult = await readAt(fake, [added], {});

    expect(storedUnits(first)).toEqual(["None"]);
    expect(unitStateOf(first, added)!.unit).toBe("None");

    // The publisher sends Bytes now.
    metrics[1]!.unit = "Bytes";

    const checked: CloudReadResult = await readAt(
      fake,
      [added],
      first.nextState,
      new Date(NOW.getTime() + DAY_MS),
    );

    expect(unitStateOf(checked, added)).toEqual(
      expect.objectContaining({ unit: "None", isChanged: true }),
    );

    const learned: CloudReadResult = await readAt(
      fake,
      [added],
      checked.nextState,
      new Date(NOW.getTime() + DAY_MS + 5 * MINUTE_MS),
    );

    // Every unit asked at once after the change, though an hour has not passed.
    expect(unitQueriesOf(fake).slice(-AWS_CLOUDWATCH_UNITS.length)).toEqual(
      AWS_CLOUDWATCH_UNITS.map((unit: string): string => {
        return `${METRIC} SampleCount ${unit} 300`;
      }),
    );
    expect(unitStateOf(learned, added)).toEqual({
      unit: "Bytes",
      checkedAt: new Date(NOW.getTime() + DAY_MS + 5 * MINUTE_MS).toISOString(),
      probedAt: new Date(NOW.getTime() + DAY_MS + 5 * MINUTE_MS).toISOString(),
    });
    expect(storedUnits(learned)).toEqual(["Bytes"]);
  });

  test("no data in the window says nothing: no unit is made up, and it is asked again an hour later", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: instance("Bytes", { values: [] }) } },
    });
    const added: CloudAddedMetric = addition();
    const first: CloudReadResult = await readAt(fake, [added], {});

    expect(storedUnits(first)).toEqual([]);
    expect(unitStateOf(first, added)).toEqual({
      isChanged: false,
      probedAt: NOW.toISOString(),
    });

    await readAt(
      fake,
      [added],
      first.nextState,
      new Date(NOW.getTime() + 30 * MINUTE_MS),
    );
    expect(unitQueriesOf(fake)).toHaveLength(AWS_CLOUDWATCH_UNITS.length);

    await readAt(
      fake,
      [added],
      first.nextState,
      new Date(NOW.getTime() + HOUR_MS),
    );
    expect(unitQueriesOf(fake)).toHaveLength(2 * AWS_CLOUDWATCH_UNITS.length);
  });

  test("a type's addition is asked once, on its first series, however many resources read it", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [
            ...instance("Percent", { instanceId: "i-0aaa" }),
            ...instance("Percent", { instanceId: "i-0bbb" }),
          ],
        },
      },
    });
    const added: CloudAddedMetric = addition({
      scope: CloudAddedMetricScope.Type,
      cloudResourceId: undefined,
      accountId: undefined,
      region: undefined,
      dimensions: undefined,
    });
    const result: CloudReadResult = await readAt(fake, [added], {});

    expect(unitQueriesOf(fake)).toHaveLength(AWS_CLOUDWATCH_UNITS.length);
    // Both resources' points written with what one series said.
    expect(storedUnits(result)).toEqual(["Percent"]);
    expect(unitStateOf(result, added)!.unit).toBe("Percent");
  });

  test("a few additions a read: the rest are asked at the next one", async () => {
    const metrics: Array<FakeMetric> = [];
    const added: Array<CloudAddedMetric> = [];

    for (let index: number = 0; index < 5; index++) {
      const id: string = `i-0${index}`;

      metrics.push(...instance("Bytes", { instanceId: id }));
      added.push(
        addition({
          cloudResourceId: `row-${index}`,
          dimensions: [{ name: "InstanceId", value: id }],
        }),
      );
    }

    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics } },
    });
    const first: CloudReadResult = await readAt(fake, added, {});
    const learnedFirst: Array<string> = added
      .filter((metric: CloudAddedMetric): boolean => {
        return Boolean(unitStateOf(first, metric)?.unit);
      })
      .map((metric: CloudAddedMetric): string => {
        return metric.cloudResourceId!;
      });

    expect(learnedFirst).toHaveLength(AWS_UNIT_PROBES_PER_READ);

    const second: CloudReadResult = await readAt(
      fake,
      added,
      first.nextState,
      new Date(NOW.getTime() + 5 * MINUTE_MS),
    );

    expect(
      added.filter((metric: CloudAddedMetric): boolean => {
        return unitStateOf(second, metric)?.unit === "Bytes";
      }),
    ).toHaveLength(5);
  });

  test("an addition no longer added leaves nothing in the read state", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: instance("Bytes") } },
    });
    const added: CloudAddedMetric = addition();
    const first: CloudReadResult = await readAt(fake, [added], {});

    expect(Object.keys(first.nextState.awsAddedMetricUnits || {})).toEqual([
      added.key,
    ]);

    const second: CloudReadResult = await readAt(
      fake,
      [],
      first.nextState,
      new Date(NOW.getTime() + 5 * MINUTE_MS),
    );

    expect(second.nextState.awsAddedMetricUnits).toEqual({});
  });
});
