import { afterEach, describe, expect, test } from "@jest/globals";
import {
  CollectedCloudReadings,
  collectCloudResourceReadings,
} from "../../../../Server/Utils/CloudConnection/CloudResourceReadings";
import {
  CloudMetricGroup,
  buildMetricsPayloads,
  connectionResourceAttributes,
  kvlistAttribute,
  stringAttribute,
} from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import CloudStreamReadings, {
  CLOUD_STREAM_READINGS_FRESH_MS,
  CLOUD_STREAM_READINGS_PERIOD_MS,
  CLOUD_STREAM_READINGS_SETTLE_MS,
  CLOUD_STREAM_READINGS_TTL_SECONDS,
  REDIS_STREAM_READINGS_STORE,
  StreamedReadingMinute,
  StreamedReadingPeriod,
  getFreshStreamedReadingSources,
  getStreamedReadingField,
  getStreamedReadingPeriodStart,
  getStreamedReadingsPeriodKey,
  getStreamedReadingsSourcesKey,
  mergeCollectedReadings,
  mergeStreamedReadingMinute,
  readStreamedReadingPeriod,
  readStreamedReadings,
  readStreamedStatistic,
  toStreamedReadingMinute,
  writeStreamedReadingPeriod,
} from "../../../../Server/Utils/CloudConnection/CloudStreamReadings";
import { getAwsStoredMetricName } from "../../../../Types/Cloud/CloudKeyMetrics";
import {
  MemoryStreamReadingsStore,
  createMemoryStreamReadingsStore,
} from "../../../Helpers/MemoryStreamReadingsStore";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudHealthAssessment,
  assessCloudResourceHealth,
  getCloudHeadlineReadings,
} from "../../../../Types/Cloud/CloudResourceHealth";

/*
 * #9690: a streaming AWS account's resources are judged from their stream.
 * The ingest notes each minute of a metric a resource's readings keep, with
 * the minute's own summary; the read takes, per resource and reading, the
 * newest five-minute period the stream has had time to finish, as the
 * read's statistic over it - so a streaming account's health and headlines
 * read what a read of the same CloudWatch data reads - and leaves those
 * metrics to the stream only where its account and Region's readings are
 * fresh.
 */

const ACCOUNT: string = "123456789012";
const REGION: string = "us-east-1";
const CONNECTION: string = "33333333-3333-4333-8333-333333333333";
// 12:00 is a period's start; a read at 12:12 has the 12:00 to 12:05 period settled.
const PERIOD: number = Date.parse("2026-11-19T12:00:00.000Z");
const MINUTE: number = 60_000;
const NOW: Date = new Date(PERIOD + 12 * MINUTE);

const ALB: CloudMonitoredResource = resolveCloudMonitoredResource({
  metricName: getAwsStoredMetricName("AWS/ApplicationELB", "RequestCount"),
  attributes: {
    Namespace: "AWS/ApplicationELB",
    "Dimensions.LoadBalancer": "app/checkout/50dc6c495c0c9188",
    "resource.cloud.account.id": ACCOUNT,
    "resource.cloud.region": REGION,
  },
})!;
const ALB_IDENTIFIER: string =
  buildCloudMonitoredResourceIdentifier(ALB).toLowerCase();

// A minute of the load balancer's metric, as the stream delivers it.
function albMinute(
  metricName: string,
  minute: number,
  summary: { count: number; sum: number; min?: number; max?: number },
): StreamedReadingMinute {
  return toStreamedReadingMinute({
    resource: ALB,
    metricName: getAwsStoredMetricName("AWS/ApplicationELB", metricName),
    dimensions: { LoadBalancer: "app/checkout/50dc6c495c0c9188" },
    minuteMs: PERIOD + minute * MINUTE,
    count: summary.count,
    sum: summary.sum,
    min: summary.min ?? null,
    max: summary.max ?? null,
  })!;
}

afterEach(() => {
  CloudStreamReadings.store = REDIS_STREAM_READINGS_STORE;
});

describe("a minute of a reading, as the stream delivers it", () => {
  test("only a metric the resource's readings keep, with its key, its series and the minute's summary", () => {
    expect(
      albMinute("RequestCount", 2, { count: 1, sum: 120, min: 120, max: 120 }),
    ).toEqual({
      identifier: ALB_IDENTIFIER,
      resourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
      key: "aws/applicationelb/requestcount",
      series: "loadbalancer=app/checkout/50dc6c495c0c9188",
      accountId: ACCOUNT,
      region: REGION,
      minuteMs: PERIOD + 2 * MINUTE,
      count: 1,
      sum: 120,
      min: 120,
      max: 120,
    });
    // A key metric no rule, headline or recommended monitor of the type reads.
    expect(
      toStreamedReadingMinute({
        resource: ALB,
        metricName: getAwsStoredMetricName(
          "AWS/ApplicationELB",
          "NewConnectionCount",
        ),
        dimensions: {},
        minuteMs: PERIOD,
        count: 1,
        sum: 4,
        min: 4,
        max: 4,
      }),
    ).toBeNull();
    // A minute with no value.
    expect(
      toStreamedReadingMinute({
        resource: ALB,
        metricName: getAwsStoredMetricName(
          "AWS/ApplicationELB",
          "RequestCount",
        ),
        dimensions: {},
        minuteMs: PERIOD,
        count: 0,
        sum: 0,
        min: null,
        max: null,
      }),
    ).toBeNull();
  });

  test("a minute without its least and most: its average stands for both", () => {
    const minute: StreamedReadingMinute = albMinute("TargetResponseTime", 0, {
      count: 4,
      sum: 2,
    });

    expect([minute.min, minute.max]).toEqual([0.5, 0.5]);
  });

  // The store's script reads every number back: one that is not one would fail the whole delivery's merge.
  test("a least or most that is not a number: the average stands for it", () => {
    const minute: StreamedReadingMinute = albMinute("TargetResponseTime", 0, {
      count: 4,
      sum: 2,
      min: Number.NaN,
      max: Number.POSITIVE_INFINITY,
    });

    expect([minute.min, minute.max]).toEqual([0.5, 0.5]);
  });
});

describe("a period of a series, as it is kept", () => {
  test("each minute counted once, however many times a delivery is sent", () => {
    const minute: StreamedReadingMinute = albMinute("RequestCount", 3, {
      count: 1,
      sum: 100,
      min: 100,
      max: 100,
    });
    const once: StreamedReadingPeriod = mergeStreamedReadingMinute(
      null,
      minute,
    );
    const twice: StreamedReadingPeriod = mergeStreamedReadingMinute(
      once,
      minute,
    );

    expect(once).toEqual({
      minutes: "00010",
      count: 1,
      sum: 100,
      min: 100,
      max: 100,
    });
    expect(twice).toEqual(once);
  });

  test("its minutes add up, the least and the most kept", () => {
    let period: StreamedReadingPeriod | null = null;

    for (const [minute, value] of [
      [0, 5],
      [1, 9],
      [4, 2],
    ] as Array<[number, number]>) {
      period = mergeStreamedReadingMinute(
        period,
        albMinute("TargetResponseTime", minute, {
          count: 2,
          sum: value * 2,
          min: value - 1,
          max: value + 1,
        }),
      );
    }

    expect(period).toEqual({
      minutes: "11001",
      count: 6,
      sum: 32,
      min: 1,
      max: 10,
    });
  });

  test("a minute is its period's by its start: 12:05 starts the next one", () => {
    expect(getStreamedReadingPeriodStart(PERIOD + 4 * MINUTE)).toBe(PERIOD);
    expect(getStreamedReadingPeriodStart(PERIOD + 5 * MINUTE)).toBe(
      PERIOD + CLOUD_STREAM_READINGS_PERIOD_MS,
    );
  });

  test("written and read back as it was; anything else reads as nothing", () => {
    const period: StreamedReadingPeriod = {
      minutes: "10100",
      count: 3,
      sum: 0.30000000000000004,
      min: 0.1,
      max: 0.2,
    };

    expect(
      readStreamedReadingPeriod(writeStreamedReadingPeriod(period)),
    ).toEqual(period);

    for (const value of [
      "",
      "11111,1,2,3",
      "1,1,1,1,1",
      "11111,0,0,0,0",
      null,
    ]) {
      expect(readStreamedReadingPeriod(value)).toBeNull();
    }
  });
});

describe("the read's statistic over a period's minutes", () => {
  const periods: Array<StreamedReadingPeriod> = [
    { minutes: "11111", count: 10, sum: 50, min: 1, max: 9 },
    // A second series of the resource: an endpoint's other variant.
    { minutes: "11111", count: 30, sum: 30, min: 0, max: 4 },
  ];

  test("a Sum adds every series' sums, a SampleCount their counts", () => {
    expect(readStreamedStatistic("Sum", periods)).toBe(80);
    expect(readStreamedStatistic("SampleCount", periods)).toBe(40);
  });

  test("an Average weighs every value alike, a Maximum is the most, a Minimum the least", () => {
    expect(readStreamedStatistic("Average", periods)).toBe(2);
    expect(readStreamedStatistic("Maximum", periods)).toBe(9);
    expect(readStreamedStatistic("Minimum", periods)).toBe(0);
  });

  test("nothing of no period", () => {
    expect(readStreamedStatistic("Sum", [])).toBeNull();
  });
});

// The periods a read finds, from minutes merged as the ingest merges them.
function periodsOf(
  minutes: Array<StreamedReadingMinute>,
): Map<number, Record<string, string>> {
  const periods: Map<number, Record<string, string>> = new Map();

  for (const minute of minutes) {
    const start: number = getStreamedReadingPeriodStart(minute.minuteMs);
    const hash: Record<string, string> = periods.get(start) || {};
    const field: string = getStreamedReadingField(minute);

    hash[field] = writeStreamedReadingPeriod(
      mergeStreamedReadingMinute(
        readStreamedReadingPeriod(hash[field]),
        minute,
      ),
    );
    periods.set(start, hash);
  }

  return periods;
}

describe("a streaming account's readings, as the read takes them", () => {
  /*
   * The load balancer's 12:00 to 12:05: 500 requests, 30 of its targets'
   * answered 5xx, its targets' responses 0.2 s on average - as five
   * one-minute summaries from the stream, and as the read's five-minute
   * values of the same data.
   */
  const requests: Array<number> = [100, 120, 80, 110, 90];
  const errors: Array<number> = [5, 10, 3, 4, 8];
  // Each minute's responses: their count and summed seconds.
  const responses: Array<[number, number]> = [
    [100, 10],
    [120, 36],
    [80, 8],
    [110, 22],
    [90, 24],
  ];

  function streamedMinutes(): Array<StreamedReadingMinute> {
    const minutes: Array<StreamedReadingMinute> = [];

    requests.forEach((value: number, minute: number): void => {
      minutes.push(
        albMinute("RequestCount", minute, {
          count: 1,
          sum: value,
          min: value,
          max: value,
        }),
      );
    });
    errors.forEach((value: number, minute: number): void => {
      minutes.push(
        albMinute("HTTPCode_Target_5XX_Count", minute, {
          count: 1,
          sum: value,
          min: value,
          max: value,
        }),
      );
    });
    responses.forEach(([count, sum]: [number, number], minute: number) => {
      minutes.push(
        albMinute("TargetResponseTime", minute, {
          count,
          sum,
          min: 0.01,
          max: 2,
        }),
      );
    });

    return minutes;
  }

  // What the read's GetMetricData answers for the period: one value of each.
  function readReadings(): CollectedCloudReadings {
    const group: CloudMetricGroup = {
      resourceAttributes: [
        ...connectionResourceAttributes({
          serviceName: "aws-production",
          connectionId: CONNECTION,
          cloudProvider: CloudProvider.AWS,
        }),
        stringAttribute("cloud.account.id", ACCOUNT),
        stringAttribute("cloud.region", REGION),
      ],
      metrics: [
        ["RequestCount", 500],
        ["HTTPCode_Target_5XX_Count", 30],
        // CloudWatch's Average over the period: every response's seconds over the responses.
        ["TargetResponseTime", 100 / 500],
      ].map(([metricName, value]: Array<string | number>) => {
        return {
          name: getAwsStoredMetricName(
            "AWS/ApplicationELB",
            metricName as string,
          ),
          unit: "Count",
          datapointSets: [
            {
              attributes: [
                stringAttribute("Namespace", "AWS/ApplicationELB"),
                stringAttribute("MetricName", metricName as string),
                kvlistAttribute("Dimensions", [
                  stringAttribute(
                    "LoadBalancer",
                    "app/checkout/50dc6c495c0c9188",
                  ),
                ]),
              ],
              points: [{ timeMs: PERIOD, value: value as number }],
            },
          ],
        };
      }),
    };

    return collectCloudResourceReadings(buildMetricsPayloads([group])).get(
      ALB_IDENTIFIER,
    )!;
  }

  test("read the same as a read of the same CloudWatch data: five one-minute sums are one five-minute Sum", () => {
    const streamed: CollectedCloudReadings = readStreamedReadings({
      periods: periodsOf(streamedMinutes()),
      now: NOW,
    }).get(ALB_IDENTIFIER)!;
    const read: CollectedCloudReadings = readReadings();

    expect(streamed.readings).toEqual(read.readings);
    expect(streamed.readings["aws/applicationelb/requestcount"]).toEqual({
      value: 500,
      time: new Date(PERIOD).toISOString(),
    });
  });

  test("so its health and its headlines read the same as a read account's", () => {
    const streamed: CollectedCloudReadings = readStreamedReadings({
      periods: periodsOf(streamedMinutes()),
      now: NOW,
    }).get(ALB_IDENTIFIER)!;
    const assess: (
      readings: CollectedCloudReadings,
    ) => CloudHealthAssessment = (
      readings: CollectedCloudReadings,
    ): CloudHealthAssessment => {
      return assessCloudResourceHealth(
        {
          cloudProvider: CloudProvider.AWS,
          cloudResourceType: ALB.resourceType,
          otelCollectorStatus: "connected",
          cloudReadings: readings.readings,
          cloudReadingsAt: NOW,
        },
        { now: NOW },
      );
    };

    // 30 of 500 requests failed: 6%, a warning either way.
    expect(assess(streamed)).toEqual(assess(readReadings()));
    expect(assess(streamed).severity).toBe("warning");

    for (const headline of getCloudHeadlineReadings("aws", ALB.resourceType)) {
      expect({
        key: headline.key,
        value: streamed.readings[headline.key]?.value,
      }).toEqual({
        key: headline.key,
        value: readReadings().readings[headline.key]?.value,
      });
    }
  });

  test("a period still filling is not read: its minutes so far would read a part of it", () => {
    // 12:05 to 12:10 holds two minutes; at 12:12 it has not settled.
    const minutes: Array<StreamedReadingMinute> = [
      ...streamedMinutes(),
      albMinute("RequestCount", 5, { count: 1, sum: 40, min: 40, max: 40 }),
      albMinute("RequestCount", 6, { count: 1, sum: 30, min: 30, max: 30 }),
    ];

    expect(
      readStreamedReadings({ periods: periodsOf(minutes), now: NOW }).get(
        ALB_IDENTIFIER,
      )!.readings["aws/applicationelb/requestcount"]?.value,
    ).toBe(500);
    // Settled, at 12:15: the newer one.
    expect(
      readStreamedReadings({
        periods: periodsOf(minutes),
        now: new Date(
          PERIOD +
            2 * CLOUD_STREAM_READINGS_PERIOD_MS +
            CLOUD_STREAM_READINGS_SETTLE_MS,
        ),
      }).get(ALB_IDENTIFIER)!.readings["aws/applicationelb/requestcount"],
    ).toEqual({
      value: 70,
      time: new Date(PERIOD + CLOUD_STREAM_READINGS_PERIOD_MS).toISOString(),
    });
  });

  test("a count published per part of the resource reads the sum of its parts", () => {
    const endpoint: CloudMonitoredResource = resolveCloudMonitoredResource({
      metricName: getAwsStoredMetricName("AWS/SageMaker", "Invocations"),
      attributes: {
        Namespace: "AWS/SageMaker",
        "Dimensions.EndpointName": "recommender",
        "Dimensions.VariantName": "blue",
        "resource.cloud.account.id": ACCOUNT,
        "resource.cloud.region": REGION,
      },
    })!;
    const minutes: Array<StreamedReadingMinute> = ["blue", "green"].map(
      (variant: string, index: number): StreamedReadingMinute => {
        return toStreamedReadingMinute({
          resource: endpoint,
          metricName: getAwsStoredMetricName("AWS/SageMaker", "Invocations"),
          dimensions: { EndpointName: "recommender", VariantName: variant },
          minuteMs: PERIOD + MINUTE,
          count: 1,
          sum: 100 * (index + 1),
          min: 100 * (index + 1),
          max: 100 * (index + 1),
        })!;
      },
    );

    expect(
      readStreamedReadings({ periods: periodsOf(minutes), now: NOW }).get(
        buildCloudMonitoredResourceIdentifier(endpoint).toLowerCase(),
      )!.readings["aws/sagemaker/invocations"]?.value,
    ).toBe(300);
  });
});

describe("the accounts and Regions whose streamed readings are fresh", () => {
  test("a minute noted in the last ten minutes, by account and Region", () => {
    expect(
      Array.from(
        getFreshStreamedReadingSources({
          newestMinutes: {
            [`${ACCOUNT}|us-east-1`]: String(
              NOW.getTime() - CLOUD_STREAM_READINGS_FRESH_MS,
            ),
            [`${ACCOUNT}|EU-WEST-1`]: String(NOW.getTime() - 4 * MINUTE),
            [`${ACCOUNT}|ap-south-1`]: String(
              NOW.getTime() - CLOUD_STREAM_READINGS_FRESH_MS - 1,
            ),
            [`${ACCOUNT}|sa-east-1`]: "not a time",
          },
          now: NOW,
        }),
      ).sort(),
    ).toEqual([`${ACCOUNT}|eu-west-1`, `${ACCOUNT}|us-east-1`]);
  });
});

describe("kept between the ingest and the read", () => {
  test("a delivery's minutes are merged into their periods, which expire, and each source's newest minute noted", async () => {
    const store: MemoryStreamReadingsStore = createMemoryStreamReadingsStore();
    CloudStreamReadings.store = store;

    await CloudStreamReadings.noteDelivery({
      connectionId: CONNECTION,
      minutes: streamedMinutesOfOneSeries(),
    });

    const periodKey: string = getStreamedReadingsPeriodKey(CONNECTION, PERIOD);

    expect(Array.from(store.hashes.keys()).sort()).toEqual(
      [periodKey, getStreamedReadingsSourcesKey(CONNECTION)].sort(),
    );
    expect(store.ttls.get(periodKey)).toBe(CLOUD_STREAM_READINGS_TTL_SECONDS);
    expect(store.hashes.get(getStreamedReadingsSourcesKey(CONNECTION))).toEqual(
      { [`${ACCOUNT}|${REGION}`]: String(PERIOD + 4 * MINUTE) },
    );

    // The same delivery again changes nothing.
    const before: string = JSON.stringify(store.hashes.get(periodKey));
    await CloudStreamReadings.noteDelivery({
      connectionId: CONNECTION,
      minutes: streamedMinutesOfOneSeries(),
    });
    expect(JSON.stringify(store.hashes.get(periodKey))).toBe(before);

    const loaded: Awaited<ReturnType<typeof CloudStreamReadings.load>> =
      await CloudStreamReadings.load({ connectionId: CONNECTION, now: NOW });

    expect(
      loaded.readings.get(ALB_IDENTIFIER)!.readings[
        "aws/applicationelb/requestcount"
      ]?.value,
    ).toBe(500);
    expect(Array.from(loaded.freshSources)).toEqual([`${ACCOUNT}|${REGION}`]);
  });

  /*
   * A resource whose metric is quiet - a function no one called - sends
   * nothing to a read either: its account and Region are fresh while the
   * stream delivers any of their metrics, so the read does not read it all
   * the same, and say the stream is quiet.
   */
  test("a delivery of no health metric still says its account and Region are fresh, by its newest minute", async () => {
    const store: MemoryStreamReadingsStore = createMemoryStreamReadingsStore();
    CloudStreamReadings.store = store;

    await CloudStreamReadings.noteDelivery({
      connectionId: CONNECTION,
      minutes: [],
      sources: [
        { accountId: ACCOUNT, region: "EU-WEST-1", newestMs: PERIOD + MINUTE },
        // Nothing of when: nothing noted.
        { accountId: ACCOUNT, region: "ap-south-1", newestMs: null },
      ],
    });

    expect(Array.from(store.hashes.keys())).toEqual([
      getStreamedReadingsSourcesKey(CONNECTION),
    ]);
    expect(store.hashes.get(getStreamedReadingsSourcesKey(CONNECTION))).toEqual(
      { [`${ACCOUNT}|eu-west-1`]: String(PERIOD + MINUTE) },
    );

    // Its health minutes and its other metrics' alike: the newest of either.
    await CloudStreamReadings.noteDelivery({
      connectionId: CONNECTION,
      minutes: streamedMinutesOfOneSeries(),
      sources: [
        { accountId: ACCOUNT, region: REGION, newestMs: PERIOD + 2 * MINUTE },
      ],
    });

    expect(
      store.hashes.get(getStreamedReadingsSourcesKey(CONNECTION))![
        `${ACCOUNT}|${REGION}`
      ],
    ).toBe(String(PERIOD + 4 * MINUTE));

    // Nothing at all: nothing asked of the store.
    const untouched: MemoryStreamReadingsStore =
      createMemoryStreamReadingsStore();
    CloudStreamReadings.store = untouched;
    await CloudStreamReadings.noteDelivery({
      connectionId: CONNECTION,
      minutes: [],
      sources: [{ accountId: ACCOUNT, region: REGION, newestMs: null }],
    });
    expect(untouched.hashes.size).toBe(0);
  });

  test("a store that cannot be read leaves every reading to the read, never fails it", async () => {
    CloudStreamReadings.store = {
      ...createMemoryStreamReadingsStore(),
      readHashes: async (): Promise<Array<Record<string, string>>> => {
        throw new Error("The cache is not connected.");
      },
    };

    const loaded: Awaited<ReturnType<typeof CloudStreamReadings.load>> =
      await CloudStreamReadings.load({ connectionId: CONNECTION, now: NOW });

    expect(loaded.readings.size).toBe(0);
    expect(loaded.freshSources.size).toBe(0);
  });

  test("a store that cannot be written never fails the delivery, nor calls its account and Region fresh", async () => {
    const store: MemoryStreamReadingsStore = createMemoryStreamReadingsStore();
    CloudStreamReadings.store = {
      ...store,
      merge: async (): Promise<void> => {
        throw new Error("The cache is not connected.");
      },
    };

    await expect(
      CloudStreamReadings.noteDelivery({
        connectionId: CONNECTION,
        minutes: streamedMinutesOfOneSeries(),
        sources: [
          { accountId: ACCOUNT, region: REGION, newestMs: PERIOD + MINUTE },
        ],
      }),
    ).resolves.toBeUndefined();
    // Its minutes were not kept: the read reads them from CloudWatch.
    expect(store.hashes.size).toBe(0);
  });

  function streamedMinutesOfOneSeries(): Array<StreamedReadingMinute> {
    return [100, 120, 80, 110, 90].map(
      (value: number, minute: number): StreamedReadingMinute => {
        return albMinute("RequestCount", minute, {
          count: 1,
          sum: value,
          min: value,
          max: value,
        });
      },
    );
  }
});

describe("a read's readings and a stream's, as one", () => {
  test("of a reading both have, the newer; each one's own kept", () => {
    const read: Map<string, CollectedCloudReadings> = new Map([
      [
        "aws:one",
        {
          provider: "aws",
          resourceType: "AWS::EC2::Instance",
          readings: {
            "aws/ec2/networkin": {
              value: 10,
              time: "2026-11-19T11:55:00.000Z",
            },
            "aws/ec2/cpuutilization": {
              value: 20,
              time: "2026-11-19T11:50:00.000Z",
            },
          },
        },
      ],
    ]);
    const streamed: Map<string, CollectedCloudReadings> = new Map([
      [
        "aws:one",
        {
          provider: "aws",
          resourceType: "AWS::EC2::Instance",
          readings: {
            "aws/ec2/cpuutilization": {
              value: 40,
              time: "2026-11-19T12:00:00.000Z",
            },
            "aws/ec2/statuscheckfailed": {
              value: 0,
              time: "2026-11-19T12:00:00.000Z",
            },
          },
        },
      ],
      [
        "aws:two",
        {
          provider: "aws",
          resourceType: "AWS::EC2::Instance",
          readings: {
            "aws/ec2/statuscheckfailed": {
              value: 1,
              time: "2026-11-19T12:00:00.000Z",
            },
          },
        },
      ],
    ]);

    const merged: Map<string, CollectedCloudReadings> = mergeCollectedReadings(
      read,
      streamed,
    );

    expect(merged.get("aws:one")!.readings).toEqual({
      "aws/ec2/networkin": { value: 10, time: "2026-11-19T11:55:00.000Z" },
      "aws/ec2/cpuutilization": { value: 40, time: "2026-11-19T12:00:00.000Z" },
      "aws/ec2/statuscheckfailed": {
        value: 0,
        time: "2026-11-19T12:00:00.000Z",
      },
    });
    expect(
      merged.get("aws:two")!.readings["aws/ec2/statuscheckfailed"]?.value,
    ).toBe(1);
    // Neither given one is changed.
    expect(read.get("aws:one")!.readings["aws/ec2/cpuutilization"]?.value).toBe(
      20,
    );
  });
});
