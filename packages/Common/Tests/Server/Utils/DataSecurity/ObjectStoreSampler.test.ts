import { describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import {
  ObjectStoreListPage,
  ObjectStoreReader,
} from "../../../../Server/Utils/DataSecurity/Cloud/DataSecurityCloudTypes";
import {
  LISTING_FACTOR,
  REREAD_AFTER_DAYS,
  SAMPLES_PER_PATTERN,
  sampleObjectStore,
} from "../../../../Server/Utils/DataSecurity/Content/ObjectStoreSampler";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  LocationFindings,
} from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { JSONObject } from "../../../../Types/JSON";
import { FieldClassification } from "../../../../Utils/DataSecurity/FieldClassifier";

/*
 * A BUCKET, SAMPLED THE WAY A SCAN SAMPLES ONE.
 *
 * An in-memory bucket stands in for S3, Azure and Google Cloud Storage
 * alike (ObjectStoreReader): it lists names a page at a time, reads the
 * first bytes of an object, and can be told to fail, to be slow or to
 * return more than it was asked for. What the sampler must do with it:
 * read a few of the most recent objects of every pattern before more of
 * any, stay inside every limit and the deadline, skip what has not changed
 * since the last scan, report findings by pattern, and say in a warning
 * what it could not do.
 */

interface FakeObject {
  key: string;
  body: Buffer;
  lastModified?: Date | undefined;
  etag?: string | undefined;
  sizeInBytes?: number | undefined;
}

class FakeBucket implements ObjectStoreReader {
  public readonly description: string = "s3://test-bucket";
  public readonly listCalls: Array<{
    nextToken?: string | undefined;
    maxKeys: number;
  }> = [];
  public readonly readCalls: Array<{ key: string; maxBytes: number }> = [];
  public pageSize: number = 1000;
  public failingKeys: Set<string> = new Set();
  public readDelayInMs: number = 0;
  // Keys whose read never answers.
  public hangingKeys: Set<string> = new Set();
  // Called after each read is answered.
  public afterRead: (() => void) | null = null;
  public listError: Error | null = null;
  public returnsWholeObjects: boolean = false;
  private readonly objects: Array<FakeObject>;

  public constructor(objects: Array<FakeObject>) {
    this.objects = [...objects].sort((a: FakeObject, b: FakeObject) => {
      return a.key < b.key ? -1 : 1;
    });
  }

  public async listObjects(options: {
    prefix?: string | undefined;
    nextToken?: string | undefined;
    maxKeys: number;
  }): Promise<ObjectStoreListPage> {
    this.listCalls.push({
      nextToken: options.nextToken,
      maxKeys: options.maxKeys,
    });

    if (this.listError) {
      throw this.listError;
    }

    const start: number = options.nextToken ? Number(options.nextToken) : 0;
    const size: number = Math.min(options.maxKeys, this.pageSize);
    const page: Array<FakeObject> = this.objects.slice(start, start + size);

    return {
      objects: page.map((object: FakeObject) => {
        return {
          key: object.key,
          sizeInBytes: object.sizeInBytes ?? object.body.length,
          lastModified: object.lastModified,
          etag: object.etag,
        };
      }),
      nextToken:
        start + size < this.objects.length ? String(start + size) : undefined,
    };
  }

  public async readObjectStart(
    key: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    this.readCalls.push({ key, maxBytes });

    if (this.hangingKeys.has(key)) {
      return await new Promise<Uint8Array>(() => {
        // Never answers.
      });
    }

    if (this.readDelayInMs > 0) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, this.readDelayInMs);
      });
    }

    // A read answers later than it is asked, as a network read does.
    await Promise.resolve();
    this.afterRead?.();

    if (this.failingKeys.has(key)) {
      throw new Error("AccessDenied: the role may not read this object");
    }

    const object: FakeObject | undefined = this.objects.find(
      (candidate: FakeObject) => {
        return candidate.key === key;
      },
    );

    if (!object) {
      throw new Error("NoSuchKey");
    }

    return this.returnsWholeObjects
      ? object.body
      : object.body.subarray(0, maxBytes);
  }

  public get readKeys(): Array<string> {
    return this.readCalls.map((call: { key: string }) => {
      return call.key;
    });
  }
}

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const NOW: number = Date.now();

function daysAgo(days: number): Date {
  return new Date(NOW - days * DAY_IN_MS);
}

function csvOfEmails(from: number, count: number): Buffer {
  const rows: Array<string> = ["id,email"];

  for (let index: number = from; index < from + count; index++) {
    rows.push(`${index},customer${index}.lee@acme-corp.com`);
  }

  return Buffer.from(rows.join("\n") + "\n");
}

function options(
  overrides: Partial<ContentScanOptions["limits"]> = {},
  rest: Partial<ContentScanOptions> = {},
): ContentScanOptions {
  return {
    limits: {
      maxObjects: 100,
      maxBytesPerObject: 64 * 1024,
      maxBytesTotal: 64 * 1024 * 1024,
      maxRowsPerTable: 1000,
      maxTables: 100,
      deadline: new Date(Date.now() + 60_000),
      ...overrides,
    },
    customDetectors: [],
    extraHints: [],
    disabledDataTypeIds: new Set(),
    allowedValues: new Set(),
    exclusions: [],
    fingerprintKey: "test-project-key",
    ...rest,
  };
}

// Ten daily exports, and a week of logs.
function dailyExports(count: number = 10): Array<FakeObject> {
  const objects: Array<FakeObject> = [];

  for (let day: number = 1; day <= count; day++) {
    const date: string = `2026-10-${String(day).padStart(2, "0")}`;

    objects.push({
      key: `exports/${date}/users-${String(day).padStart(4, "0")}.csv`,
      body: csvOfEmails(day * 100, 4),
      lastModified: daysAgo(30 - day),
      etag: `"export-${day}"`,
    });
  }

  return objects;
}

function weekOfLogs(): Array<FakeObject> {
  const objects: Array<FakeObject> = [];

  for (let day: number = 1; day <= 7; day++) {
    objects.push({
      key: `logs/app-2026-10-${String(day).padStart(2, "0")}.log`,
      body: Buffer.from(
        `2026-10-0${day}T10:00:00Z login customer${day}.lee@acme-corp.com\n2026-10-0${day}T10:00:01Z ok\n`,
      ),
      lastModified: daysAgo(10 - day),
      etag: `"log-${day}"`,
    });
  }

  return objects;
}

function locationOf(
  result: ContentScanResult,
  location: string,
): LocationFindings | undefined {
  return result.locations.find((found: LocationFindings) => {
    return found.location === location;
  });
}

function emailFinding(
  result: ContentScanResult,
  location: string,
): FieldClassification | undefined {
  return locationOf(result, location)?.classifications.find(
    (classification: FieldClassification) => {
      return classification.dataTypeId === "email-address";
    },
  );
}

describe("sampling by pattern", () => {
  test("reads the most recent objects of each pattern and reports by pattern", async () => {
    const bucket: FakeBucket = new FakeBucket([
      ...dailyExports(),
      ...weekOfLogs(),
    ]);
    const result: ContentScanResult = await sampleObjectStore(
      bucket,
      options(),
    );

    // Five of each pattern: the most recently modified first.
    expect(
      bucket.readKeys.filter((key: string) => {
        return key.startsWith("exports/");
      }),
    ).toEqual([
      "exports/2026-10-10/users-0010.csv",
      "exports/2026-10-09/users-0009.csv",
      "exports/2026-10-08/users-0008.csv",
      "exports/2026-10-07/users-0007.csv",
      "exports/2026-10-06/users-0006.csv",
    ]);
    expect(result.objectsRead).toBe(2 * SAMPLES_PER_PATTERN);
    expect(result.readLog).toEqual(bucket.readKeys);

    const csv: LocationFindings | undefined = locationOf(
      result,
      "exports/*/users-*.csv › email",
    );

    expect(csv?.locationKind).toBe(DataStoreLocationKind.Field);
    expect(emailFinding(result, "exports/*/users-*.csv › email")).toMatchObject(
      {
        matchCount: 20,
        valueCount: 20,
        matchRatio: 1,
      },
    );
    expect(locationOf(result, "logs/app-*.log")?.locationKind).toBe(
      DataStoreLocationKind.Object,
    );
    expect(result.isComplete).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test("adds the findings of a pattern's objects together, three masked samples at most", async () => {
    const result: ContentScanResult = await sampleObjectStore(
      new FakeBucket(dailyExports()),
      options(),
    );
    const finding: FieldClassification | undefined = emailFinding(
      result,
      "exports/*/users-*.csv › email",
    );

    expect(finding?.maskedSamples.length).toBeLessThanOrEqual(3);
    expect(finding?.distinctValues).toBeGreaterThanOrEqual(4);
    expect(finding?.valuesWithMatch).toBe(20);
  });

  test("covers every small pattern beside one huge one", async () => {
    const objects: Array<FakeObject> = [];

    for (let index: number = 0; index < 300; index++) {
      objects.push({
        key: `events/2026/10/27/event-${String(index).padStart(6, "0")}.json`,
        body: Buffer.from(
          JSON.stringify({ email: `p${index}.lee@acme-corp.com` }),
        ),
        lastModified: new Date(NOW - index * 1000),
      });
    }

    for (let index: number = 0; index < 20; index++) {
      objects.push({
        key: `configs/team-${String.fromCharCode(97 + index)}.env`,
        body: Buffer.from("OWNER_EMAIL=owner@acme-corp.com\n"),
        lastModified: daysAgo(100),
      });
    }

    const bucket: FakeBucket = new FakeBucket(objects);
    const result: ContentScanResult = await sampleObjectStore(
      bucket,
      options({ maxObjects: 30 }),
    );
    const configsRead: number = bucket.readKeys.filter((key: string) => {
      return key.startsWith("configs/");
    }).length;
    const eventsRead: number = bucket.readKeys.filter((key: string) => {
      return key.startsWith("events/");
    }).length;

    expect(configsRead).toBe(20);
    expect(eventsRead).toBe(SAMPLES_PER_PATTERN);
    expect(result.objectsRead).toBe(25);
  });

  test("skips directory markers, empty objects and excluded prefixes", async () => {
    const bucket: FakeBucket = new FakeBucket([
      ...dailyExports(3),
      { key: "exports/", body: Buffer.alloc(0) },
      { key: "logs/empty.log", body: Buffer.alloc(0) },
      ...weekOfLogs(),
    ]);
    const result: ContentScanResult = await sampleObjectStore(
      bucket,
      options({}, { exclusions: ["/exports/"] }),
    );

    expect(
      bucket.readKeys.some((key: string) => {
        return key.startsWith("exports/");
      }),
    ).toBe(false);
    expect(bucket.readKeys).not.toContain("logs/empty.log");
    expect(result.objectsRead).toBe(SAMPLES_PER_PATTERN);
  });

  test("does not fetch what no reader reads, and says so once per pattern", async () => {
    const bucket: FakeBucket = new FakeBucket([
      { key: "images/photo-0001.png", body: Buffer.alloc(100, 1) },
      { key: "images/photo-0002.png", body: Buffer.alloc(100, 1) },
      { key: "warehouse/part-0001.parquet", body: Buffer.alloc(100, 1) },
    ]);
    const result: ContentScanResult = await sampleObjectStore(
      bucket,
      options(),
    );

    expect(bucket.readCalls).toEqual([]);
    expect(result.warnings).toEqual([
      "images/photo-*.png: not scanned: PNG image is not supported yet",
      "warehouse/part-*.parquet: not scanned: Parquet is not supported yet",
    ]);
  });

  test("a format found only in the bytes is a warning of its pattern", async () => {
    const result: ContentScanResult = await sampleObjectStore(
      new FakeBucket([
        { key: "blobs/item-0001.dat", body: Buffer.from([1, 0, 2, 0]) },
      ]),
      options(),
    );

    expect(result.objectsRead).toBe(1);
    expect(result.warnings).toEqual([
      "blobs/item-*.dat: not scanned: binary content is not supported yet",
    ]);
  });
});

describe("limits", () => {
  test("reads at most maxBytesPerObject of each object, even from a reader that sends more", async () => {
    const bucket: FakeBucket = new FakeBucket(dailyExports());

    bucket.returnsWholeObjects = true;

    const result: ContentScanResult = await sampleObjectStore(
      bucket,
      options({ maxBytesPerObject: 40 }),
    );

    for (const call of bucket.readCalls) {
      expect(call.maxBytes).toBeLessThanOrEqual(40);
    }

    expect(result.bytesRead).toBeLessThanOrEqual(40 * result.objectsRead);
  });

  test("stops at maxBytesTotal, and says the scan is not complete", async () => {
    const result: ContentScanResult = await sampleObjectStore(
      new FakeBucket(dailyExports()),
      options({ maxBytesTotal: 250 }),
    );

    expect(result.bytesRead).toBeLessThanOrEqual(250);
    expect(result.objectsRead).toBeLessThan(SAMPLES_PER_PATTERN);
    expect(result.isComplete).toBe(false);
    expect(result.warnings.join("\n")).toContain("read its 250 bytes");
  });

  test("lists at most maxObjects times the listing factor, a page at a time", async () => {
    const objects: Array<FakeObject> = [];

    for (let index: number = 0; index < 5000; index++) {
      objects.push({
        key: `a/${String(index).padStart(5, "0")}.txt`,
        body: Buffer.from("x"),
      });
    }

    const bucket: FakeBucket = new FakeBucket(objects);

    bucket.pageSize = 37;

    const result: ContentScanResult = await sampleObjectStore(
      bucket,
      options({ maxObjects: 10 }),
    );
    const asked: number = bucket.listCalls.reduce(
      (sum: number, call: { maxKeys: number }) => {
        return sum + Math.min(call.maxKeys, 37);
      },
      0,
    );

    expect(asked).toBe(10 * LISTING_FACTOR);
    expect(result.warnings.join("\n")).toContain(
      `Listed the first ${10 * LISTING_FACTOR} objects`,
    );
  });

  test("reads at most maxObjects objects, and says which patterns were left", async () => {
    const objects: Array<FakeObject> = [];

    for (let index: number = 0; index < 12; index++) {
      objects.push({
        key: `teams/${String.fromCharCode(97 + index)}/notes.txt`,
        body: Buffer.from("nothing here"),
      });
    }

    const bucket: FakeBucket = new FakeBucket(objects);
    const result: ContentScanResult = await sampleObjectStore(
      bucket,
      options({ maxObjects: 5 }),
    );

    expect(bucket.readCalls).toHaveLength(5);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toContain(
      "7 patterns were not sampled: the scan reads at most 5 objects.",
    );
  });
});

describe("an incremental scan", () => {
  test("skips an object whose etag has not changed, and reads the next of its pattern", async () => {
    const previousState: JSONObject = {
      etags: {
        "exports/2026-10-10/users-0010.csv": {
          etag: '"export-10"',
          readAt: new Date(NOW - DAY_IN_MS).toISOString(),
        },
        // Changed since: read again.
        "exports/2026-10-09/users-0009.csv": {
          etag: '"an-older-version"',
          readAt: new Date(NOW - DAY_IN_MS).toISOString(),
        },
        // Unchanged, but read longer ago than a scan waits: read again.
        "exports/2026-10-08/users-0008.csv": {
          etag: '"export-8"',
          readAt: new Date(
            NOW - (REREAD_AFTER_DAYS + 1) * DAY_IN_MS,
          ).toISOString(),
        },
      },
    };
    const bucket: FakeBucket = new FakeBucket(dailyExports());
    const result: ContentScanResult = await sampleObjectStore(
      bucket,
      options({}, { previousState }),
    );

    expect(bucket.readKeys).not.toContain("exports/2026-10-10/users-0010.csv");
    expect(bucket.readKeys).toEqual([
      "exports/2026-10-09/users-0009.csv",
      "exports/2026-10-08/users-0008.csv",
      "exports/2026-10-07/users-0007.csv",
      "exports/2026-10-06/users-0006.csv",
      "exports/2026-10-05/users-0005.csv",
    ]);

    const etags: JSONObject = (result.nextState as JSONObject)[
      "etags"
    ] as JSONObject;

    // What was read now, and what was skipped as unchanged, for the next scan.
    expect(Object.keys(etags).sort()).toEqual(
      [
        "exports/2026-10-10/users-0010.csv",
        "exports/2026-10-09/users-0009.csv",
        "exports/2026-10-08/users-0008.csv",
        "exports/2026-10-07/users-0007.csv",
        "exports/2026-10-06/users-0006.csv",
        "exports/2026-10-05/users-0005.csv",
      ].sort(),
    );
    expect(
      (etags["exports/2026-10-09/users-0009.csv"] as JSONObject)["etag"],
    ).toBe('"export-9"');
  });

  test("forgets an object a finished listing no longer names", async () => {
    const result: ContentScanResult = await sampleObjectStore(
      new FakeBucket(dailyExports(2)),
      options(
        {},
        {
          previousState: {
            etags: {
              "exports/deleted.csv": {
                etag: '"x"',
                readAt: new Date(NOW).toISOString(),
              },
            },
          },
        },
      ),
    );
    const etags: JSONObject = (result.nextState as JSONObject)[
      "etags"
    ] as JSONObject;

    expect(Object.keys(etags)).not.toContain("exports/deleted.csv");
  });
});

describe("what goes wrong", () => {
  test("a read that fails is a warning; the others are still read", async () => {
    const bucket: FakeBucket = new FakeBucket(weekOfLogs());

    bucket.failingKeys.add("logs/app-2026-10-07.log");

    const result: ContentScanResult = await sampleObjectStore(
      bucket,
      options(),
    );

    expect(result.objectsRead).toBe(SAMPLES_PER_PATTERN - 1);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toContain(
      "Could not read logs/app-2026-10-07.log: AccessDenied: the role may not read this object",
    );
    expect(emailFinding(result, "logs/app-*.log")?.matchCount).toBe(4);
  });

  test("a listing that fails is a warning, and nothing is read", async () => {
    const bucket: FakeBucket = new FakeBucket(weekOfLogs());

    bucket.listError = new Error("AccessDenied: s3:ListBucket");

    const result: ContentScanResult = await sampleObjectStore(
      bucket,
      options(),
    );

    expect(result.objectsRead).toBe(0);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toEqual([
      "Could not list the objects of s3://test-bucket: AccessDenied: s3:ListBucket",
    ]);
    expect(result.estimatedRecords).toBeUndefined();
  });

  test("the deadline stops the scan between reads", async () => {
    const bucket: FakeBucket = new FakeBucket([
      ...dailyExports(),
      ...weekOfLogs(),
    ]);
    const scan: ContentScanOptions = options();
    const realNow: () => number = Date.now;
    let pastDeadline: boolean = false;

    /*
     * The clock passes the deadline once the first object is read - on the
     * test's own clock, so a busy runner cannot move it.
     */
    bucket.afterRead = (): void => {
      pastDeadline = true;
    };

    const clock: SpyInstance<() => number> = jest
      .spyOn(Date, "now")
      .mockImplementation((): number => {
        return pastDeadline ? scan.limits.deadline.getTime() + 1 : realNow();
      });

    let result: ContentScanResult;

    try {
      result = await sampleObjectStore(bucket, scan);
    } finally {
      clock.mockRestore();
    }

    expect(result.objectsRead).toBe(1);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toContain(
      `The scan reached its time limit after reading 1 of ${2 * SAMPLES_PER_PATTERN} objects.`,
    );
  });

  test("a read that never answers is given up at the deadline", async () => {
    const bucket: FakeBucket = new FakeBucket(dailyExports(1));

    bucket.hangingKeys.add("exports/2026-10-01/users-0001.csv");

    const result: ContentScanResult = await sampleObjectStore(
      bucket,
      options({ deadline: new Date(Date.now() + 200) }),
    );

    expect(result.objectsRead).toBe(0);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toEqual([
      "The scan reached its time limit after reading 0 of 1 objects.",
    ]);
  });

  test("a deadline already past lists nothing", async () => {
    const bucket: FakeBucket = new FakeBucket(weekOfLogs());
    const result: ContentScanResult = await sampleObjectStore(
      bucket,
      options({ deadline: new Date(Date.now() - 1000) }),
    );

    expect(bucket.listCalls).toEqual([]);
    expect(result.isComplete).toBe(false);
    expect(result.warnings[0]).toContain("time limit while listing");
  });
});

describe("what the result says about the store", () => {
  test("estimates the records with sensitive data, by pattern, from the objects read", async () => {
    const objects: Array<FakeObject> = [];

    for (let index: number = 0; index < 12; index++) {
      objects.push({
        key: `exports/batch-${String(index).padStart(4, "0")}.csv`,
        body: csvOfEmails(index * 10, 4),
        lastModified: new Date(NOW - index * 1000),
      });
    }

    const result: ContentScanResult = await sampleObjectStore(
      new FakeBucket(objects),
      options(),
    );

    // Five objects read of twelve, four records each, all with an email.
    expect(result.objectsRead).toBe(SAMPLES_PER_PATTERN);
    expect(result.rowsRead).toBe(20);
    expect(result.estimatedRecords).toBe(48);
  });

  test("scales a cut object's records by how much of it was read", async () => {
    const body: Buffer = csvOfEmails(0, 2000);
    const result: ContentScanResult = await sampleObjectStore(
      new FakeBucket([{ key: "exports/all-users.csv", body }]),
      options({ maxBytesPerObject: 4096 }),
    );

    expect(result.bytesRead).toBe(4096);
    expect(result.estimatedRecords).toBeGreaterThan(1500);
    expect(result.estimatedRecords).toBeLessThan(2500);
  });

  test("carries fingerprints and passwords kept as they are, by pattern", async () => {
    const result: ContentScanResult = await sampleObjectStore(
      new FakeBucket([
        ...dailyExports(3),
        {
          key: "deploy/prod.env",
          body: Buffer.from("DB_PASSWORD=hunter2secret\n"),
        },
      ]),
      options(),
    );

    expect(result.fingerprints["email-address"]).toHaveLength(128);
    expect(result.plaintextPasswordFields).toEqual([
      "deploy/prod.env › DB_PASSWORD",
    ]);
  });
});
