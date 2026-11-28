import {
  createAwsS3LogReader,
  JOB_LOG_READ_LIMITS,
  PERSON_LOG_READ_LIMITS,
  readS3AccessLogsForWindow,
  readS3LoggingTarget,
  S3LogReader,
  S3LogReadLimits,
} from "../../../../../Server/Utils/DataSecurity/Cloud/Aws/AwsS3AccessLogs";
import { CloudConnectionSettings } from "../../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  ExposureLogRead,
  ExposureLogReadStatus,
  ExposureLogStop,
  ExposureLogUnreadReason,
  getReadsFromOutside,
} from "../../../../../Types/DataSecurity/AccessLogReads";
import ObjectID from "../../../../../Types/ObjectID";
import {
  createFakeAws,
  FAKE_ACCOUNT_ID,
  FakeAws,
  FakeObject,
  s3Error,
} from "../../CloudConnection/FakeAwsApi";
import { describe, expect, test } from "@jest/globals";

/*
 * AN S3 BUCKET'S SERVER ACCESS LOGS, READ FOR AN EXPOSURE'S WINDOW (#10951),
 * against a fake AWS: the bucket's logging configuration says where its
 * logs go; the log objects from an hour before the window to a day after
 * it are listed, from where the window starts, and read; every line of the
 * store's bucket in the window is added up by who made it. A read is
 * bounded by time, files and bytes, says where it stopped, and never
 * throws for what S3 answers.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const CONNECTION: string = "33333333-3333-4333-8333-333333333333";
const BUCKET: string = "eu-customer-exports";
const LOG_BUCKET: string = "acme-logs";
const OWNER: string =
  "79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be";
const OUTSIDE_ROLE: string =
  "arn:aws:sts::999999999999:assumed-role/partner-reader/s1";
const OWN_ROLE: string = `arn:aws:iam::${FAKE_ACCOUNT_ID}:role/exports-job`;
const WINDOW_START: Date = new Date("2026-11-02T09:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-11T09:00:00.000Z");
const NOW: Date = new Date("2026-11-11T12:00:00.000Z");

function keySettings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    },
    secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  };
}

function line(data: {
  time: string;
  requester?: string;
  bucket?: string;
  key?: string;
  bytes?: number;
}): string {
  return `${OWNER} ${data.bucket || BUCKET} [${data.time}] 203.0.113.7 ${data.requester || "-"} 3E57427F3EXAMPLE REST.GET.OBJECT ${data.key || "exports/customers.csv"} "GET /${BUCKET}/x HTTP/1.1" 200 - ${data.bytes || 1000} 1000 12 10 "-" "curl/8.4.0" - hostid= SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader ${BUCKET}.s3.eu-west-1.amazonaws.com TLSv1.2 - -`;
}

function logObject(key: string, lines: Array<string>): FakeObject {
  return { key, body: lines.join("\n") };
}

// The log bucket: one object before the window, three in it or its slack, one past it.
function logObjects(prefix: string = "logs/"): Array<FakeObject> {
  return [
    logObject(`${prefix}2026-11-01-08-00-00-AAAA`, [
      line({ time: "01/Nov/2026:07:59:00 +0000" }),
    ]),
    logObject(`${prefix}2026-11-02-10-00-00-BBBB`, [
      line({ time: "02/Nov/2026:09:30:00 +0000" }),
      line({ time: "02/Nov/2026:09:45:00 +0000", requester: OWN_ROLE }),
    ]),
    logObject(`${prefix}2026-11-05-13-00-00-CCCC`, [
      line({ time: "05/Nov/2026:12:00:00 +0000", requester: OUTSIDE_ROLE }),
      // Another bucket logging to the same prefix.
      line({ time: "05/Nov/2026:12:00:00 +0000", bucket: "eu-invoices" }),
    ]),
    // Written within the day after the window: it holds the window's last hour.
    logObject(`${prefix}2026-11-12-08-00-00-DDDD`, [
      line({ time: "11/Nov/2026:08:59:00 +0000" }),
      line({ time: "11/Nov/2026:09:30:00 +0000" }),
    ]),
    logObject(`${prefix}2026-11-13-00-00-00-EEEE`, [
      line({ time: "12/Nov/2026:23:00:00 +0000" }),
    ]),
    // Not a log object S3 wrote.
    { key: `${prefix}README.txt`, body: "logs for the exports bucket" },
  ];
}

function fakeOf(
  data: {
    prefix?: string;
    partitioned?: boolean;
    loggingTarget?: string | undefined;
    logObjects?: Array<FakeObject>;
    logBucketErrors?: Record<string, { status: number; body: string }>;
  } = {},
): FakeAws {
  return createFakeAws({
    regions: {},
    buckets: [
      {
        name: BUCKET,
        region: "eu-west-1",
        loggingTarget:
          "loggingTarget" in data ? data.loggingTarget : LOG_BUCKET,
        loggingPrefix: data.prefix,
        loggingPartitioned: data.partitioned,
      },
      {
        name: LOG_BUCKET,
        region: "eu-west-1",
        objects: data.logObjects || logObjects(),
        errors: data.logBucketErrors as never,
      },
    ],
  });
}

function readerOf(fake: FakeAws): S3LogReader {
  return createAwsS3LogReader(keySettings(), {
    connectionId: new ObjectID(CONNECTION),
    sourceBucket: BUCKET,
    region: "eu-west-1",
    accountNumber: FAKE_ACCOUNT_ID,
    transport: fake.transport,
  });
}

function limits(data: Partial<S3LogReadLimits> = {}): S3LogReadLimits {
  return {
    deadlineAt: NOW.getTime() + 60 * 1000,
    maxFiles: 100,
    maxBytes: 10 * 1024 * 1024,
    maxBytesPerFile: 1024 * 1024,
    concurrency: 2,
    ...data,
  };
}

async function read(
  reader: S3LogReader,
  data: Partial<S3LogReadLimits> = {},
  clock: () => Date = (): Date => {
    return NOW;
  },
): Promise<ExposureLogRead> {
  return await readS3AccessLogsForWindow({
    reader,
    sourceBucket: BUCKET,
    sourceAccountId: FAKE_ACCOUNT_ID,
    sourceRegion: "eu-west-1",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    ownAccountIds: new Set([FAKE_ACCOUNT_ID]),
    limits: limits(data),
    now: clock,
  });
}

describe("where a bucket's logs go", () => {
  test("is read from its logging configuration: the bucket, the prefix, and how objects are named", () => {
    expect(
      readS3LoggingTarget(
        `<BucketLoggingStatus><LoggingEnabled><TargetBucket>${LOG_BUCKET}</TargetBucket><TargetPrefix>logs/</TargetPrefix></LoggingEnabled></BucketLoggingStatus>`,
      ),
    ).toEqual({ bucket: LOG_BUCKET, prefix: "logs/", isPartitioned: false });
    expect(
      readS3LoggingTarget(
        `<BucketLoggingStatus><LoggingEnabled><TargetBucket>${LOG_BUCKET}</TargetBucket><TargetPrefix></TargetPrefix><TargetObjectKeyFormat><PartitionedPrefix><PartitionDateSource>EventTime</PartitionDateSource></PartitionedPrefix></TargetObjectKeyFormat></LoggingEnabled></BucketLoggingStatus>`,
      ),
    ).toEqual({ bucket: LOG_BUCKET, prefix: "", isPartitioned: true });
    expect(
      readS3LoggingTarget(
        `<BucketLoggingStatus><LoggingEnabled><TargetBucket>${LOG_BUCKET}</TargetBucket><TargetPrefix>p/</TargetPrefix><TargetObjectKeyFormat><SimplePrefix/></TargetObjectKeyFormat></LoggingEnabled></BucketLoggingStatus>`,
      ),
    ).toEqual({ bucket: LOG_BUCKET, prefix: "p/", isPartitioned: false });
  });

  test("a bucket that logs nothing has no target", () => {
    expect(readS3LoggingTarget("<BucketLoggingStatus/>")).toBeNull();
    expect(readS3LoggingTarget("")).toBeNull();
    expect(
      readS3LoggingTarget(
        "<BucketLoggingStatus><LoggingEnabled></LoggingEnabled></BucketLoggingStatus>",
      ),
    ).toBeNull();
  });
});

describe("the window's logs, read", () => {
  test("lists from an hour before the window, reads each log object up to a day past it, and adds up the store's lines in the window", async () => {
    const fake: FakeAws = fakeOf();
    const result: ExposureLogRead = await read(readerOf(fake));

    expect(result.status).toBe(ExposureLogReadStatus.Read);
    expect(result.isComplete).toBe(true);
    expect(result.logLocation).toBe(`s3://${LOG_BUCKET}/logs/`);
    expect(result.windowStart).toBe(WINDOW_START.toISOString());
    expect(result.windowEnd).toBe(WINDOW_END.toISOString());
    // BBBB, CCCC and DDDD: not AAAA (before it), EEEE (past it) or the README.
    expect(result.logFilesRead).toBe(3);
    expect(result.anonymous.reads).toBe(2);
    expect(result.outside.reads).toBe(1);
    expect(result.own.reads).toBe(1);
    expect(getReadsFromOutside(result).reads).toBe(3);
    expect(
      result.outsidePrincipals.map((each: { principal: string }): string => {
        return each.principal;
      }),
    ).toEqual([OUTSIDE_ROLE]);

    // GetBucketLogging on the store, then the log bucket listed from where the window starts.
    const calls: Array<{
      bucket: string;
      subresource: string;
      query: Record<string, string>;
      key: string;
    }> = fake.s3Calls;

    expect(calls[0]).toEqual(
      expect.objectContaining({ bucket: BUCKET, subresource: "logging" }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        bucket: LOG_BUCKET,
        subresource: "list",
        query: expect.objectContaining({
          prefix: "logs/",
          "start-after": "logs/2026-11-02-08-00-00",
          "list-type": "2",
        }),
      }),
    );
    expect(
      calls
        .filter((call: { subresource: string }): boolean => {
          return call.subresource === "object";
        })
        .map((call: { key: string }): string => {
          return call.key;
        }),
    ).toEqual([
      "logs/2026-11-02-10-00-00-BBBB",
      "logs/2026-11-05-13-00-00-CCCC",
      "logs/2026-11-12-08-00-00-DDDD",
    ]);
    // Never a write, never the store's own objects.
    for (const call of fake.s3Calls) {
      expect(call.method).toBe("GET");
      expect(call.bucket === BUCKET && call.subresource === "object").toBe(
        false,
      );
    }
  });

  test("partitioned logs are listed a day at a time, under the account, Region and bucket", async () => {
    const prefix: string = `logs/${FAKE_ACCOUNT_ID}/eu-west-1/${BUCKET}/`;
    const fake: FakeAws = fakeOf({
      partitioned: true,
      logObjects: [
        logObject(`${prefix}2026/11/02/2026-11-02-10-00-00-BBBB`, [
          line({ time: "02/Nov/2026:09:30:00 +0000" }),
        ]),
        logObject(`${prefix}2026/11/07/2026-11-07-10-00-00-CCCC`, [
          line({ time: "07/Nov/2026:09:30:00 +0000", requester: OUTSIDE_ROLE }),
        ]),
      ],
    });
    const result: ExposureLogRead = await read(readerOf(fake));
    const listed: Array<string> = fake.s3Calls
      .filter((call: { subresource: string }): boolean => {
        return call.subresource === "list";
      })
      .map((call: { query: Record<string, string> }): string => {
        return call.query["prefix"] || "";
      });

    expect(listed[0]).toBe(`${prefix}2026/11/02/`);
    expect(listed).toContain(`${prefix}2026/11/07/`);
    expect(listed[listed.length - 1]).toBe(`${prefix}2026/11/12/`);
    // A day's listing has no start-after: the day is the bound.
    expect(
      fake.s3Calls.some((call: { query: Record<string, string> }): boolean => {
        return call.query["start-after"] !== undefined;
      }),
    ).toBe(false);
    expect(result.logFilesRead).toBe(2);
    expect(getReadsFromOutside(result).reads).toBe(2);
  });

  test("a bucket that logs nothing now has no logs to read", async () => {
    const result: ExposureLogRead = await read(
      readerOf(fakeOf({ loggingTarget: undefined })),
    );

    expect(result.status).toBe(ExposureLogReadStatus.NotReadable);
    expect(result.reason).toBe(ExposureLogUnreadReason.LoggingOff);
  });

  test("a log bucket that refuses to be listed is one whose logs cannot be read, and says where they are", async () => {
    const result: ExposureLogRead = await read(
      readerOf(
        fakeOf({
          logBucketErrors: {
            list: s3Error(403, "AccessDenied", "Access Denied") as never,
          },
        }),
      ),
    );

    expect(result.status).toBe(ExposureLogReadStatus.NotReadable);
    expect(result.reason).toBe(ExposureLogUnreadReason.LogsUnreadable);
    expect(result.logLocation).toBe(`s3://${LOG_BUCKET}/logs/`);
  });

  test("a log file that cannot be read stops the read there, and keeps what it read", async () => {
    const reader: S3LogReader = readerOf(fakeOf());
    let reads: number = 0;
    const failing: S3LogReader = {
      ...reader,
      readLogObject: async (data: {
        bucket: string;
        key: string;
        maxBytes: number;
      }): Promise<Uint8Array> => {
        reads++;

        if (reads > 1) {
          throw new Error("SlowDown");
        }

        return await reader.readLogObject(data);
      },
    };
    const result: ExposureLogRead = await read(failing, { concurrency: 1 });

    expect(result.status).toBe(ExposureLogReadStatus.Read);
    expect(result.isComplete).toBe(false);
    expect(result.stoppedBecause).toBe(ExposureLogStop.ReadFailed);
    expect(result.logFilesRead).toBe(1);
    expect(result.readThrough).toBe("2026-11-02T10:00:00.000Z");
  });

  test("stops at its limits - files, bytes, time - and says which and how far its files reach", async () => {
    const byFiles: ExposureLogRead = await read(readerOf(fakeOf()), {
      maxFiles: 1,
      concurrency: 4,
    });

    expect(byFiles.isComplete).toBe(false);
    expect(byFiles.stoppedBecause).toBe(ExposureLogStop.FileLimit);
    expect(byFiles.logFilesRead).toBe(1);

    const byBytes: ExposureLogRead = await read(readerOf(fakeOf()), {
      maxBytes: 10,
      concurrency: 1,
    });

    expect(byBytes.stoppedBecause).toBe(ExposureLogStop.ByteLimit);
    expect(byBytes.logFilesRead).toBe(1);

    // The clock moves past the deadline after the first batch.
    let ticks: number = 0;
    const byTime: ExposureLogRead = await read(
      readerOf(fakeOf()),
      { concurrency: 1, deadlineAt: NOW.getTime() + 1000 },
      (): Date => {
        ticks++;
        return new Date(NOW.getTime() + (ticks > 3 ? 5000 : 0));
      },
    );

    expect(byTime.stoppedBecause).toBe(ExposureLogStop.TimeLimit);
    expect(byTime.isComplete).toBe(false);
    expect(byTime.logFilesRead).toBeGreaterThanOrEqual(1);
    expect(byTime.logFilesRead).toBeLessThan(3);
  });

  test("reads many listing pages, the same way", async () => {
    const objects: Array<FakeObject> = [];

    for (let hour: number = 0; hour < 30; hour++) {
      const at: Date = new Date(WINDOW_START.getTime() + hour * 60 * 60 * 1000);
      const stamp: string = at
        .toISOString()
        .slice(0, 19)
        .replace("T", "-")
        .split(":")
        .join("-");

      objects.push(
        logObject(`logs/${stamp}-${String(hour).padStart(4, "0")}`, [
          line({
            time: `${String(at.getUTCDate()).padStart(2, "0")}/Nov/2026:${String(at.getUTCHours()).padStart(2, "0")}:30:00 +0000`,
          }),
        ]),
      );
    }

    const reader: S3LogReader = readerOf(fakeOf({ logObjects: objects }));
    // A listing of ten keys a page, as S3 pages a long one.
    const paged: S3LogReader = {
      ...reader,
      listLogObjects: async (data: {
        bucket: string;
        prefix: string;
        startAfter?: string | undefined;
        nextToken?: string | undefined;
      }): Promise<{ keys: Array<string>; nextToken?: string | undefined }> => {
        const all: { keys: Array<string> } = await reader.listLogObjects({
          ...data,
          nextToken: undefined,
        });
        const offset: number = Number(data.nextToken || "0");
        const keys: Array<string> = all.keys.slice(offset, offset + 10);

        return {
          keys,
          nextToken:
            offset + 10 < all.keys.length ? String(offset + 10) : undefined,
        };
      },
    };
    const result: ExposureLogRead = await read(paged);

    expect(result.isComplete).toBe(true);
    expect(result.logFilesRead).toBe(30);
    expect(result.anonymous.reads).toBe(30);
  });
});

describe("the limits a read runs within", () => {
  test("a person's read fits a request; a worker's goes further, inside its job's five minutes", () => {
    expect(PERSON_LOG_READ_LIMITS.timeInMs).toBeLessThanOrEqual(30 * 1000);
    expect(JOB_LOG_READ_LIMITS.timeInMs).toBeLessThan(5 * 60 * 1000);
    expect(JOB_LOG_READ_LIMITS.maxFiles).toBeGreaterThan(
      PERSON_LOG_READ_LIMITS.maxFiles,
    );
    expect(JOB_LOG_READ_LIMITS.maxBytes).toBeGreaterThan(
      PERSON_LOG_READ_LIMITS.maxBytes,
    );
  });
});
