import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Redis, { ClientType } from "../../../../Server/Infrastructure/Redis";
import CloudStreamReadings, {
  CLOUD_STREAM_READINGS_TTL_SECONDS,
  REDIS_STREAM_READINGS_STORE,
  StreamedReadingMinute,
  StreamedReadingPeriod,
  getStreamedReadingsPeriodKey,
  getStreamedReadingsSourcesKey,
  readStreamedReadingPeriod,
  toStreamedReadingMinute,
} from "../../../../Server/Utils/CloudConnection/CloudStreamReadings";
import { getAwsStoredMetricName } from "../../../../Types/Cloud/CloudKeyMetrics";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import ObjectID from "../../../../Types/ObjectID";
import {
  MemoryStreamReadingsStore,
  createMemoryStreamReadingsStore,
} from "../../../Helpers/MemoryStreamReadingsStore";

/*
 * A streaming account's readings kept in a REAL Valkey (#9690): the two Lua
 * scripts the ingest merges a delivery's minutes and notes each account
 * and Region's newest minute with, and the reads the connection's read
 * makes. What matters is Redis's: a minute merged twice counts once, a
 * newer minute is never moved back, keys expire, and what the scripts keep
 * is what the in-memory store the other tests use keeps
 * (MemoryStreamReadingsStore), number for number.
 *
 * It needs Valkey or Redis: CI's test-setup.sh starts one on localhost:6310
 * and `npm test` exports its settings from config.env. Locally:
 *
 *   docker run -d --rm -p 16917:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16917 \
 *     npx jest Tests/Server/Utils/CloudConnection/CloudStreamReadingsValkey.test.ts
 *
 * Every key it writes is under a random connection id, and is deleted
 * afterwards; nothing else in the database is touched.
 */

jest.setTimeout(60_000);

const CONNECTIONS: Array<string> = [];
const ACCOUNT: string = "123456789012";
const REGION: string = "us-east-1";
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

function newConnection(): string {
  const connectionId: string = ObjectID.generate().toString();
  CONNECTIONS.push(connectionId);
  return connectionId;
}

function albMinute(
  metricName: string,
  minute: number,
  summary: { count: number; sum: number; min: number; max: number },
): StreamedReadingMinute {
  return toStreamedReadingMinute({
    resource: ALB,
    metricName: getAwsStoredMetricName("AWS/ApplicationELB", metricName),
    dimensions: { LoadBalancer: "app/checkout/50dc6c495c0c9188" },
    minuteMs: PERIOD + minute * MINUTE,
    ...summary,
  })!;
}

function requests(): Array<StreamedReadingMinute> {
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

function client(): ClientType {
  return Redis.getClient()!;
}

beforeAll(async () => {
  await Redis.connect();
});

afterEach(() => {
  CloudStreamReadings.store = REDIS_STREAM_READINGS_STORE;
});

afterAll(async () => {
  if (Redis.getClient()) {
    for (const connectionId of CONNECTIONS) {
      const keys: Array<string> = await client().keys(`*${connectionId}*`);

      if (keys.length > 0) {
        await client().del(...keys);
      }
    }
  }

  await Redis.disconnect();
});

describe("a delivery's minutes, in Valkey", () => {
  test("are merged once however many times the delivery is sent, and the read takes their five minutes as one Sum", async () => {
    const connectionId: string = newConnection();

    for (let sent: number = 0; sent < 3; sent++) {
      await CloudStreamReadings.noteDelivery({
        connectionId,
        minutes: requests(),
        sources: [{ accountId: ACCOUNT, region: REGION, newestMs: PERIOD }],
      });
    }

    const periodKey: string = getStreamedReadingsPeriodKey(
      connectionId,
      PERIOD,
    );

    expect(Object.values(await client().hgetall(periodKey))).toEqual([
      "11111,5,500,80,120",
    ]);

    const ttl: number = await client().ttl(periodKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(CLOUD_STREAM_READINGS_TTL_SECONDS);

    const loaded: Awaited<ReturnType<typeof CloudStreamReadings.load>> =
      await CloudStreamReadings.load({ connectionId, now: NOW });

    expect(
      loaded.readings.get(
        buildCloudMonitoredResourceIdentifier(ALB).toLowerCase(),
      )!.readings["aws/applicationelb/requestcount"],
    ).toEqual({ value: 500, time: new Date(PERIOD).toISOString() });
    expect(Array.from(loaded.freshSources)).toEqual([`${ACCOUNT}|${REGION}`]);
  });

  test("keep each account and Region's newest minute, which a late delivery never moves back", async () => {
    const connectionId: string = newConnection();
    const sourcesKey: string = getStreamedReadingsSourcesKey(connectionId);

    for (const newestMs of [PERIOD + 3 * MINUTE, PERIOD + MINUTE]) {
      await CloudStreamReadings.noteDelivery({
        connectionId,
        minutes: [],
        sources: [{ accountId: ACCOUNT, region: REGION, newestMs }],
      });
    }

    expect(await client().hgetall(sourcesKey)).toEqual({
      [`${ACCOUNT}|${REGION}`]: String(PERIOD + 3 * MINUTE),
    });
    expect(await client().ttl(sourcesKey)).toBeGreaterThan(0);
  });

  /*
   * Minutes of every kind - fractions, a least and a most, the same minute
   * again, minutes of two periods - kept by the scripts and by the store
   * the other tests use: the same, number for number.
   */
  test("keep what the in-memory store keeps, number for number", async () => {
    const connectionId: string = newConnection();
    const memory: MemoryStreamReadingsStore = createMemoryStreamReadingsStore();
    const minutes: Array<StreamedReadingMinute> = [
      albMinute("TargetResponseTime", 0, {
        count: 3,
        sum: 0.30000000000000004,
        min: 0.1,
        max: 0.2,
      }),
      albMinute("TargetResponseTime", 2, {
        count: 7,
        sum: 1.4,
        min: 0.05,
        max: 0.6,
      }),
      albMinute("TargetResponseTime", 2, {
        count: 7,
        sum: 1.4,
        min: 0.05,
        max: 0.6,
      }),
      albMinute("TargetResponseTime", 6, {
        count: 1,
        sum: 1e-7,
        min: 1e-7,
        max: 1e-7,
      }),
      albMinute("HTTPCode_Target_5XX_Count", 4, {
        count: 1,
        sum: 12345678901,
        min: 12345678901,
        max: 12345678901,
      }),
    ];

    await CloudStreamReadings.noteDelivery({ connectionId, minutes });

    CloudStreamReadings.store = memory;
    await CloudStreamReadings.noteDelivery({ connectionId, minutes });

    // The script writes 17 digits (0.10000000000000001), JavaScript the fewest (0.1): the same number.
    const periodsOf: (
      hash: Record<string, string> | undefined,
    ) => Record<string, StreamedReadingPeriod | null> = (
      hash: Record<string, string> | undefined,
    ): Record<string, StreamedReadingPeriod | null> => {
      const periods: Record<string, StreamedReadingPeriod | null> = {};

      for (const [field, value] of Object.entries(hash || {})) {
        periods[field] = readStreamedReadingPeriod(value);
      }

      return periods;
    };

    for (const periodStart of [PERIOD, PERIOD + 5 * MINUTE]) {
      const key: string = getStreamedReadingsPeriodKey(
        connectionId,
        periodStart,
      );
      const kept: Record<string, StreamedReadingPeriod | null> = periodsOf(
        await client().hgetall(key),
      );

      expect(Object.keys(kept).length).toBeGreaterThan(0);
      expect(kept).toEqual(periodsOf(memory.hashes.get(key)));
    }
  });
});
