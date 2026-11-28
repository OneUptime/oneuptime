import {
  AccessLogTally,
  ExposureLogRead,
  ExposureLogStop,
  ExposureLogUnreadReason,
  getS3LogListing,
  getS3LogObjectTime,
  getUnreadLogs,
  isS3LogObjectPastWindow,
  S3LoggingTarget,
  S3LogListing,
} from "../../../../../Types/DataSecurity/AccessLogReads";
import Dictionary from "../../../../../Types/Dictionary";
import ObjectID from "../../../../../Types/ObjectID";
import {
  AwsCredentials,
  AwsRestResponse,
  readXmlTag,
  readXmlTags,
  sendAwsRestRequest,
} from "../../../CloudConnection/Aws/AwsApi";
import AwsCloudConnector from "../../../CloudConnection/Aws/AwsCloudConnector";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
} from "../../../CloudConnection/CloudConnectorTypes";
import DataSourceHttpFetch from "../../../DataSource/HttpFetch";
import { isAccountId } from "./AwsPolicyGrammar";

/*
 * AN S3 BUCKET'S SERVER ACCESS LOGS, READ FOR AN EXPOSURE'S WINDOW (#10951).
 *
 * Where a bucket logs its requests, S3 writes the logs into another bucket
 * of the same account and Region, under a prefix its logging configuration
 * names. With the connection's "content" access - s3:ListBucket and
 * s3:GetObject on every bucket - OneUptime reads them:
 *
 *   1. the bucket's logging configuration (GetBucketLogging, which the
 *      "configuration" access holds): where its logs are, and how their
 *      objects are named - straight under the prefix, or partitioned by
 *      account, Region, bucket and day;
 *   2. the log objects written from an hour before the window to a day
 *      after it (S3 delivers a record within hours of the request), in
 *      the order S3 names them - each listing starts where the window does;
 *   3. each object's lines, added up by who made each read
 *      (AccessLogTally): only the store's own lines, only in the window.
 *
 * Bounded: a time limit, a number of files, a number of bytes, each read
 * of a few at once. A read that stops early says where it stopped, and the
 * counts it has are counts "so far". Nothing it reads is kept but counts
 * and the outside principals: no key, no address, no line.
 */

// How a read is bounded.
export interface S3LogReadLimits {
  // The moment it stops reading, in milliseconds since the epoch.
  deadlineAt: number;
  maxFiles: number;
  maxBytes: number;
  maxBytesPerFile: number;
  // Files read at once.
  concurrency: number;
}

// The same limits with a length of time, the deadline set when the read starts.
export type S3LogReadLimitsInTime = Omit<S3LogReadLimits, "deadlineAt"> & {
  timeInMs: number;
};

// A person waits for the read: it stops within a request's time.
export const PERSON_LOG_READ_LIMITS: S3LogReadLimitsInTime = {
  timeInMs: 25 * 1000,
  maxFiles: 2000,
  maxBytes: 256 * 1024 * 1024,
  maxBytesPerFile: 16 * 1024 * 1024,
  concurrency: 8,
};

// A worker reads it as the case opens: longer, and further.
export const JOB_LOG_READ_LIMITS: S3LogReadLimitsInTime = {
  // Inside the job's five minutes, with the write-up after it.
  timeInMs: 150 * 1000,
  maxFiles: 20000,
  maxBytes: 2 * 1024 * 1024 * 1024,
  maxBytesPerFile: 16 * 1024 * 1024,
  concurrency: 8,
};

const LIST_PAGE_SIZE: number = 1000;
const S3_TITLE: string = "AWS S3";

// What a read needs of S3: its logging configuration, listings and objects.
export interface S3LogReader {
  readLoggingTarget(): Promise<S3LoggingTarget | null>;
  listLogObjects(data: {
    bucket: string;
    prefix: string;
    startAfter?: string | undefined;
    nextToken?: string | undefined;
  }): Promise<{ keys: Array<string>; nextToken?: string | undefined }>;
  readLogObject(data: {
    bucket: string;
    key: string;
    maxBytes: number;
  }): Promise<Uint8Array>;
}

// Where a bucket's logs go, from its logging configuration, or null when it logs nothing.
export function readS3LoggingTarget(xml: string): S3LoggingTarget | null {
  if (!xml.includes("<LoggingEnabled")) {
    return null;
  }

  const enabled: string = readXmlTags(xml, "LoggingEnabled")[0] || "";
  const bucket: string = readXmlTag(enabled, "TargetBucket");

  if (!bucket) {
    return null;
  }

  return {
    bucket,
    prefix: readXmlTag(enabled, "TargetPrefix"),
    isPartitioned: enabled.includes("<PartitionedPrefix"),
  };
}

function decodeS3Key(encoded: string): string {
  try {
    return decodeURIComponent(encoded.split("+").join(" "));
  } catch {
    return encoded;
  }
}

/*
 * The reader, for one source bucket: its logging configuration, and the
 * bucket its logs are in - both of the bucket's account and Region, each
 * request signed with the connection's role (a member account's through
 * its own role).
 */
export function createAwsS3LogReader(
  settings: CloudConnectionSettings,
  options: {
    connectionId: ObjectID;
    sourceBucket: string;
    region: string;
    accountNumber: string;
    transport?: CloudConnectorTransport | undefined;
    budget?: CloudReadBudget | undefined;
    requestTimeoutInMs?: number | undefined;
  },
): S3LogReader {
  const connector: AwsCloudConnector = new AwsCloudConnector();
  const accountSettings: CloudConnectionSettings =
    connector.isOrganization(settings) && isAccountId(options.accountNumber)
      ? connector.settingsForAccount(settings, options.accountNumber)
      : settings;
  const transport: CloudConnectorTransport =
    options.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
  const send: (data: {
    path: string;
    query?: Dictionary<string> | undefined;
    maxBodyBytes?: number | undefined;
    keepBytes?: boolean | undefined;
    step: string;
  }) => Promise<AwsRestResponse> = async (data: {
    path: string;
    query?: Dictionary<string> | undefined;
    maxBodyBytes?: number | undefined;
    keepBytes?: boolean | undefined;
    step: string;
  }): Promise<AwsRestResponse> => {
    const credentials: AwsCredentials = await connector.getCredentials(
      accountSettings,
      {
        transport,
        requestTimeoutInMs: options.requestTimeoutInMs,
        connectionId: options.connectionId.toString(),
        budget: options.budget,
      },
    );

    return await sendAwsRestRequest({
      transport,
      credentials,
      service: "s3",
      region: options.region,
      path: data.path,
      query: data.query,
      maxBodyBytes: data.maxBodyBytes,
      keepBytes: data.keepBytes,
      step: data.step,
      providerTitle: S3_TITLE,
      timeoutInMs: options.requestTimeoutInMs,
      budget: options.budget,
    });
  };

  return {
    readLoggingTarget: async (): Promise<S3LoggingTarget | null> => {
      const answer: AwsRestResponse = await send({
        path: `/${options.sourceBucket}`,
        query: { logging: "" },
        step: "bucket logging request",
      });

      return readS3LoggingTarget(answer.text);
    },

    listLogObjects: async (data: {
      bucket: string;
      prefix: string;
      startAfter?: string | undefined;
      nextToken?: string | undefined;
    }): Promise<{ keys: Array<string>; nextToken?: string | undefined }> => {
      const query: Dictionary<string> = {
        "list-type": "2",
        "max-keys": String(LIST_PAGE_SIZE),
        "encoding-type": "url",
      };

      if (data.prefix) {
        query["prefix"] = data.prefix;
      }

      if (data.nextToken) {
        query["continuation-token"] = data.nextToken;
      } else if (data.startAfter) {
        query["start-after"] = data.startAfter;
      }

      const answer: AwsRestResponse = await send({
        path: `/${data.bucket}`,
        query,
        step: "log object list request",
      });
      const encoded: boolean =
        readXmlTag(answer.text, "EncodingType") === "url";
      const keys: Array<string> = readXmlTags(answer.text, "Contents")
        .map((item: string): string => {
          const written: string = readXmlTag(item, "Key");

          return encoded ? decodeS3Key(written) : written;
        })
        .filter(Boolean);
      const next: string = readXmlTag(answer.text, "NextContinuationToken");
      const truncated: boolean =
        readXmlTag(answer.text, "IsTruncated").toLowerCase() === "true";

      return { keys, nextToken: truncated && next ? next : undefined };
    },

    readLogObject: async (data: {
      bucket: string;
      key: string;
      maxBytes: number;
    }): Promise<Uint8Array> => {
      // A URL's "." and ".." parts are folded away before it is sent: such a key is not read.
      if (
        data.key.split("/").some((segment: string): boolean => {
          return segment === "." || segment === "..";
        })
      ) {
        return new Uint8Array(0);
      }

      const answer: AwsRestResponse = await send({
        path: `/${data.bucket}/${data.key}`,
        maxBodyBytes: data.maxBytes,
        keepBytes: true,
        step: "log object read request",
      });

      return answer.bytes;
    },
  };
}

/*
 * The window's reads, from the store's logs: where its logs are, the log
 * objects that hold the window, each read and added up, as far as the
 * limits let it. Never throws for what S3 answers: a refusal is a read
 * that could not be made (LogsUnreadable), or that stopped (ReadFailed).
 */
export async function readS3AccessLogsForWindow(data: {
  reader: S3LogReader;
  sourceBucket: string;
  sourceAccountId: string;
  sourceRegion: string;
  windowStart: Date;
  windowEnd: Date;
  ownAccountIds: ReadonlySet<string>;
  limits: S3LogReadLimits;
  now: () => Date;
}): Promise<ExposureLogRead> {
  const windowStart: string = data.windowStart.toISOString();
  const windowEnd: string = data.windowEnd.toISOString();
  let target: S3LoggingTarget | null;

  try {
    target = await data.reader.readLoggingTarget();
  } catch {
    return getUnreadLogs({
      reason: ExposureLogUnreadReason.LoggingOff,
      now: data.now(),
      windowStart,
      windowEnd,
    });
  }

  if (!target) {
    return getUnreadLogs({
      reason: ExposureLogUnreadReason.LoggingOff,
      now: data.now(),
      windowStart,
      windowEnd,
    });
  }

  const logLocation: string = `s3://${target.bucket}/${target.prefix}`;
  const tally: AccessLogTally = new AccessLogTally({
    bucket: data.sourceBucket,
    windowStart: data.windowStart,
    windowEnd: data.windowEnd,
    ownAccountIds: data.ownAccountIds,
  });
  const listings: Array<S3LogListing> = getS3LogListing({
    target,
    sourceAccountId: data.sourceAccountId,
    sourceRegion: data.sourceRegion,
    sourceBucket: data.sourceBucket,
    windowStart: data.windowStart,
    windowEnd: data.windowEnd,
  });
  const decoder: TextDecoder = new TextDecoder("utf-8");
  let stopped: ExposureLogStop | undefined = undefined;
  let readThrough: string | undefined = undefined;
  let bytesRead: number = 0;
  let isListed: boolean = false;

  const stopFor: () => ExposureLogStop | undefined = ():
    | ExposureLogStop
    | undefined => {
    if (data.now().getTime() >= data.limits.deadlineAt) {
      return ExposureLogStop.TimeLimit;
    }

    if (tally.filesRead >= data.limits.maxFiles) {
      return ExposureLogStop.FileLimit;
    }

    if (bytesRead >= data.limits.maxBytes) {
      return ExposureLogStop.ByteLimit;
    }

    return undefined;
  };

  listing: for (const each of listings) {
    let nextToken: string | undefined = undefined;
    let isFirstPage: boolean = true;

    do {
      stopped = stopFor();

      if (stopped) {
        break listing;
      }

      let page: { keys: Array<string>; nextToken?: string | undefined };

      try {
        page = await data.reader.listLogObjects({
          bucket: target.bucket,
          prefix: each.prefix,
          startAfter: isFirstPage ? each.startAfter : undefined,
          nextToken,
        });
      } catch {
        if (!isListed) {
          return getUnreadLogs({
            reason: ExposureLogUnreadReason.LogsUnreadable,
            now: data.now(),
            logLocation,
            windowStart,
            windowEnd,
          });
        }

        stopped = ExposureLogStop.ReadFailed;
        break listing;
      }

      isListed = true;
      isFirstPage = false;

      // Only what S3 names as a log object; past the window and its slack, the read is done.
      const due: Array<string> = [];
      let isPastWindow: boolean = false;

      for (const key of page.keys) {
        if (!getS3LogObjectTime(key)) {
          continue;
        }

        if (isS3LogObjectPastWindow(key, data.windowEnd)) {
          isPastWindow = true;
          break;
        }

        due.push(key);
      }

      // A few files at once, as many as the file limit leaves: the next batch starts after this one.
      let index: number = 0;

      while (index < due.length) {
        stopped = stopFor();

        if (stopped) {
          break listing;
        }

        const batch: Array<string> = due.slice(
          index,
          index +
            Math.max(
              1,
              Math.min(
                data.limits.concurrency,
                data.limits.maxFiles - tally.filesRead,
              ),
            ),
        );

        index += batch.length;
        let texts: Array<Uint8Array>;

        try {
          texts = await Promise.all(
            batch.map((key: string): Promise<Uint8Array> => {
              return data.reader.readLogObject({
                bucket: target!.bucket,
                key,
                maxBytes: data.limits.maxBytesPerFile,
              });
            }),
          );
        } catch {
          stopped = ExposureLogStop.ReadFailed;
          break listing;
        }

        for (const bytes of texts) {
          bytesRead += bytes.length;
          tally.addFile(decoder.decode(bytes));
        }

        const last: Date | null = getS3LogObjectTime(
          batch[batch.length - 1] || "",
        );

        readThrough = last ? last.toISOString() : readThrough;
      }

      if (isPastWindow) {
        break listing;
      }

      nextToken = page.nextToken;
    } while (nextToken);
  }

  return tally.toRead({
    now: data.now(),
    logLocation,
    windowStart,
    windowEnd,
    isComplete: !stopped,
    stoppedBecause: stopped,
    readThrough,
  });
}
