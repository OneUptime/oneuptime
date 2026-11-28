import { NO_BREAK_SPACE } from "../NoBreakSpaces";

/*
 * WHO READ AN EXPOSED STORE, FROM ITS OWN ACCESS LOGS (#10951).
 *
 * An exposure's assessment says whether reads were logged at all. Where
 * they were - an S3 bucket with server access logging on - OneUptime now
 * reads those logs for the exposure's window and says who read it: how
 * many reads came from anyone on the internet, from accounts outside the
 * company and from requesters it cannot place, how much was sent, and how
 * many objects were read. This file is the pure half:
 *
 *   - parseS3AccessLogLine: one line of a server access log, as AWS writes
 *     it (space-separated, the time in brackets, the request, referrer and
 *     user agent in quotes);
 *   - classifyS3Requester: who made a request - anonymous ("-"), one of
 *     the company's accounts, an account outside it, an AWS service, or a
 *     canonical user OneUptime cannot place;
 *   - getS3LogListing and getS3LogObjectTime: which log objects hold the
 *     window, by the time S3 writes into their names;
 *   - AccessLogTally: the reads of the window added up, by who made them -
 *     counts, and the outside principals for a reader who may see who can
 *     reach the store. Never an object's name: objects are counted.
 *
 * What it keeps is counts and, separately, the outside principals: never a
 * key, never an address, never a line of the log. OneUptime AI is told the
 * counts only (DataSecurityAiInput, the exposure:reads fact).
 */

export enum ExposureLogSource {
  // An S3 bucket's server access logs, read from the bucket they are written to.
  S3ServerAccessLogs = "S3ServerAccessLogs",
}

export enum ExposureLogReadStatus {
  // OneUptime read the logs of the window: all of them, or as far as its limits let it.
  Read = "Read",
  // It could not: OneUptime AI and the card say why.
  NotReadable = "NotReadable",
}

// Why the logs could not be read.
export enum ExposureLogUnreadReason {
  // A store whose access logs OneUptime does not read (only S3 buckets' today).
  NotSupported = "NotSupported",
  // The store's connection may not read objects: its data security access is not "content".
  NoContentAccess = "NoContentAccess",
  // The store logs no reads now, or its logging target could not be read.
  LoggingOff = "LoggingOff",
  // The bucket the logs are written to refused, or could not be read.
  LogsUnreadable = "LogsUnreadable",
  // No time the store was exposed to read the logs for.
  NoWindow = "NoWindow",
}

// Why a read stopped before the window's end.
export enum ExposureLogStop {
  TimeLimit = "TimeLimit",
  FileLimit = "FileLimit",
  ByteLimit = "ByteLimit",
  // A log file could not be read: the files after it were not.
  ReadFailed = "ReadFailed",
}

// Who made a request, as the log names them.
export enum S3RequesterKind {
  // "-": no credentials - anyone on the internet.
  Anonymous = "Anonymous",
  // A principal of one of the company's AWS accounts.
  Own = "Own",
  // A principal of an AWS account outside the company.
  Outside = "Outside",
  // An AWS service acting for the account ("svc:...").
  AwsService = "AwsService",
  // A canonical user that is not the bucket's owner: OneUptime cannot place it.
  Unknown = "Unknown",
}

// One line of an S3 server access log: what an assessment reads of it.
export interface S3AccessLogRecord {
  bucketOwner: string;
  bucket: string;
  time: Date;
  remoteIp: string;
  requester: string;
  operation: string;
  key: string;
  httpStatus: number;
  bytesSent: number;
}

/*
 * The operations that send an object's content: a download, a copy's read
 * of its source, a select, a torrent, and a website's page. A listing names
 * objects without sending them, and is counted apart.
 */
export const S3_READ_OPERATIONS: ReadonlyArray<string> = [
  "REST.GET.OBJECT",
  "REST.GET.OBJECT_TORRENT",
  "REST.COPY.OBJECT_GET",
  "REST.POST.SELECT",
  "REST.SELECT.OBJECT",
  "WEBSITE.GET.OBJECT",
];

export const S3_LISTING_OPERATIONS: ReadonlyArray<string> = [
  "REST.GET.BUCKET",
  "REST.GET.BUCKETVERSIONS",
];

const MONTHS: Readonly<Record<string, number>> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

// "[06/Feb/2019:00:00:38 +0000]", read: the moment, or null.
export function parseS3LogTime(value: string): Date | null {
  const match: RegExpMatchArray | null = value.match(
    /^\[?(\d{2})\/([A-Z][a-z]{2})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})\]?$/,
  );

  if (!match) {
    return null;
  }

  const month: number | undefined = MONTHS[match[2]!];

  if (month === undefined) {
    return null;
  }

  const offset: number =
    (match[7] === "-" ? -1 : 1) *
    (Number(match[8]) * 60 + Number(match[9])) *
    60 *
    1000;
  const at: number =
    Date.UTC(
      Number(match[3]),
      month,
      Number(match[1]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ) - offset;

  return Number.isNaN(at) ? null : new Date(at);
}

/*
 * A line's fields: separated by spaces, except a bracketed time and a
 * quoted request, referrer or user agent, which hold spaces of their own
 * (and, in quotes, an escaped quote).
 */
export function splitS3LogFields(line: string): Array<string> {
  const fields: Array<string> = [];
  let index: number = 0;
  const text: string = line.trim();

  while (index < text.length) {
    while (text[index] === " ") {
      index++;
    }

    if (index >= text.length) {
      break;
    }

    if (text[index] === "[") {
      const end: number = text.indexOf("]", index);

      if (end === -1) {
        fields.push(text.slice(index));
        break;
      }

      fields.push(text.slice(index, end + 1));
      index = end + 1;
      continue;
    }

    if (text[index] === '"') {
      let end: number = index + 1;
      let value: string = "";

      while (end < text.length && text[end] !== '"') {
        if (text[end] === "\\" && end + 1 < text.length) {
          value += text[end + 1];
          end += 2;
          continue;
        }

        value += text[end];
        end++;
      }

      fields.push(value);
      index = end + 1;
      continue;
    }

    const end: number = text.indexOf(" ", index);

    if (end === -1) {
      fields.push(text.slice(index));
      break;
    }

    fields.push(text.slice(index, end));
    index = end;
  }

  return fields;
}

function readCount(value: string | undefined): number {
  const count: number = Number(value);

  return value && value !== "-" && Number.isFinite(count) && count >= 0
    ? Math.floor(count)
    : 0;
}

/*
 * One line of a server access log, or null for a line that is not one:
 * Bucket Owner, Bucket, Time, Remote IP, Requester, Request ID, Operation,
 * Key, Request-URI, HTTP status, Error Code, Bytes Sent, and the rest.
 */
export function parseS3AccessLogLine(line: string): S3AccessLogRecord | null {
  const fields: Array<string> = splitS3LogFields(line);

  if (fields.length < 12) {
    return null;
  }

  const time: Date | null = parseS3LogTime(fields[2]!);
  const status: number = Number(fields[9]);

  if (!time || !Number.isInteger(status)) {
    return null;
  }

  return {
    bucketOwner: fields[0]!,
    bucket: fields[1]!,
    time,
    remoteIp: fields[3]!,
    requester: fields[4]!,
    operation: fields[6]!,
    key: fields[7]!,
    httpStatus: status,
    bytesSent: readCount(fields[11]),
  };
}

// The AWS account of an IAM or STS principal's ARN, or "".
export function getAccountOfPrincipal(requester: string): string {
  const match: RegExpMatchArray | null = requester.match(
    /^arn:aws[a-z-]*:(?:iam|sts)::(\d{12}):/,
  );

  return match ? match[1]! : "";
}

// A canonical user id: 64 hexadecimal characters.
const CANONICAL_USER: RegExp = /^[0-9a-f]{64}$/i;

/*
 * Who made a request: anonymous, one of the company's accounts, an
 * account outside it, an AWS service, or a canonical user OneUptime cannot
 * place (the bucket's owner is its own).
 */
export function classifyS3Requester(data: {
  requester: string;
  bucketOwner: string;
  ownAccountIds: ReadonlySet<string>;
}): S3RequesterKind {
  const requester: string = data.requester.trim();

  if (!requester || requester === "-") {
    return S3RequesterKind.Anonymous;
  }

  if (requester.startsWith("svc:")) {
    return S3RequesterKind.AwsService;
  }

  const account: string = getAccountOfPrincipal(requester);

  if (account) {
    return data.ownAccountIds.has(account)
      ? S3RequesterKind.Own
      : S3RequesterKind.Outside;
  }

  if (CANONICAL_USER.test(requester)) {
    return requester.toLowerCase() === data.bucketOwner.trim().toLowerCase()
      ? S3RequesterKind.Own
      : S3RequesterKind.Unknown;
  }

  return S3RequesterKind.Unknown;
}

// Whether a request read an object's content, and succeeded.
export function isSuccessfulS3Read(record: S3AccessLogRecord): boolean {
  return (
    S3_READ_OPERATIONS.includes(record.operation) &&
    (record.httpStatus === 200 || record.httpStatus === 206)
  );
}

export function isSuccessfulS3Listing(record: S3AccessLogRecord): boolean {
  return (
    S3_LISTING_OPERATIONS.includes(record.operation) &&
    record.httpStatus === 200
  );
}

/*
 * ---------------------------------------------------------------------------
 * Which log objects hold a window
 * ---------------------------------------------------------------------------
 */

// Where a bucket's server access logs are written, as its logging configuration says.
export interface S3LoggingTarget {
  bucket: string;
  prefix: string;
  /*
   * Partitioned: [prefix][account]/[Region]/[bucket]/[YYYY]/[MM]/[DD]/...,
   * else every log object straight under the prefix.
   */
  isPartitioned: boolean;
}

/*
 * How long after a request its log record may be delivered: the log object
 * holding it is named for when it was written. AWS delivers most within a
 * few hours; a day covers the rest.
 */
export const S3_LOG_DELIVERY_SLACK_IN_HOURS: number = 24;

function pad(value: number, width: number = 2): string {
  return String(value).padStart(width, "0");
}

// "2026-11-02-09-00-00": how S3 names a log object for when it was written.
export function getS3LogStamp(at: Date): string {
  return [
    at.getUTCFullYear(),
    pad(at.getUTCMonth() + 1),
    pad(at.getUTCDate()),
    pad(at.getUTCHours()),
    pad(at.getUTCMinutes()),
    pad(at.getUTCSeconds()),
  ].join("-");
}

// When a log object was written, from its name's last part: "...2026-11-02-09-00-00-1A2B3C4D".
export function getS3LogObjectTime(key: string): Date | null {
  const name: string = key.split("/").pop() || "";
  const match: RegExpMatchArray | null = name.match(
    /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-/,
  );

  if (!match) {
    return null;
  }

  const at: number = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );

  return Number.isNaN(at) ? null : new Date(at);
}

// One listing of log objects: a prefix, and where in it to start.
export interface S3LogListing {
  prefix: string;
  startAfter?: string | undefined;
}

/*
 * The listings that hold a window's log objects. Straight under a prefix,
 * one listing from an hour before the window, read until the objects are
 * written after its end and the delivery slack; partitioned, one listing a
 * day, from the window's first day to the day the slack ends.
 */
export function getS3LogListing(data: {
  target: S3LoggingTarget;
  sourceAccountId: string;
  sourceRegion: string;
  sourceBucket: string;
  windowStart: Date;
  windowEnd: Date;
}): Array<S3LogListing> {
  if (!data.target.isPartitioned) {
    return [
      {
        prefix: data.target.prefix,
        startAfter: `${data.target.prefix}${getS3LogStamp(
          new Date(data.windowStart.getTime() - 60 * 60 * 1000),
        )}`,
      },
    ];
  }

  const listings: Array<S3LogListing> = [];
  const day: number = 24 * 60 * 60 * 1000;
  const last: number =
    data.windowEnd.getTime() + S3_LOG_DELIVERY_SLACK_IN_HOURS * 60 * 60 * 1000;
  let at: number = Date.UTC(
    data.windowStart.getUTCFullYear(),
    data.windowStart.getUTCMonth(),
    data.windowStart.getUTCDate(),
  );

  // A year of days at most: a longer window is read as far as its limits let it.
  while (at <= last && listings.length < 366) {
    const date: Date = new Date(at);

    listings.push({
      prefix: `${data.target.prefix}${data.sourceAccountId}/${data.sourceRegion}/${data.sourceBucket}/${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/`,
    });
    at += day;
  }

  return listings;
}

// Whether a log object was written past the window's end and its delivery slack.
export function isS3LogObjectPastWindow(key: string, windowEnd: Date): boolean {
  const written: Date | null = getS3LogObjectTime(key);

  return (
    written !== null &&
    written.getTime() >
      windowEnd.getTime() + S3_LOG_DELIVERY_SLACK_IN_HOURS * 60 * 60 * 1000
  );
}

/*
 * ---------------------------------------------------------------------------
 * What the logs say, added up
 * ---------------------------------------------------------------------------
 */

export interface AccessLogCounts {
  reads: number;
  bytes: number;
  // Distinct objects read; never their names.
  objects: number;
}

// An outside principal that read the store, for a reader who may see who can reach it.
export interface ExposureLogPrincipal {
  principal: string;
  accountId?: string | undefined;
  reads: number;
  bytes: number;
  firstAt: string;
  lastAt: string;
}

// The most outside principals a read keeps by name, and objects it tells apart.
export const MAX_LOG_PRINCIPALS: number = 50;
export const MAX_DISTINCT_LOG_OBJECTS: number = 200_000;

export interface ExposureLogRead {
  source: ExposureLogSource;
  status: ExposureLogReadStatus;
  reason?: ExposureLogUnreadReason | undefined;
  readAt: string;
  // The window it read for.
  windowStart?: string | undefined;
  windowEnd?: string | undefined;
  // Where the logs are: "s3://bucket/prefix".
  logLocation?: string | undefined;
  logFilesRead: number;
  // Every log file of the window was read.
  isComplete: boolean;
  stoppedBecause?: ExposureLogStop | undefined;
  // The last moment the log files read reach, when it stopped early.
  readThrough?: string | undefined;
  anonymous: AccessLogCounts & { addresses: number };
  outside: AccessLogCounts & { accounts: number };
  unknown: AccessLogCounts & { requesters: number };
  services: AccessLogCounts;
  own: AccessLogCounts;
  // Listings of the bucket's objects from outside the company: names, not content.
  listingsFromOutside: number;
  // More distinct objects were read than a read tells apart: the counts are at least these.
  isObjectCountCapped: boolean;
  /*
   * The outside principals, the most reads first: shown only to a reader
   * who may read who can reach the store, never to OneUptime AI.
   */
  outsidePrincipals: Array<ExposureLogPrincipal>;
}

/*
 * A number of bytes in English, as the usage pages write a size - "GB" is
 * GiB, to two decimals; MB and KB to one (formatTelemetryUsageSize) - so
 * OneUptime AI and an export are told the size the card draws ("2.1 GB"),
 * and a draft that says it says a number its facts hold.
 */
export function formatBytesInEnglish(bytes: number): string {
  const value: number = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const gigabytes: number = value / (1024 * 1024 * 1024);
  const english: (amount: number) => string = (amount: number): string => {
    return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  };

  if (gigabytes === 0 || gigabytes >= 1) {
    return `${english(Math.round(gigabytes * 100) / 100)}${NO_BREAK_SPACE}GB`;
  }

  const megabytes: number = gigabytes * 1024;

  if (megabytes >= 1) {
    return `${english(Math.round(megabytes * 10) / 10)}${NO_BREAK_SPACE}MB`;
  }

  return `${english(
    Math.max(0.1, Math.round(megabytes * 1024 * 10) / 10),
  )}${NO_BREAK_SPACE}KB`;
}

// The reads from outside the company: anyone on the internet, outside accounts and requesters it cannot place.
export function getReadsFromOutside(read: ExposureLogRead): AccessLogCounts {
  return {
    reads: read.anonymous.reads + read.outside.reads + read.unknown.reads,
    bytes: read.anonymous.bytes + read.outside.bytes + read.unknown.bytes,
    objects:
      read.anonymous.objects + read.outside.objects + read.unknown.objects,
  };
}

function emptyCounts(): AccessLogCounts {
  return { reads: 0, bytes: 0, objects: 0 };
}

// A read that could not be made, and why.
export function getUnreadLogs(data: {
  reason: ExposureLogUnreadReason;
  now: Date;
  logLocation?: string | undefined;
  windowStart?: string | undefined;
  windowEnd?: string | undefined;
}): ExposureLogRead {
  return {
    source: ExposureLogSource.S3ServerAccessLogs,
    status: ExposureLogReadStatus.NotReadable,
    reason: data.reason,
    readAt: data.now.toISOString(),
    windowStart: data.windowStart,
    windowEnd: data.windowEnd,
    logLocation: data.logLocation,
    logFilesRead: 0,
    isComplete: false,
    anonymous: { ...emptyCounts(), addresses: 0 },
    outside: { ...emptyCounts(), accounts: 0 },
    unknown: { ...emptyCounts(), requesters: 0 },
    services: emptyCounts(),
    own: emptyCounts(),
    listingsFromOutside: 0,
    isObjectCountCapped: false,
    outsidePrincipals: [],
  };
}

/*
 * The reads of a window, added up as the log files are read: each line of
 * the store's bucket, in the window, that read an object - by who made it.
 */
export class AccessLogTally {
  private readonly bucket: string;
  private readonly start: number;
  private readonly end: number;
  private readonly ownAccountIds: ReadonlySet<string>;
  private readonly objects: Record<S3RequesterKind, Set<string>>;
  private readonly addresses: Set<string> = new Set();
  private readonly accounts: Set<string> = new Set();
  private readonly requesters: Set<string> = new Set();
  private readonly principals: Map<string, ExposureLogPrincipal> = new Map();
  private readonly counts: Record<
    S3RequesterKind,
    { reads: number; bytes: number }
  >;
  private listings: number = 0;
  private distinctObjects: number = 0;
  private isCapped: boolean = false;
  public filesRead: number = 0;

  public constructor(data: {
    bucket: string;
    windowStart: Date;
    windowEnd: Date;
    ownAccountIds: ReadonlySet<string>;
  }) {
    this.bucket = data.bucket;
    this.start = data.windowStart.getTime();
    this.end = data.windowEnd.getTime();
    this.ownAccountIds = data.ownAccountIds;
    this.objects = {
      [S3RequesterKind.Anonymous]: new Set(),
      [S3RequesterKind.Own]: new Set(),
      [S3RequesterKind.Outside]: new Set(),
      [S3RequesterKind.AwsService]: new Set(),
      [S3RequesterKind.Unknown]: new Set(),
    };
    this.counts = {
      [S3RequesterKind.Anonymous]: { reads: 0, bytes: 0 },
      [S3RequesterKind.Own]: { reads: 0, bytes: 0 },
      [S3RequesterKind.Outside]: { reads: 0, bytes: 0 },
      [S3RequesterKind.AwsService]: { reads: 0, bytes: 0 },
      [S3RequesterKind.Unknown]: { reads: 0, bytes: 0 },
    };
  }

  // One log file's text: each of its lines added.
  public addFile(text: string): void {
    this.filesRead++;

    for (const line of text.split("\n")) {
      if (!line.trim()) {
        continue;
      }

      const record: S3AccessLogRecord | null = parseS3AccessLogLine(line);

      if (record) {
        this.addRecord(record);
      }
    }
  }

  public addRecord(record: S3AccessLogRecord): void {
    // A log prefix can hold other buckets' logs, and a file reaches past the window.
    if (record.bucket !== this.bucket) {
      return;
    }

    const at: number = record.time.getTime();

    if (at < this.start || at > this.end) {
      return;
    }

    const kind: S3RequesterKind = classifyS3Requester({
      requester: record.requester,
      bucketOwner: record.bucketOwner,
      ownAccountIds: this.ownAccountIds,
    });

    if (isSuccessfulS3Listing(record)) {
      if (
        kind === S3RequesterKind.Anonymous ||
        kind === S3RequesterKind.Outside ||
        kind === S3RequesterKind.Unknown
      ) {
        this.listings++;
      }

      return;
    }

    if (!isSuccessfulS3Read(record)) {
      return;
    }

    this.counts[kind].reads++;
    this.counts[kind].bytes += record.bytesSent;

    const objects: Set<string> = this.objects[kind];

    if (!objects.has(record.key)) {
      if (this.distinctObjects < MAX_DISTINCT_LOG_OBJECTS) {
        objects.add(record.key);
        this.distinctObjects++;
      } else {
        this.isCapped = true;
      }
    }

    switch (kind) {
      case S3RequesterKind.Anonymous:
        if (this.addresses.size < MAX_DISTINCT_LOG_OBJECTS) {
          this.addresses.add(record.remoteIp);
        }
        break;
      case S3RequesterKind.Outside:
        this.accounts.add(getAccountOfPrincipal(record.requester));
        this.addPrincipal(record);
        break;
      case S3RequesterKind.Unknown:
        if (this.requesters.size < MAX_DISTINCT_LOG_OBJECTS) {
          this.requesters.add(record.requester);
        }
        break;
      default:
        break;
    }
  }

  private addPrincipal(record: S3AccessLogRecord): void {
    const at: string = record.time.toISOString();
    const known: ExposureLogPrincipal | undefined = this.principals.get(
      record.requester,
    );

    if (known) {
      known.reads++;
      known.bytes += record.bytesSent;
      known.firstAt = at < known.firstAt ? at : known.firstAt;
      known.lastAt = at > known.lastAt ? at : known.lastAt;
      return;
    }

    // Past the most kept by name, a principal is still counted, as its account is.
    if (this.principals.size >= MAX_LOG_PRINCIPALS * 20) {
      return;
    }

    this.principals.set(record.requester, {
      principal: record.requester,
      accountId: getAccountOfPrincipal(record.requester) || undefined,
      reads: 1,
      bytes: record.bytesSent,
      firstAt: at,
      lastAt: at,
    });
  }

  private countsOf(kind: S3RequesterKind): AccessLogCounts {
    return {
      reads: this.counts[kind].reads,
      bytes: this.counts[kind].bytes,
      objects: this.objects[kind].size,
    };
  }

  // What the files read say, as a case keeps it.
  public toRead(data: {
    now: Date;
    logLocation: string;
    windowStart: string;
    windowEnd: string;
    isComplete: boolean;
    stoppedBecause?: ExposureLogStop | undefined;
    readThrough?: string | undefined;
  }): ExposureLogRead {
    return {
      source: ExposureLogSource.S3ServerAccessLogs,
      status: ExposureLogReadStatus.Read,
      readAt: data.now.toISOString(),
      windowStart: data.windowStart,
      windowEnd: data.windowEnd,
      logLocation: data.logLocation,
      logFilesRead: this.filesRead,
      isComplete: data.isComplete,
      stoppedBecause: data.isComplete ? undefined : data.stoppedBecause,
      readThrough: data.isComplete ? undefined : data.readThrough,
      anonymous: {
        ...this.countsOf(S3RequesterKind.Anonymous),
        addresses: this.addresses.size,
      },
      outside: {
        ...this.countsOf(S3RequesterKind.Outside),
        accounts: this.accounts.size,
      },
      unknown: {
        ...this.countsOf(S3RequesterKind.Unknown),
        requesters: this.requesters.size,
      },
      services: this.countsOf(S3RequesterKind.AwsService),
      own: this.countsOf(S3RequesterKind.Own),
      listingsFromOutside: this.listings,
      isObjectCountCapped: this.isCapped,
      outsidePrincipals: [...this.principals.values()]
        .sort((a: ExposureLogPrincipal, b: ExposureLogPrincipal): number => {
          return b.reads - a.reads || (a.principal < b.principal ? -1 : 1);
        })
        .slice(0, MAX_LOG_PRINCIPALS),
    };
  }
}

/*
 * ---------------------------------------------------------------------------
 * A read, as a case keeps it and the server reads it back
 * ---------------------------------------------------------------------------
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function text(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value
    ? value.slice(0, maxLength)
    : undefined;
}

function readCounts(value: unknown): AccessLogCounts {
  const counts: Record<string, unknown> = isRecord(value) ? value : {};

  return {
    reads: count(counts["reads"]),
    bytes: count(counts["bytes"]),
    objects: count(counts["objects"]),
  };
}

function oneOf<T extends string>(
  value: unknown,
  values: ReadonlyArray<T>,
): T | undefined {
  return typeof value === "string" &&
    (values as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : undefined;
}

// A read as a case keeps it, or null: none, or one this build cannot read.
export function readExposureLogRead(value: unknown): ExposureLogRead | null {
  if (!isRecord(value)) {
    return null;
  }

  const status: ExposureLogReadStatus | undefined = oneOf(
    value["status"],
    Object.values(ExposureLogReadStatus),
  );
  const readAt: string | undefined = text(value["readAt"], 40);

  if (!status || !readAt) {
    return null;
  }

  const anonymous: Record<string, unknown> = isRecord(value["anonymous"])
    ? value["anonymous"]
    : {};
  const outside: Record<string, unknown> = isRecord(value["outside"])
    ? value["outside"]
    : {};
  const unknown: Record<string, unknown> = isRecord(value["unknown"])
    ? value["unknown"]
    : {};

  return {
    source: ExposureLogSource.S3ServerAccessLogs,
    status,
    reason: oneOf(value["reason"], Object.values(ExposureLogUnreadReason)),
    readAt,
    windowStart: text(value["windowStart"], 40),
    windowEnd: text(value["windowEnd"], 40),
    logLocation: text(value["logLocation"], 1100),
    logFilesRead: count(value["logFilesRead"]),
    isComplete: value["isComplete"] === true,
    stoppedBecause: oneOf(
      value["stoppedBecause"],
      Object.values(ExposureLogStop),
    ),
    readThrough: text(value["readThrough"], 40),
    anonymous: {
      ...readCounts(anonymous),
      addresses: count(anonymous["addresses"]),
    },
    outside: { ...readCounts(outside), accounts: count(outside["accounts"]) },
    unknown: {
      ...readCounts(unknown),
      requesters: count(unknown["requesters"]),
    },
    services: readCounts(value["services"]),
    own: readCounts(value["own"]),
    listingsFromOutside: count(value["listingsFromOutside"]),
    isObjectCountCapped: value["isObjectCountCapped"] === true,
    outsidePrincipals: (Array.isArray(value["outsidePrincipals"])
      ? value["outsidePrincipals"]
      : []
    )
      .filter(isRecord)
      .slice(0, MAX_LOG_PRINCIPALS)
      .map((principal: Record<string, unknown>): ExposureLogPrincipal => {
        return {
          principal: text(principal["principal"], 2048) || "",
          accountId: text(principal["accountId"], 12),
          reads: count(principal["reads"]),
          bytes: count(principal["bytes"]),
          firstAt: text(principal["firstAt"], 40) || "",
          lastAt: text(principal["lastAt"], 40) || "",
        };
      })
      .filter((principal: ExposureLogPrincipal): boolean => {
        return Boolean(principal.principal);
      }),
  };
}

// The same read with nobody named: for a reader who may not read who can reach the store.
export function withoutLogPrincipals(read: ExposureLogRead): ExposureLogRead {
  return { ...read, outsidePrincipals: [] };
}

/*
 * Whether a read was made for the window as it is now: the window can
 * change after it - a reopened exposure, a change found in the cloud's log.
 */
export function isLogReadForWindow(data: {
  read: ExposureLogRead;
  windowStart: string | undefined;
  windowEnd: string | undefined;
}): boolean {
  return (
    data.read.windowStart === data.windowStart &&
    (data.read.windowEnd === data.windowEnd ||
      // A window still open when it was read reaches the moment it was read.
      (data.windowEnd === undefined &&
        data.read.windowEnd !== undefined &&
        data.read.windowEnd <= data.read.readAt))
  );
}
