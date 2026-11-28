import {
  AccessLogTally,
  classifyS3Requester,
  ExposureLogRead,
  ExposureLogReadStatus,
  ExposureLogSource,
  ExposureLogStop,
  ExposureLogUnreadReason,
  formatBytesInEnglish,
  getAccountOfPrincipal,
  getReadsFromOutside,
  getS3LogListing,
  getS3LogObjectTime,
  getS3LogStamp,
  getUnreadLogs,
  isLogReadForWindow,
  isS3LogObjectPastWindow,
  isSuccessfulS3Listing,
  isSuccessfulS3Read,
  MAX_LOG_PRINCIPALS,
  parseS3AccessLogLine,
  parseS3LogTime,
  readExposureLogRead,
  S3AccessLogRecord,
  S3RequesterKind,
  S3_LOG_DELIVERY_SLACK_IN_HOURS,
  splitS3LogFields,
  withoutLogPrincipals,
} from "../../../Types/DataSecurity/AccessLogReads";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO READ AN EXPOSED STORE, FROM ITS OWN ACCESS LOGS (#10951): the pure
 * half. An S3 server access log line read as AWS writes it; who made each
 * request - anyone, the company's own accounts, an account outside it, an
 * AWS service, a requester nobody can place; which log objects hold a
 * window; and the window's reads added up - counts, the outside principals
 * kept apart, never a key, an address or a line.
 */

const OWNER: string =
  "79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be";
const OTHER_CANONICAL: string =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OWN_ACCOUNT: string = "111122223333";
const OUTSIDE_ACCOUNT: string = "999999999999";
const OUTSIDE_ROLE: string = `arn:aws:sts::${OUTSIDE_ACCOUNT}:assumed-role/partner-reader/session-1`;
const OWN_ROLE: string = `arn:aws:iam::${OWN_ACCOUNT}:role/exports-job`;
const BUCKET: string = "eu-customer-exports";
const WINDOW_START: Date = new Date("2026-11-02T09:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-11T09:00:00.000Z");

// One line, as S3 writes it: the time in brackets, the request, referrer and agent in quotes.
function logLine(data: {
  time?: string;
  bucket?: string;
  ip?: string;
  requester?: string;
  operation?: string;
  key?: string;
  status?: number;
  bytes?: number | "-";
  agent?: string;
}): string {
  return [
    OWNER,
    data.bucket || BUCKET,
    `[${data.time || "05/Nov/2026:13:00:00 +0000"}]`,
    data.ip || "203.0.113.7",
    data.requester === undefined ? "-" : data.requester,
    "3E57427F3EXAMPLE",
    data.operation || "REST.GET.OBJECT",
    data.key || "exports/customers-2026-11.csv",
    `"GET /${data.bucket || BUCKET}/${data.key || "exports/customers-2026-11.csv"} HTTP/1.1"`,
    String(data.status || 200),
    "-",
    String(data.bytes === undefined ? 2048 : data.bytes),
    "2048",
    "12",
    "10",
    '"-"',
    `"${data.agent || "curl/8.4.0"}"`,
    "-",
    "s9lzHYrFp76ZVxRcpX9+5cjAnEH2ROuNkd2BHfIa6UkFVdtjf5mKR3/eTPFvsiP/XV/VLi31234=",
    "SigV4",
    "ECDHE-RSA-AES128-GCM-SHA256",
    "AuthHeader",
    `${data.bucket || BUCKET}.s3.eu-west-1.amazonaws.com`,
    "TLSv1.2",
    "-",
    "-",
  ].join(" ");
}

function tally(own: Array<string> = [OWN_ACCOUNT]): AccessLogTally {
  return new AccessLogTally({
    bucket: BUCKET,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    ownAccountIds: new Set(own),
  });
}

function readOf(
  lines: Array<string>,
  isComplete: boolean = true,
): ExposureLogRead {
  const added: AccessLogTally = tally();

  added.addFile(lines.join("\n"));

  return added.toRead({
    now: new Date("2026-11-11T12:00:00.000Z"),
    logLocation: "s3://acme-logs/logs/",
    windowStart: WINDOW_START.toISOString(),
    windowEnd: WINDOW_END.toISOString(),
    isComplete,
    stoppedBecause: isComplete ? undefined : ExposureLogStop.TimeLimit,
    readThrough: isComplete ? undefined : "2026-11-06T00:00:00.000Z",
  });
}

describe("a line of an S3 server access log", () => {
  test("is read as AWS writes it: its owner, bucket, time, address, requester, operation, key, status and bytes sent", () => {
    const record: S3AccessLogRecord | null = parseS3AccessLogLine(
      logLine({ requester: OUTSIDE_ROLE, bytes: 4096 }),
    );

    expect(record).toEqual({
      bucketOwner: OWNER,
      bucket: BUCKET,
      time: new Date("2026-11-05T13:00:00.000Z"),
      remoteIp: "203.0.113.7",
      requester: OUTSIDE_ROLE,
      operation: "REST.GET.OBJECT",
      key: "exports/customers-2026-11.csv",
      httpStatus: 200,
      bytesSent: 4096,
    });
  });

  test("AWS's own example line reads", () => {
    const record: S3AccessLogRecord | null = parseS3AccessLogLine(
      '79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be DOC-EXAMPLE-BUCKET1 [06/Feb/2019:00:00:38 +0000] 192.0.2.3 79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be 3E57427F3EXAMPLE REST.GET.VERSIONING - "GET /DOC-EXAMPLE-BUCKET1?versioning HTTP/1.1" 200 - 113 - 7 - "-" "S3Console/0.4" - s9lzHYrFp76ZVxRcpX9+5cjAnEH2ROuNkd2BHfIa6UkFVdtjf5mKR3/eTPFvsiP/XV/VLi31234= SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader DOC-EXAMPLE-BUCKET1.s3.us-west-1.amazonaws.com TLSV1.2 - -',
    );

    expect(record?.bucket).toBe("DOC-EXAMPLE-BUCKET1");
    expect(record?.time.toISOString()).toBe("2019-02-06T00:00:38.000Z");
    expect(record?.operation).toBe("REST.GET.VERSIONING");
    expect(record?.key).toBe("-");
    expect(record?.bytesSent).toBe(113);
  });

  test("keeps a quoted field whole, with its spaces and an escaped quote, and a time with its zone", () => {
    expect(
      splitS3LogFields(
        'a b [06/Feb/2019:00:00:38 +0000] "GET /x HTTP/1.1" "say \\"hi\\"" c',
      ),
    ).toEqual([
      "a",
      "b",
      "[06/Feb/2019:00:00:38 +0000]",
      "GET /x HTTP/1.1",
      'say "hi"',
      "c",
    ]);
    // A zone other than UTC is read to UTC.
    expect(parseS3LogTime("[05/Nov/2026:15:30:00 +0200]")?.toISOString()).toBe(
      "2026-11-05T13:30:00.000Z",
    );
    expect(parseS3LogTime("[05/Nov/2026:08:00:00 -0500]")?.toISOString()).toBe(
      "2026-11-05T13:00:00.000Z",
    );
    expect(parseS3LogTime("[05/Foo/2026:08:00:00 +0000]")).toBeNull();
    expect(parseS3LogTime("yesterday")).toBeNull();
  });

  test("a line that is no log line - too short, no time, no status - is no record", () => {
    expect(parseS3AccessLogLine("")).toBeNull();
    expect(parseS3AccessLogLine("not a log line")).toBeNull();
    expect(
      parseS3AccessLogLine(
        logLine({}).replace("[05/Nov/2026:13:00:00 +0000]", "[soon]"),
      ),
    ).toBeNull();
    expect(
      parseS3AccessLogLine(logLine({}).replace(" 200 - 2048 ", " abc - 2048 ")),
    ).toBeNull();
    // "-" bytes sent is none.
    expect(parseS3AccessLogLine(logLine({ bytes: "-" }))?.bytesSent).toBe(0);
  });

  test("a read is an operation that sends an object's content, and succeeded; a listing names objects", () => {
    const of: (operation: string, status?: number) => S3AccessLogRecord = (
      operation: string,
      status: number = 200,
    ): S3AccessLogRecord => {
      return parseS3AccessLogLine(logLine({ operation, status }))!;
    };

    for (const operation of [
      "REST.GET.OBJECT",
      "REST.COPY.OBJECT_GET",
      "REST.POST.SELECT",
      "WEBSITE.GET.OBJECT",
      "REST.GET.OBJECT_TORRENT",
    ]) {
      expect(isSuccessfulS3Read(of(operation))).toBe(true);
    }

    // A ranged download is a read too; a refusal, a miss or a head is none.
    expect(isSuccessfulS3Read(of("REST.GET.OBJECT", 206))).toBe(true);
    expect(isSuccessfulS3Read(of("REST.GET.OBJECT", 403))).toBe(false);
    expect(isSuccessfulS3Read(of("REST.GET.OBJECT", 404))).toBe(false);
    expect(isSuccessfulS3Read(of("REST.GET.OBJECT", 304))).toBe(false);
    expect(isSuccessfulS3Read(of("REST.HEAD.OBJECT"))).toBe(false);
    expect(isSuccessfulS3Read(of("REST.PUT.OBJECT"))).toBe(false);
    expect(isSuccessfulS3Listing(of("REST.GET.BUCKET"))).toBe(true);
    expect(isSuccessfulS3Listing(of("REST.GET.BUCKET", 403))).toBe(false);
  });
});

describe("who made a request", () => {
  const classify: (requester: string) => S3RequesterKind = (
    requester: string,
  ): S3RequesterKind => {
    return classifyS3Requester({
      requester,
      bucketOwner: OWNER,
      ownAccountIds: new Set([OWN_ACCOUNT]),
    });
  };

  test("no credentials is anyone on the internet", () => {
    expect(classify("-")).toBe(S3RequesterKind.Anonymous);
    expect(classify("")).toBe(S3RequesterKind.Anonymous);
  });

  test("an IAM or STS principal is the company's own, or outside it, by its account", () => {
    expect(classify(OWN_ROLE)).toBe(S3RequesterKind.Own);
    expect(classify(`arn:aws:iam::${OWN_ACCOUNT}:root`)).toBe(
      S3RequesterKind.Own,
    );
    expect(classify(OUTSIDE_ROLE)).toBe(S3RequesterKind.Outside);
    expect(classify(`arn:aws:iam::${OUTSIDE_ACCOUNT}:user/alice`)).toBe(
      S3RequesterKind.Outside,
    );
    // Another partition reads the same way.
    expect(
      classify(`arn:aws-cn:sts::${OUTSIDE_ACCOUNT}:assumed-role/r/s`),
    ).toBe(S3RequesterKind.Outside);
    expect(getAccountOfPrincipal(OUTSIDE_ROLE)).toBe(OUTSIDE_ACCOUNT);
    expect(getAccountOfPrincipal("-")).toBe("");
  });

  test("an AWS service acting for the account is no outsider", () => {
    expect(classify("svc:cloudfront.amazonaws.com")).toBe(
      S3RequesterKind.AwsService,
    );
  });

  test("the bucket owner's canonical id is its own; another canonical id nobody can place", () => {
    expect(classify(OWNER)).toBe(S3RequesterKind.Own);
    expect(classify(OWNER.toUpperCase())).toBe(S3RequesterKind.Own);
    expect(classify(OTHER_CANONICAL)).toBe(S3RequesterKind.Unknown);
    expect(classify("something else")).toBe(S3RequesterKind.Unknown);
  });
});

describe("which log objects hold a window", () => {
  test("S3 names a log object for when it was written, to the second", () => {
    expect(getS3LogStamp(new Date("2026-11-02T08:05:09.000Z"))).toBe(
      "2026-11-02-08-05-09",
    );
    expect(
      getS3LogObjectTime(
        "logs/2026-11-02-08-05-09-1A2B3C4D5E6F7A8B",
      )?.toISOString(),
    ).toBe("2026-11-02T08:05:09.000Z");
    expect(
      getS3LogObjectTime(
        `logs/${OWN_ACCOUNT}/eu-west-1/${BUCKET}/2026/11/02/2026-11-02-08-05-09-1A2B3C4D5E6F7A8B`,
      )?.toISOString(),
    ).toBe("2026-11-02T08:05:09.000Z");
    expect(getS3LogObjectTime("logs/readme.txt")).toBeNull();
  });

  test("straight under its prefix: one listing, from an hour before the window", () => {
    expect(
      getS3LogListing({
        target: { bucket: "acme-logs", prefix: "logs/", isPartitioned: false },
        sourceAccountId: OWN_ACCOUNT,
        sourceRegion: "eu-west-1",
        sourceBucket: BUCKET,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      }),
    ).toEqual([{ prefix: "logs/", startAfter: "logs/2026-11-02-08-00-00" }]);
  });

  test("partitioned: a listing a day, from the window's first day to the end of its delivery slack", () => {
    const listings: Array<{ prefix: string }> = getS3LogListing({
      target: { bucket: "acme-logs", prefix: "logs/", isPartitioned: true },
      sourceAccountId: OWN_ACCOUNT,
      sourceRegion: "eu-west-1",
      sourceBucket: BUCKET,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    // 2 November to 12 November: the window's days and the day after it ends.
    expect(listings).toHaveLength(11);
    expect(listings[0]!.prefix).toBe(
      `logs/${OWN_ACCOUNT}/eu-west-1/${BUCKET}/2026/11/02/`,
    );
    expect(listings[10]!.prefix).toBe(
      `logs/${OWN_ACCOUNT}/eu-west-1/${BUCKET}/2026/11/12/`,
    );
  });

  test("a log object written past the window's end and its slack is past it", () => {
    expect(S3_LOG_DELIVERY_SLACK_IN_HOURS).toBe(24);
    expect(
      isS3LogObjectPastWindow("logs/2026-11-12-08-59-59-AAAA", WINDOW_END),
    ).toBe(false);
    expect(
      isS3LogObjectPastWindow("logs/2026-11-12-09-00-01-AAAA", WINDOW_END),
    ).toBe(true);
    expect(isS3LogObjectPastWindow("logs/readme.txt", WINDOW_END)).toBe(false);
  });
});

describe("the window's reads, added up", () => {
  test("counts the reads of the store's own lines in the window, by who made them", () => {
    const read: ExposureLogRead = readOf([
      // Anyone on the internet: two reads of one object, from two addresses.
      logLine({ ip: "203.0.113.7", bytes: 1000 }),
      logLine({ ip: "198.51.100.4", bytes: 1500 }),
      // An outside account, twice, two objects.
      logLine({ requester: OUTSIDE_ROLE, key: "a.csv", bytes: 300 }),
      logLine({ requester: OUTSIDE_ROLE, key: "b.csv", bytes: 200 }),
      // Somebody no one can place.
      logLine({ requester: OTHER_CANONICAL, key: "c.csv", bytes: 10 }),
      // The company's own and an AWS service: not from outside.
      logLine({ requester: OWN_ROLE, key: "d.csv", bytes: 99 }),
      logLine({ requester: "svc:cloudfront.amazonaws.com", bytes: 5 }),
      // Not reads: a refusal, a write.
      logLine({ status: 403 }),
      logLine({ operation: "REST.PUT.OBJECT" }),
      // Another bucket's line in the same log prefix, and lines outside the window.
      logLine({ bucket: "eu-invoices" }),
      logLine({ time: "02/Nov/2026:08:59:59 +0000" }),
      logLine({ time: "11/Nov/2026:09:00:01 +0000" }),
      // A listing from outside: names, not content.
      logLine({ operation: "REST.GET.BUCKET", key: "-" }),
      "a line that is no log line",
    ]);

    expect(read.status).toBe(ExposureLogReadStatus.Read);
    expect(read.source).toBe(ExposureLogSource.S3ServerAccessLogs);
    expect(read.logFilesRead).toBe(1);
    expect(read.anonymous).toEqual({
      reads: 2,
      bytes: 2500,
      objects: 1,
      addresses: 2,
    });
    expect(read.outside).toEqual({
      reads: 2,
      bytes: 500,
      objects: 2,
      accounts: 1,
    });
    expect(read.unknown).toEqual({
      reads: 1,
      bytes: 10,
      objects: 1,
      requesters: 1,
    });
    expect(read.own).toEqual({ reads: 1, bytes: 99, objects: 1 });
    expect(read.services).toEqual({ reads: 1, bytes: 5, objects: 1 });
    expect(read.listingsFromOutside).toBe(1);
    expect(getReadsFromOutside(read)).toEqual({
      reads: 5,
      bytes: 3010,
      objects: 4,
    });
  });

  test("keeps the outside principals apart, the most reads first, with when each read; never a key or an address", () => {
    const read: ExposureLogRead = readOf([
      logLine({ requester: OUTSIDE_ROLE, time: "04/Nov/2026:10:00:00 +0000" }),
      logLine({ requester: OUTSIDE_ROLE, time: "06/Nov/2026:10:00:00 +0000" }),
      logLine({
        requester: `arn:aws:iam::${OUTSIDE_ACCOUNT}:user/alice`,
        time: "05/Nov/2026:10:00:00 +0000",
      }),
    ]);

    expect(read.outsidePrincipals).toEqual([
      {
        principal: OUTSIDE_ROLE,
        accountId: OUTSIDE_ACCOUNT,
        reads: 2,
        bytes: 4096,
        firstAt: "2026-11-04T10:00:00.000Z",
        lastAt: "2026-11-06T10:00:00.000Z",
      },
      {
        principal: `arn:aws:iam::${OUTSIDE_ACCOUNT}:user/alice`,
        accountId: OUTSIDE_ACCOUNT,
        reads: 1,
        bytes: 2048,
        firstAt: "2026-11-05T10:00:00.000Z",
        lastAt: "2026-11-05T10:00:00.000Z",
      },
    ]);

    const kept: string = JSON.stringify(read);

    expect(kept).not.toContain("exports/customers-2026-11.csv");
    expect(kept).not.toContain("203.0.113.7");
    expect(kept).not.toContain("curl/8.4.0");
  });

  test("names at most fifty outside principals, counting every one", () => {
    const lines: Array<string> = [];

    for (let index: number = 0; index < MAX_LOG_PRINCIPALS + 10; index++) {
      lines.push(
        logLine({
          requester: `arn:aws:iam::${String(100000000000 + index)}:user/u${index}`,
        }),
      );
    }

    const read: ExposureLogRead = readOf(lines);

    expect(read.outsidePrincipals).toHaveLength(MAX_LOG_PRINCIPALS);
    expect(read.outside.accounts).toBe(MAX_LOG_PRINCIPALS + 10);
    expect(read.outside.reads).toBe(MAX_LOG_PRINCIPALS + 10);
  });

  test("a read that stopped early says so, and how far its files reach", () => {
    const read: ExposureLogRead = readOf([logLine({})], false);

    expect(read.isComplete).toBe(false);
    expect(read.stoppedBecause).toBe(ExposureLogStop.TimeLimit);
    expect(read.readThrough).toBe("2026-11-06T00:00:00.000Z");
    expect(readOf([logLine({})]).stoppedBecause).toBeUndefined();
  });

  test("an account the project connected is its own, however it reads", () => {
    const added: AccessLogTally = tally([OWN_ACCOUNT, OUTSIDE_ACCOUNT]);

    added.addFile(logLine({ requester: OUTSIDE_ROLE }));

    const read: ExposureLogRead = added.toRead({
      now: new Date("2026-11-11T12:00:00.000Z"),
      logLocation: "s3://acme-logs/logs/",
      windowStart: WINDOW_START.toISOString(),
      windowEnd: WINDOW_END.toISOString(),
      isComplete: true,
    });

    expect(read.own.reads).toBe(1);
    expect(read.outside.reads).toBe(0);
    expect(read.outsidePrincipals).toEqual([]);
  });
});

describe("a read, as a case keeps it", () => {
  test("is read back as written, and anything else is cut away", () => {
    const read: ExposureLogRead = readOf([
      logLine({ requester: OUTSIDE_ROLE }),
      logLine({}),
    ]);

    expect(readExposureLogRead(JSON.parse(JSON.stringify(read)))).toEqual(read);
    expect(readExposureLogRead(null)).toBeNull();
    expect(readExposureLogRead({ status: "Read" })).toBeNull();
    expect(readExposureLogRead({ status: "Lost", readAt: "x" })).toBeNull();

    const junk: ExposureLogRead | null = readExposureLogRead({
      ...JSON.parse(JSON.stringify(read)),
      anonymous: { reads: -5, bytes: "many", objects: 2.7, addresses: 3 },
      stoppedBecause: "Bored",
      outsidePrincipals: [
        { reads: 1 },
        "a principal",
        { principal: OUTSIDE_ROLE },
      ],
    });

    expect(junk?.anonymous).toEqual({
      reads: 0,
      bytes: 0,
      objects: 2,
      addresses: 3,
    });
    expect(junk?.stoppedBecause).toBeUndefined();
    expect(
      junk?.outsidePrincipals.map(
        (principal: { principal: string }): string => {
          return principal.principal;
        },
      ),
    ).toEqual([OUTSIDE_ROLE]);
  });

  test("without its principals, for a reader who may not see who can reach the store", () => {
    const read: ExposureLogRead = readOf([
      logLine({ requester: OUTSIDE_ROLE }),
    ]);

    expect(read.outsidePrincipals).toHaveLength(1);
    expect(withoutLogPrincipals(read).outsidePrincipals).toEqual([]);
    expect(withoutLogPrincipals(read).outside.reads).toBe(1);
    expect(JSON.stringify(withoutLogPrincipals(read))).not.toContain(
      "partner-reader",
    );
  });

  test("one that could not be made says why, with nothing counted", () => {
    const unread: ExposureLogRead = getUnreadLogs({
      reason: ExposureLogUnreadReason.NoContentAccess,
      now: new Date("2026-11-11T12:00:00.000Z"),
    });

    expect(unread.status).toBe(ExposureLogReadStatus.NotReadable);
    expect(unread.reason).toBe(ExposureLogUnreadReason.NoContentAccess);
    expect(getReadsFromOutside(unread)).toEqual({
      reads: 0,
      bytes: 0,
      objects: 0,
    });
  });

  test("is for the window as it is now only when the window has not changed since", () => {
    const read: ExposureLogRead = readOf([logLine({})]);

    expect(
      isLogReadForWindow({
        read,
        windowStart: WINDOW_START.toISOString(),
        windowEnd: WINDOW_END.toISOString(),
      }),
    ).toBe(true);
    // The exposure reopened, or a change in the cloud's log moved its start.
    expect(
      isLogReadForWindow({
        read,
        windowStart: "2026-10-30T09:00:00.000Z",
        windowEnd: WINDOW_END.toISOString(),
      }),
    ).toBe(false);
    expect(
      isLogReadForWindow({
        read,
        windowStart: WINDOW_START.toISOString(),
        windowEnd: undefined,
      }),
    ).toBe(true);

    const whileOpen: ExposureLogRead = {
      ...read,
      windowEnd: "2026-11-11T12:00:00.000Z",
      readAt: "2026-11-11T12:00:00.000Z",
    };

    // Read while still open: it reaches the moment it was read.
    expect(
      isLogReadForWindow({
        read: whileOpen,
        windowStart: WINDOW_START.toISOString(),
        windowEnd: undefined,
      }),
    ).toBe(true);
    // Closed since: read it again.
    expect(
      isLogReadForWindow({
        read: whileOpen,
        windowStart: WINDOW_START.toISOString(),
        windowEnd: "2026-11-11T14:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("a size in English", () => {
  test("is written as the usage pages write it: GB to two decimals, MB and KB to one, a no-break space before the unit", () => {
    expect(formatBytesInEnglish(0)).toBe(`0${NO_BREAK_SPACE}GB`);
    expect(formatBytesInEnglish(2.25 * 1024 * 1024 * 1024)).toBe(
      `2.25${NO_BREAK_SPACE}GB`,
    );
    expect(formatBytesInEnglish(1536 * 1024 * 1024 * 1024)).toBe(
      `1,536${NO_BREAK_SPACE}GB`,
    );
    expect(formatBytesInEnglish(3.5 * 1024 * 1024)).toBe(
      `3.5${NO_BREAK_SPACE}MB`,
    );
    expect(formatBytesInEnglish(2048)).toBe(`2${NO_BREAK_SPACE}KB`);
    expect(formatBytesInEnglish(10)).toBe(`0.1${NO_BREAK_SPACE}KB`);
    expect(formatBytesInEnglish(Number.NaN)).toBe(`0${NO_BREAK_SPACE}GB`);
  });
});
