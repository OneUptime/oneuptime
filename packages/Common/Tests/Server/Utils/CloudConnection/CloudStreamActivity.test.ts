import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CloudStreamActivity, {
  CLOUD_STREAM_SUMMARY_WRITE_INTERVAL_MS,
} from "../../../../Server/Utils/CloudConnection/CloudStreamActivity";
import logger from "../../../../Server/Utils/Logger";
import {
  CloudStreamRefusalReason,
  CloudStreamSummary,
  mergeCloudStreamSummary,
} from "../../../../Types/CloudConnection/CloudStream";
import ObjectID from "../../../../Types/ObjectID";

/*
 * What a connection's streams delivered is kept on the connection: the
 * first delivery at once, then at most once a minute per process, merged
 * into what is stored - so two processes writing what they saw end up with
 * both, and writing the same twice counts nothing twice. A write that fails
 * is logged and never fails a delivery. `jest` is the global one.
 */

const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-11-04T10:00:00.000Z");

let stored: Map<string, CloudStreamSummary>;
let writes: Array<{ connectionId: string; summary: CloudStreamSummary }>;
let failWrites: boolean;

const originalWrite: typeof CloudStreamActivity.writeSummary =
  CloudStreamActivity.writeSummary;
const originalRead: typeof CloudStreamActivity.readSummary =
  CloudStreamActivity.readSummary;

function at(milliseconds: number): Date {
  return new Date(NOW.getTime() + milliseconds);
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 5; index++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

beforeEach(() => {
  stored = new Map();
  writes = [];
  failWrites = false;
  CloudStreamActivity.reset();

  CloudStreamActivity.readSummary = async (
    connectionId: ObjectID,
  ): Promise<CloudStreamSummary> => {
    return (
      stored.get(connectionId.toString()) || {
        metricSources: [],
        logSources: [],
      }
    );
  };
  CloudStreamActivity.writeSummary = async (data: {
    connectionId: ObjectID;
    summary: CloudStreamSummary;
  }): Promise<void> => {
    if (failWrites) {
      throw new Error("Postgres is away");
    }

    writes.push({
      connectionId: data.connectionId.toString(),
      summary: data.summary,
    });
    stored.set(data.connectionId.toString(), data.summary);
  };
});

afterEach(() => {
  CloudStreamActivity.writeSummary = originalWrite;
  CloudStreamActivity.readSummary = originalRead;
  CloudStreamActivity.reset();
  jest.restoreAllMocks();
});

describe("a delivery taken", () => {
  test("is written at once the first time: the person setting the stream up sees it arrive", async () => {
    CloudStreamActivity.noteDelivery({
      connectionId: CONNECTION,
      now: NOW,
      sightings: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          namespaces: ["AWS/EC2"],
          logGroups: ["/aws/lambda/checkout"],
        },
      ],
    });
    await settle();

    expect(writes).toHaveLength(1);
    expect(writes[0]!.summary).toEqual({
      lastDeliveryAt: NOW.toISOString(),
      metricSources: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          namespaces: ["AWS/EC2"],
          lastAt: NOW.toISOString(),
        },
      ],
      logSources: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          logGroups: ["/aws/lambda/checkout"],
          lastAt: NOW.toISOString(),
        },
      ],
    });
  });

  test("then at most once a minute, with everything seen in between", async () => {
    CloudStreamActivity.noteDelivery({
      connectionId: CONNECTION,
      now: NOW,
      sightings: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          namespaces: ["AWS/EC2"],
        },
      ],
    });
    await settle();

    for (let second: number = 1; second < 60; second += 10) {
      CloudStreamActivity.noteDelivery({
        connectionId: CONNECTION,
        now: at(second * 1000),
        sightings: [
          {
            accountId: "123456789012",
            region: "eu-west-1",
            namespaces: ["AWS/RDS"],
          },
        ],
      });
    }
    await settle();

    expect(writes).toHaveLength(1);

    CloudStreamActivity.noteDelivery({
      connectionId: CONNECTION,
      now: at(CLOUD_STREAM_SUMMARY_WRITE_INTERVAL_MS),
      sightings: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          namespaces: ["AWS/Lambda"],
        },
      ],
    });
    await settle();

    expect(writes).toHaveLength(2);
    expect(
      writes[1]!.summary.metricSources
        .map((source: { region: string; namespaces: Array<string> }) => {
          return `${source.region}:${source.namespaces.join(",")}`;
        })
        .sort(),
    ).toEqual(["eu-west-1:AWS/RDS", "us-east-1:AWS/Lambda,AWS/EC2"]);
  });

  test("is merged into what another process stored: neither loses what the other saw", async () => {
    stored.set(CONNECTION.toString(), {
      lastDeliveryAt: at(-30_000).toISOString(),
      metricSources: [
        {
          accountId: "123456789012",
          region: "ap-south-1",
          namespaces: ["AWS/SQS"],
          lastAt: at(-30_000).toISOString(),
        },
      ],
      logSources: [],
    });

    CloudStreamActivity.noteDelivery({
      connectionId: CONNECTION,
      now: NOW,
      sightings: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          namespaces: ["AWS/EC2"],
        },
      ],
    });
    await settle();

    expect(
      writes[0]!.summary.metricSources.map((source: { region: string }) => {
        return source.region;
      }),
    ).toEqual(["us-east-1", "ap-south-1"]);
    expect(writes[0]!.summary.lastDeliveryAt).toBe(NOW.toISOString());
  });

  test("written again changes nothing", async () => {
    CloudStreamActivity.noteDelivery({
      connectionId: CONNECTION,
      now: NOW,
      sightings: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          logGroups: ["/a", "/b"],
        },
      ],
    });
    await settle();

    const first: CloudStreamSummary = writes[0]!.summary;

    await CloudStreamActivity.flushAll(NOW);

    expect(writes[1]!.summary).toEqual(first);
    expect(
      mergeCloudStreamSummary({ stored: first, seen: first, now: NOW }),
    ).toEqual(first);
  });

  test("of a sighting with no account is a delivery, and no source", async () => {
    CloudStreamActivity.noteDelivery({
      connectionId: CONNECTION,
      now: NOW,
      sightings: [{ accountId: "", region: "us-east-1", namespaces: ["X"] }],
    });
    await settle();

    expect(writes[0]!.summary).toEqual({
      lastDeliveryAt: NOW.toISOString(),
      metricSources: [],
      logSources: [],
    });
  });
});

describe("a delivery refused", () => {
  test("is kept with why, the newest refusal winning", async () => {
    CloudStreamActivity.noteRefusal({
      connectionId: CONNECTION,
      reason: CloudStreamRefusalReason.WrongKey,
      now: NOW,
    });
    await settle();

    expect(writes[0]!.summary.lastRefusal).toEqual({
      at: NOW.toISOString(),
      reason: CloudStreamRefusalReason.WrongKey,
    });

    CloudStreamActivity.noteRefusal({
      connectionId: CONNECTION,
      reason: CloudStreamRefusalReason.TooLarge,
      now: at(CLOUD_STREAM_SUMMARY_WRITE_INTERVAL_MS),
    });
    await settle();

    expect(writes[1]!.summary.lastRefusal).toEqual({
      at: at(CLOUD_STREAM_SUMMARY_WRITE_INTERVAL_MS).toISOString(),
      reason: CloudStreamRefusalReason.TooLarge,
    });
  });
});

describe("a write that fails", () => {
  test("is logged, never thrown, and the next delivery after a minute writes again", async () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined as never;
      });
    failWrites = true;

    expect(() => {
      CloudStreamActivity.noteDelivery({
        connectionId: CONNECTION,
        now: NOW,
        sightings: [
          {
            accountId: "123456789012",
            region: "us-east-1",
            namespaces: ["AWS/EC2"],
          },
        ],
      });
    }).not.toThrow();
    await settle();

    expect(warn).toHaveBeenCalled();
    expect(writes).toHaveLength(0);

    failWrites = false;
    CloudStreamActivity.noteDelivery({
      connectionId: CONNECTION,
      now: at(CLOUD_STREAM_SUMMARY_WRITE_INTERVAL_MS),
      sightings: [],
    });
    await settle();

    // What the failed write held is written now: nothing seen is lost.
    expect(writes).toHaveLength(1);
    expect(writes[0]!.summary.metricSources[0]!.namespaces).toEqual([
      "AWS/EC2",
    ]);
  });
});
