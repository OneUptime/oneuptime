import {
  CLOUD_STREAM_ACTIVE_WINDOW_MS,
  CLOUD_STREAM_KEY_PREFIX,
  CLOUD_STREAM_LOGS_PATH,
  CLOUD_STREAM_MAX_LOG_GROUPS_PER_SOURCE,
  CLOUD_STREAM_MAX_NAMESPACES_PER_SOURCE,
  CLOUD_STREAM_MAX_SOURCES,
  CLOUD_STREAM_METRICS_PATH,
  CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS,
  CLOUD_STREAM_SOURCE_RETENTION_MS,
  CLOUD_STREAM_URL_PREFIX,
  CloudStreamKeyHashes,
  CloudStreamRefusalReason,
  CloudStreamSummary,
  buildCloudStreamKey,
  canFirehoseDeliverTo,
  getCloudStreamEndpoints,
  getCloudStreamState,
  getLiveCloudStreamKeyHashes,
  getStreamedMetricKey,
  getStreamedMetricKeys,
  mergeCloudStreamSummary,
  parseCloudStreamKey,
  readCloudStreamKeyHashes,
  readCloudStreamSummary,
  rotateCloudStreamKeyHashes,
} from "../../../Types/CloudConnection/CloudStream";
import { describe, expect, test } from "@jest/globals";

/*
 * What every side of a connection's streams shares: the endpoints Firehose
 * delivers to, the stream key's shape, the summary of what arrived (read
 * defensively, merged so a server writing twice counts nothing twice), the
 * namespaces the reads leave to a stream, how streaming is said to be doing,
 * and the key hashes - the current one and the one it replaced, for a day.
 */

const CONNECTION: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const SECRET: string = "a".repeat(32) + "0123456789abcdef0123456789abcdef";
const NOW: Date = new Date("2026-11-04T10:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

function summary(data: Partial<CloudStreamSummary> = {}): CloudStreamSummary {
  return { metricSources: [], logSources: [], ...data };
}

describe("the endpoints a connection's Firehose streams deliver to", () => {
  test("are under /telemetry, which every ingress sends to the App", () => {
    expect(getCloudStreamEndpoints("https://oneuptime.com")).toEqual({
      metricsUrl: "https://oneuptime.com/telemetry/aws-firehose/v1/metrics",
      logsUrl: "https://oneuptime.com/telemetry/aws-firehose/v1/logs",
    });
    expect(CLOUD_STREAM_URL_PREFIX).toBe("/telemetry");
    expect(CLOUD_STREAM_METRICS_PATH).toBe("/aws-firehose/v1/metrics");
    expect(CLOUD_STREAM_LOGS_PATH).toBe("/aws-firehose/v1/logs");
  });

  test("take a self-hosted address with or without trailing slashes", () => {
    expect(
      getCloudStreamEndpoints("  https://status.example.org/// ").metricsUrl,
    ).toBe("https://status.example.org/telemetry/aws-firehose/v1/metrics");
  });

  test("are only https - Firehose delivers to no other scheme", () => {
    expect(canFirehoseDeliverTo("https://oneuptime.com/x")).toBe(true);
    expect(canFirehoseDeliverTo("HTTPS://ONEUPTIME.COM/x")).toBe(true);
    expect(canFirehoseDeliverTo("http://localhost/x")).toBe(false);
    expect(canFirehoseDeliverTo("<YOUR_ONEUPTIME_URL>/x")).toBe(false);
  });
});

describe("a stream key", () => {
  test("names its connection and carries 64 hex characters of secret", () => {
    const key: string = buildCloudStreamKey({
      connectionId: CONNECTION,
      secret: SECRET,
    });

    expect(key).toBe(`${CLOUD_STREAM_KEY_PREFIX}_${CONNECTION}_${SECRET}`);
    expect(parseCloudStreamKey(key)).toEqual({
      connectionId: CONNECTION,
      secret: SECRET,
    });
  });

  test("is read with the whitespace a paste leaves around it", () => {
    const key: string = buildCloudStreamKey({
      connectionId: CONNECTION,
      secret: SECRET,
    });

    expect(parseCloudStreamKey(`  ${key}\n`)?.connectionId).toBe(CONNECTION);
  });

  test("is lower case: a connection id or secret in capitals is written lower", () => {
    const key: string = buildCloudStreamKey({
      connectionId: CONNECTION.toUpperCase(),
      secret: SECRET.toUpperCase(),
    });

    expect(key).toBe(key.toLowerCase());
    expect(parseCloudStreamKey(key)).not.toBeNull();
  });

  test("refuses anything else, without throwing", () => {
    const valid: string = buildCloudStreamKey({
      connectionId: CONNECTION,
      secret: SECRET,
    });

    for (const value of [
      undefined,
      null,
      42,
      {},
      ["x"],
      "",
      "   ",
      // Another product's key, an ingestion key, a bearer token.
      "6b4a1d5c-0c5e-4a8f-9a30-1f1f2b7d1e11",
      `Bearer ${valid}`,
      // The wrong prefix, a missing part, an extra part.
      valid.replace(`${CLOUD_STREAM_KEY_PREFIX}_`, "ouxx_"),
      `${CLOUD_STREAM_KEY_PREFIX}_${CONNECTION}`,
      `${valid}_extra`,
      // Not a uuid; upper case; a secret of the wrong length or alphabet.
      `${CLOUD_STREAM_KEY_PREFIX}_not-a-uuid_${SECRET}`,
      `${CLOUD_STREAM_KEY_PREFIX}_${CONNECTION.toUpperCase()}_${SECRET}`,
      `${CLOUD_STREAM_KEY_PREFIX}_${CONNECTION}_${SECRET.slice(1)}`,
      `${CLOUD_STREAM_KEY_PREFIX}_${CONNECTION}_${SECRET.slice(1)}g`,
      `${CLOUD_STREAM_KEY_PREFIX}_${CONNECTION}_${SECRET.toUpperCase()}`,
      // Longer than Firehose allows an access key to be.
      `${valid}${"a".repeat(5000)}`,
    ]) {
      expect(parseCloudStreamKey(value)).toBeNull();
    }
  });
});

describe("reading a stored summary", () => {
  test("an empty or broken value is an empty summary", () => {
    for (const value of [undefined, null, "x", 7, [], { metricSources: 3 }]) {
      expect(readCloudStreamSummary(value)).toEqual(summary());
    }
  });

  test("keeps each source with a time and an account, its names once", () => {
    const read: CloudStreamSummary = readCloudStreamSummary({
      lastDeliveryAt: minutesAgo(1),
      metricSources: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          namespaces: ["AWS/EC2", "AWS/EC2", "", 4, "AWS/RDS"],
          lastAt: minutesAgo(1),
        },
        // No time, no account: dropped.
        { accountId: "123456789012", region: "eu-west-1", namespaces: [] },
        { region: "eu-west-1", namespaces: [], lastAt: minutesAgo(1) },
        "not an object",
      ],
      logSources: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          logGroups: ["/aws/lambda/checkout"],
          lastAt: "not a date",
        },
        {
          accountId: "123456789012",
          region: "us-east-1",
          logGroups: ["/aws/lambda/checkout"],
          lastAt: minutesAgo(2),
        },
      ],
      lastRefusal: { at: minutesAgo(3), reason: "wrong-key" },
    });

    expect(read.lastDeliveryAt).toBe(minutesAgo(1));
    expect(read.metricSources).toEqual([
      {
        accountId: "123456789012",
        region: "us-east-1",
        namespaces: ["AWS/EC2", "AWS/RDS"],
        lastAt: minutesAgo(1),
      },
    ]);
    expect(read.logSources).toHaveLength(1);
    expect(read.lastRefusal).toEqual({
      at: minutesAgo(3),
      reason: CloudStreamRefusalReason.WrongKey,
    });
  });

  test("a refusal for a reason that is not one is left out", () => {
    expect(
      readCloudStreamSummary({
        lastRefusal: { at: minutesAgo(1), reason: "because" },
      }).lastRefusal,
    ).toBeUndefined();
  });

  test("bounds every list, however much is stored", () => {
    const read: CloudStreamSummary = readCloudStreamSummary({
      metricSources: Array.from({ length: CLOUD_STREAM_MAX_SOURCES + 50 }).map(
        (_value: unknown, index: number) => {
          return {
            accountId: `1234567890${String(index).padStart(2, "0")}`,
            region: "us-east-1",
            namespaces: Array.from({
              length: CLOUD_STREAM_MAX_NAMESPACES_PER_SOURCE + 10,
            }).map((_name: unknown, at: number) => {
              return `Custom/${at}`;
            }),
            lastAt: minutesAgo(1),
          };
        },
      ),
      logSources: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          logGroups: Array.from({
            length: CLOUD_STREAM_MAX_LOG_GROUPS_PER_SOURCE + 10,
          }).map((_name: unknown, at: number) => {
            return `/aws/lambda/fn-${at}`;
          }),
          lastAt: minutesAgo(1),
        },
      ],
    });

    expect(read.metricSources).toHaveLength(CLOUD_STREAM_MAX_SOURCES);
    expect(read.metricSources[0]!.namespaces).toHaveLength(
      CLOUD_STREAM_MAX_NAMESPACES_PER_SOURCE,
    );
    expect(read.logSources[0]!.logGroups).toHaveLength(
      CLOUD_STREAM_MAX_LOG_GROUPS_PER_SOURCE,
    );
  });
});

describe("merging what a server saw into what is stored", () => {
  test("keeps each account and Region once, at its newest time, with every namespace", () => {
    const merged: CloudStreamSummary = mergeCloudStreamSummary({
      stored: summary({
        lastDeliveryAt: minutesAgo(10),
        metricSources: [
          {
            accountId: "123456789012",
            region: "us-east-1",
            namespaces: ["AWS/EC2"],
            lastAt: minutesAgo(10),
          },
        ],
      }),
      seen: summary({
        lastDeliveryAt: minutesAgo(1),
        metricSources: [
          {
            accountId: "123456789012",
            region: "US-EAST-1",
            namespaces: ["AWS/RDS", "AWS/EC2"],
            lastAt: minutesAgo(1),
          },
          {
            accountId: "123456789012",
            region: "eu-west-1",
            namespaces: ["AWS/Lambda"],
            lastAt: minutesAgo(2),
          },
        ],
      }),
      now: NOW,
    });

    expect(merged.lastDeliveryAt).toBe(minutesAgo(1));
    expect(merged.metricSources).toEqual([
      {
        accountId: "123456789012",
        region: "us-east-1",
        // The newer sighting's first.
        namespaces: ["AWS/RDS", "AWS/EC2"],
        lastAt: minutesAgo(1),
      },
      {
        accountId: "123456789012",
        region: "eu-west-1",
        namespaces: ["AWS/Lambda"],
        lastAt: minutesAgo(2),
      },
    ]);
  });

  test("merging the same sighting again changes nothing", () => {
    const seen: CloudStreamSummary = summary({
      lastDeliveryAt: minutesAgo(1),
      logSources: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          logGroups: ["/aws/lambda/checkout", "/aws/rds/instance/orders/error"],
          lastAt: minutesAgo(1),
        },
      ],
      lastRefusal: { at: minutesAgo(5), reason: CloudStreamRefusalReason.Throttled },
    });

    const once: CloudStreamSummary = mergeCloudStreamSummary({
      stored: summary(),
      seen,
      now: NOW,
    });
    const twice: CloudStreamSummary = mergeCloudStreamSummary({
      stored: once,
      seen,
      now: NOW,
    });

    expect(twice).toEqual(once);
  });

  test("an older sighting never moves a source's time back", () => {
    const merged: CloudStreamSummary = mergeCloudStreamSummary({
      stored: summary({
        logSources: [
          {
            accountId: "123456789012",
            region: "us-east-1",
            logGroups: ["/aws/lambda/new"],
            lastAt: minutesAgo(1),
          },
        ],
      }),
      seen: summary({
        logSources: [
          {
            accountId: "123456789012",
            region: "us-east-1",
            logGroups: ["/aws/lambda/old"],
            lastAt: minutesAgo(20),
          },
        ],
      }),
      now: NOW,
    });

    expect(merged.logSources[0]).toEqual({
      accountId: "123456789012",
      region: "us-east-1",
      logGroups: ["/aws/lambda/new", "/aws/lambda/old"],
      lastAt: minutesAgo(1),
    });
  });

  test("drops sources not seen for a week, and keeps the newest refusal", () => {
    const old: string = new Date(
      NOW.getTime() - CLOUD_STREAM_SOURCE_RETENTION_MS - 1000,
    ).toISOString();

    const merged: CloudStreamSummary = mergeCloudStreamSummary({
      stored: summary({
        metricSources: [
          {
            accountId: "111111111111",
            region: "us-east-1",
            namespaces: ["AWS/EC2"],
            lastAt: old,
          },
        ],
        lastRefusal: {
          at: minutesAgo(30),
          reason: CloudStreamRefusalReason.WrongKey,
        },
      }),
      seen: summary({
        lastRefusal: {
          at: minutesAgo(2),
          reason: CloudStreamRefusalReason.TooLarge,
        },
      }),
      now: NOW,
    });

    expect(merged.metricSources).toEqual([]);
    expect(merged.lastRefusal).toEqual({
      at: minutesAgo(2),
      reason: CloudStreamRefusalReason.TooLarge,
    });
  });

  test("keeps no more namespaces or log groups than a source may hold", () => {
    const names: (prefix: string, count: number) => Array<string> = (
      prefix: string,
      count: number,
    ): Array<string> => {
      return Array.from({ length: count }).map(
        (_value: unknown, index: number) => {
          return `${prefix}${index}`;
        },
      );
    };

    const merged: CloudStreamSummary = mergeCloudStreamSummary({
      stored: summary({
        metricSources: [
          {
            accountId: "1",
            region: "us-east-1",
            namespaces: names("Old/", CLOUD_STREAM_MAX_NAMESPACES_PER_SOURCE),
            lastAt: minutesAgo(10),
          },
        ],
      }),
      seen: summary({
        metricSources: [
          {
            accountId: "1",
            region: "us-east-1",
            namespaces: names("New/", 5),
            lastAt: minutesAgo(1),
          },
        ],
      }),
      now: NOW,
    });

    expect(merged.metricSources[0]!.namespaces).toHaveLength(
      CLOUD_STREAM_MAX_NAMESPACES_PER_SOURCE,
    );
    expect(merged.metricSources[0]!.namespaces.slice(0, 5)).toEqual(
      names("New/", 5),
    );
  });
});

describe("the namespaces a connection's reads leave to its streams", () => {
  const streaming: CloudStreamSummary = summary({
    metricSources: [
      {
        accountId: "123456789012",
        region: "us-east-1",
        namespaces: ["AWS/EC2", "AWS/ApplicationELB"],
        lastAt: minutesAgo(3),
      },
      {
        accountId: "123456789012",
        region: "eu-west-1",
        namespaces: ["AWS/Lambda"],
        lastAt: new Date(
          NOW.getTime() - CLOUD_STREAM_ACTIVE_WINDOW_MS - 1000,
        ).toISOString(),
      },
    ],
  });

  test("are the ones delivered in the last fifteen minutes, by account and Region", () => {
    expect(
      Array.from(getStreamedMetricKeys({ summary: streaming, now: NOW })).sort(),
    ).toEqual([
      "123456789012|us-east-1|aws/applicationelb",
      "123456789012|us-east-1|aws/ec2",
    ]);
  });

  test("are keyed without regard to case or spaces", () => {
    expect(
      getStreamedMetricKey({
        accountId: " 123456789012 ",
        region: "US-EAST-1",
        namespace: "AWS/EC2",
      }),
    ).toBe("123456789012|us-east-1|aws/ec2");
  });

  test("are none once every stream is quiet", () => {
    expect(
      getStreamedMetricKeys({
        summary: streaming,
        now: new Date(NOW.getTime() + CLOUD_STREAM_ACTIVE_WINDOW_MS),
      }).size,
    ).toBe(0);
  });
});

describe("how a connection's streaming is doing", () => {
  test("off without a key, whatever arrived before", () => {
    expect(
      getCloudStreamState({
        hasKey: false,
        summary: summary({ lastDeliveryAt: minutesAgo(1) }),
        now: NOW,
      }),
    ).toBe("off");
  });

  test("waiting for the first delivery", () => {
    expect(
      getCloudStreamState({ hasKey: true, summary: summary(), now: NOW }),
    ).toBe("waiting");
  });

  test("receiving while deliveries arrive", () => {
    expect(
      getCloudStreamState({
        hasKey: true,
        summary: summary({ lastDeliveryAt: minutesAgo(14) }),
        now: NOW,
      }),
    ).toBe("receiving");
  });

  test("quiet when none has come for fifteen minutes", () => {
    expect(
      getCloudStreamState({
        hasKey: true,
        summary: summary({ lastDeliveryAt: minutesAgo(16) }),
        now: NOW,
      }),
    ).toBe("quiet");
  });

  test("refused when the newest delivery was refused lately", () => {
    expect(
      getCloudStreamState({
        hasKey: true,
        summary: summary({
          lastDeliveryAt: minutesAgo(10),
          lastRefusal: {
            at: minutesAgo(2),
            reason: CloudStreamRefusalReason.WrongKey,
          },
        }),
        now: NOW,
      }),
    ).toBe("refused");

    // Nothing ever taken, and the first delivery refused.
    expect(
      getCloudStreamState({
        hasKey: true,
        summary: summary({
          lastRefusal: {
            at: minutesAgo(2),
            reason: CloudStreamRefusalReason.TurnedOff,
          },
        }),
        now: NOW,
      }),
    ).toBe("refused");
  });

  test("receiving again once a delivery is taken after a refusal, and an old refusal is forgotten", () => {
    expect(
      getCloudStreamState({
        hasKey: true,
        summary: summary({
          lastDeliveryAt: minutesAgo(1),
          lastRefusal: {
            at: minutesAgo(2),
            reason: CloudStreamRefusalReason.Throttled,
          },
        }),
        now: NOW,
      }),
    ).toBe("receiving");

    expect(
      getCloudStreamState({
        hasKey: true,
        summary: summary({
          lastRefusal: {
            at: minutesAgo(60),
            reason: CloudStreamRefusalReason.WrongKey,
          },
        }),
        now: NOW,
      }),
    ).toBe("waiting");
  });
});

describe("the stream key hashes", () => {
  const HASH_A: string = "a".repeat(64);
  const HASH_B: string = "b".repeat(64);
  const HASH_C: string = "c".repeat(64);

  test("are read only when each is a SHA-256 with its time", () => {
    expect(
      readCloudStreamKeyHashes({
        current: { hash: HASH_A, createdAt: minutesAgo(5) },
        previous: { hash: HASH_B, expiresAt: minutesAgo(-60) },
      }),
    ).toEqual({
      current: { hash: HASH_A, createdAt: minutesAgo(5) },
      previous: { hash: HASH_B, expiresAt: minutesAgo(-60) },
    });

    for (const value of [
      null,
      "x",
      { current: { hash: "short", createdAt: minutesAgo(1) } },
      { current: { hash: HASH_A.toUpperCase(), createdAt: minutesAgo(1) } },
      { current: { hash: HASH_A } },
      { previous: { hash: HASH_B, expiresAt: "never" } },
    ]) {
      expect(readCloudStreamKeyHashes(value)).toEqual({});
    }
  });

  test("a key may match the current hash, and the previous one until it expires", () => {
    const hashes: CloudStreamKeyHashes = {
      current: { hash: HASH_A, createdAt: minutesAgo(5) },
      previous: { hash: HASH_B, expiresAt: minutesAgo(-1) },
    };

    expect(getLiveCloudStreamKeyHashes({ hashes, now: NOW })).toEqual([
      HASH_A,
      HASH_B,
    ]);
    expect(
      getLiveCloudStreamKeyHashes({
        hashes,
        now: new Date(NOW.getTime() + 2 * 60 * 1000),
      }),
    ).toEqual([HASH_A]);
    expect(getLiveCloudStreamKeyHashes({ hashes: {}, now: NOW })).toEqual([]);
  });

  test("a new key keeps the one it replaces for a day, and only that one", () => {
    const first: CloudStreamKeyHashes = rotateCloudStreamKeyHashes({
      hashes: {},
      newHash: HASH_A,
      now: NOW,
    });

    expect(first).toEqual({
      current: { hash: HASH_A, createdAt: NOW.toISOString() },
    });

    const second: CloudStreamKeyHashes = rotateCloudStreamKeyHashes({
      hashes: first,
      newHash: HASH_B,
      now: NOW,
    });

    expect(second.current?.hash).toBe(HASH_B);
    expect(second.previous).toEqual({
      hash: HASH_A,
      expiresAt: new Date(
        NOW.getTime() + CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS,
      ).toISOString(),
    });

    // A third key a minute later: the first stops at once.
    const third: CloudStreamKeyHashes = rotateCloudStreamKeyHashes({
      hashes: second,
      newHash: HASH_C,
      now: new Date(NOW.getTime() + 60 * 1000),
    });

    expect(
      getLiveCloudStreamKeyHashes({
        hashes: third,
        now: new Date(NOW.getTime() + 61 * 1000),
      }),
    ).toEqual([HASH_C, HASH_B]);
  });
});
