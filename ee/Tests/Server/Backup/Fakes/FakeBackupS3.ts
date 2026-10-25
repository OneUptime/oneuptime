import { createHash, createHmac } from "crypto";
import { Readable } from "stream";
import Dictionary from "Common/Types/Dictionary";
import {
  BackupHttpRequest,
  BackupHttpResponse,
  BackupHttpTransport,
} from "../../../../Server/Backup/Storage/BackupHttp";

/*
 * A FAITHFUL FAKE OF THE S3 API, for the backups' S3 storage: every call
 * the backups make - PutObject, the multipart upload (Create, UploadPart,
 * Complete, Abort), GetObject, HeadObject, ListObjects (version 1, with a
 * prefix, a delimiter and markers) and DeleteObject - answered the way
 * Amazon S3 (and MinIO, R2, B2...) answers it, after the checks S3 makes,
 * with its own code and never the signer under test:
 *
 *   - the bucket from the host (bucket.s3.region.amazonaws.com) or the
 *     path (endpoint/bucket/key);
 *   - the Signature Version 4 Authorization header, recomputed here from
 *     the request as it arrived: the key must be one it knows
 *     (InvalidAccessKeyId), the scope must name the bucket's region
 *     (AuthorizationHeaderMalformed, with <Region>), the signature must
 *     match (SignatureDoesNotMatch), every x-amz-* header must be signed;
 *   - x-amz-content-sha256 must be the SHA-256 of the body that arrived;
 *   - the bucket must exist (NoSuchBucket), and the key's policy must allow
 *     the operation under the prefix (AccessDenied);
 *   - a multipart upload's parts: at least 5 MiB but the last
 *     (EntityTooSmall), named by the ETags UploadPart answered
 *     (InvalidPart), in order (InvalidPartOrder) - and, as Cloudflare R2
 *     requires, all of one size but the last (requireEqualParts).
 *
 * Errors are the XML documents S3 answers with. Not a test file itself.
 */

export type FakeS3Operation =
  | "PutObject"
  | "CreateMultipartUpload"
  | "UploadPart"
  | "CompleteMultipartUpload"
  | "AbortMultipartUpload"
  | "GetObject"
  | "HeadObject"
  | "ListObjects"
  | "DeleteObject";

export interface FakeS3StoredObject {
  body: Buffer;
  contentType: string;
  lastModified: Date;
  headers: Dictionary<string>;
}

export interface FakeS3Upload {
  bucket: string;
  key: string;
  parts: Map<number, { etag: string; body: Buffer }>;
  headers: Dictionary<string>;
}

export interface FakeS3BucketState {
  region: string;
  // Prefixes the key may use, per operation ("" for anywhere).
  allowedPrefixes: Array<string>;
  deniedOperations: Array<FakeS3Operation>;
  objects: Map<string, FakeS3StoredObject>;
}

export interface FakeBackupS3Options {
  credentials: Dictionary<string>;
  buckets: Dictionary<{
    region: string;
    allowedPrefixes?: Array<string> | undefined;
    deniedOperations?: Array<FakeS3Operation> | undefined;
  }>;
  // Cloudflare R2's rule: every part but the last of one size.
  requireEqualParts?: boolean | undefined;
  // The most keys one listing page holds (S3's is 1000).
  maxKeysPerPage?: number | undefined;
  now?: (() => Date) | undefined;
}

export interface FakeS3RecordedRequest {
  method: string;
  url: string;
  operation: FakeS3Operation | "Unknown";
  headers: Dictionary<string>;
  bodyLength: number;
}

export interface FakeBackupS3 {
  transport: BackupHttpTransport;
  buckets: Map<string, FakeS3BucketState>;
  uploads: Map<string, FakeS3Upload>;
  requests: Array<FakeS3RecordedRequest>;
  // Answers the next n requests (of an operation, when named) with this status and code.
  failNext: (data: {
    count: number;
    status: number;
    code: string;
    operation?: FakeS3Operation | undefined;
  }) => void;
  // Answers the next n requests with no answer at all.
  dropNext: (count: number) => void;
  // Answers CompleteMultipartUpload with 200 and an <Error> body, as S3 may.
  failCompleteWithOkStatus: (code: string) => void;
  object: (bucket: string, key: string) => FakeS3StoredObject | undefined;
  keys: (bucket: string) => Array<string>;
}

export const FAKE_S3_MIN_PART_SIZE: number = 5 * 1024 * 1024;

const AMAZON_SUFFIX: string = ".amazonaws.com";

function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function md5Hex(value: Buffer): string {
  return createHash("md5").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function escapeXml(value: string): string {
  return value
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;");
}

function lowerHeaders(headers: Dictionary<string>): Dictionary<string> {
  const lowered: Dictionary<string> = {};

  for (const name of Object.keys(headers || {})) {
    lowered[name.toLowerCase()] = String(headers[name]);
  }

  return lowered;
}

function answer(
  status: number,
  body: Buffer | string = "",
  headers: Dictionary<string> = {},
): BackupHttpResponse {
  const bytes: Buffer = Buffer.isBuffer(body)
    ? body
    : Buffer.from(body, "utf8");

  return {
    statusCode: status,
    headers: { "content-length": String(bytes.length), ...headers },
    body: Readable.from(bytes.length > 0 ? [bytes] : []),
  };
}

function xmlError(
  status: number,
  code: string,
  extra: string = "",
  headers: Dictionary<string> = {},
): BackupHttpResponse {
  return answer(
    status,
    `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${code} from the fake S3</Message>${extra}<RequestId>FAKE</RequestId></Error>`,
    { "content-type": "application/xml", ...headers },
  );
}

// The canonical query S3 signs: every parameter, encoded, sorted, "name=" for one without a value.
function canonicalQuery(url: URL): string {
  return Array.from(url.searchParams.entries())
    .map(([name, value]: [string, string]): string => {
      const encode: (text: string) => string = (text: string): string => {
        return encodeURIComponent(text)
          .split("!")
          .join("%21")
          .split("'")
          .join("%27")
          .split("(")
          .join("%28")
          .split(")")
          .join("%29")
          .split("*")
          .join("%2A");
      };

      return `${encode(name)}=${encode(value)}`;
    })
    .sort()
    .join("&");
}

function expectedSignature(data: {
  method: string;
  url: URL;
  headers: Dictionary<string>;
  signedHeaders: Array<string>;
  payloadHash: string;
  secretAccessKey: string;
  dateStamp: string;
  region: string;
  amzDate: string;
}): string {
  const canonicalHeaders: string = data.signedHeaders
    .map((name: string): string => {
      const value: string =
        name === "host" ? data.url.host : data.headers[name] || "";
      return `${name}:${value.trim().split(/\s+/).join(" ")}\n`;
    })
    .join("");

  const canonicalRequest: string = [
    data.method,
    data.url.pathname,
    canonicalQuery(data.url),
    canonicalHeaders,
    data.signedHeaders.join(";"),
    data.payloadHash,
  ].join("\n");

  const scope: string = `${data.dateStamp}/${data.region}/s3/aws4_request`;
  const stringToSign: string = [
    "AWS4-HMAC-SHA256",
    data.amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey: Buffer = hmac(
    hmac(
      hmac(hmac(`AWS4${data.secretAccessKey}`, data.dateStamp), data.region),
      "s3",
    ),
    "aws4_request",
  );

  return createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");
}

function operationOf(
  method: string,
  url: URL,
  key: string,
): FakeS3Operation | "Unknown" {
  const query: URLSearchParams = url.searchParams;

  if (!key) {
    return method === "GET" ? "ListObjects" : "Unknown";
  }

  switch (method) {
    case "PUT":
      return query.has("partNumber") && query.has("uploadId")
        ? "UploadPart"
        : "PutObject";
    case "POST":
      if (query.has("uploads")) {
        return "CreateMultipartUpload";
      }

      return query.has("uploadId") ? "CompleteMultipartUpload" : "Unknown";
    case "DELETE":
      return query.has("uploadId") ? "AbortMultipartUpload" : "DeleteObject";
    case "GET":
      return "GetObject";
    case "HEAD":
      return "HeadObject";
    default:
      return "Unknown";
  }
}

function readTag(xml: string, tag: string): Array<string> {
  const values: Array<string> = [];
  const open: string = `<${tag}>`;
  const close: string = `</${tag}>`;
  let from: number = 0;

  for (;;) {
    const start: number = xml.indexOf(open, from);

    if (start < 0) {
      return values;
    }

    const end: number = xml.indexOf(close, start + open.length);

    if (end < 0) {
      return values;
    }

    values.push(xml.slice(start + open.length, end));
    from = end + close.length;
  }
}

export function createFakeBackupS3(options: FakeBackupS3Options): FakeBackupS3 {
  const now: () => Date =
    options.now ||
    ((): Date => {
      return new Date();
    });
  const buckets: Map<string, FakeS3BucketState> = new Map<
    string,
    FakeS3BucketState
  >();

  for (const name of Object.keys(options.buckets)) {
    const bucket: FakeBackupS3Options["buckets"][string] =
      options.buckets[name]!;

    buckets.set(name, {
      region: bucket.region,
      allowedPrefixes: bucket.allowedPrefixes || [""],
      deniedOperations: bucket.deniedOperations || [],
      objects: new Map<string, FakeS3StoredObject>(),
    });
  }

  const uploads: Map<string, FakeS3Upload> = new Map<string, FakeS3Upload>();
  const requests: Array<FakeS3RecordedRequest> = [];
  const failures: Array<
    | {
        kind: "status";
        status: number;
        code: string;
        operation?: FakeS3Operation | undefined;
      }
    | { kind: "drop" }
  > = [];
  let completeFailureCode: string | null = null;
  let uploadCounter: number = 0;

  const handle: (
    request: BackupHttpRequest,
    url: URL,
    operation: FakeS3Operation | "Unknown",
    bucketName: string,
    key: string,
  ) => BackupHttpResponse = (
    request: BackupHttpRequest,
    url: URL,
    operation: FakeS3Operation | "Unknown",
    bucketName: string,
    key: string,
  ): BackupHttpResponse => {
    const headers: Dictionary<string> = lowerHeaders(request.headers);
    const body: Buffer = request.body || Buffer.alloc(0);
    const authorization: string = headers["authorization"] || "";

    if (!authorization.startsWith("AWS4-HMAC-SHA256 ")) {
      return xmlError(403, "AccessDenied");
    }

    const fields: Dictionary<string> = {};

    for (const part of authorization
      .slice("AWS4-HMAC-SHA256 ".length)
      .split(", ")) {
      const equals: number = part.indexOf("=");
      fields[part.slice(0, equals)] = part.slice(equals + 1);
    }

    const [accessKeyId, dateStamp, region, service, terminator] = (
      fields["Credential"] || ""
    ).split("/");
    const secretAccessKey: string | undefined =
      options.credentials[accessKeyId || ""];

    if (!secretAccessKey) {
      return xmlError(403, "InvalidAccessKeyId");
    }

    if (service !== "s3" || terminator !== "aws4_request") {
      return xmlError(400, "AuthorizationHeaderMalformed");
    }

    const bucket: FakeS3BucketState | undefined = buckets.get(bucketName);

    if (bucket && region !== bucket.region) {
      return xmlError(
        400,
        "AuthorizationHeaderMalformed",
        `<Region>${bucket.region}</Region>`,
        { "x-amz-bucket-region": bucket.region },
      );
    }

    const amzDate: string = headers["x-amz-date"] || "";
    const payloadHash: string = headers["x-amz-content-sha256"] || "";

    if (!amzDate.startsWith(dateStamp || "-")) {
      return xmlError(403, "SignatureDoesNotMatch");
    }

    const signedHeaders: Array<string> = (fields["SignedHeaders"] || "").split(
      ";",
    );

    if (
      expectedSignature({
        method: request.method,
        url,
        headers,
        signedHeaders,
        payloadHash,
        secretAccessKey,
        dateStamp: dateStamp || "",
        region: region || "",
        amzDate,
      }) !== fields["Signature"]
    ) {
      return xmlError(403, "SignatureDoesNotMatch");
    }

    for (const name of Object.keys(headers)) {
      if (name.startsWith("x-amz-") && !signedHeaders.includes(name)) {
        return xmlError(403, "AccessDenied");
      }
    }

    if (payloadHash !== sha256Hex(body)) {
      return xmlError(400, "XAmzContentSHA256Mismatch");
    }

    if (!bucket) {
      return xmlError(
        404,
        "NoSuchBucket",
        `<BucketName>${bucketName}</BucketName>`,
      );
    }

    const prefixOfRequest: string =
      operation === "ListObjects" ? url.searchParams.get("prefix") || "" : key;

    if (
      operation === "Unknown" ||
      bucket.deniedOperations.includes(operation) ||
      !bucket.allowedPrefixes.some((prefix: string): boolean => {
        return prefixOfRequest.startsWith(prefix);
      })
    ) {
      return xmlError(403, "AccessDenied");
    }

    switch (operation) {
      case "PutObject": {
        bucket.objects.set(key, {
          body: Buffer.from(body),
          contentType: headers["content-type"] || "",
          lastModified: now(),
          headers,
        });

        return answer(200, "", { etag: `"${md5Hex(body)}"` });
      }

      case "CreateMultipartUpload": {
        const uploadId: string = `upload-${++uploadCounter}`;

        uploads.set(uploadId, {
          bucket: bucketName,
          key,
          parts: new Map<number, { etag: string; body: Buffer }>(),
          headers,
        });

        return answer(
          200,
          `<?xml version="1.0" encoding="UTF-8"?>\n<InitiateMultipartUploadResult><Bucket>${bucketName}</Bucket><Key>${escapeXml(key)}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`,
        );
      }

      case "UploadPart": {
        const upload: FakeS3Upload | undefined = uploads.get(
          url.searchParams.get("uploadId") || "",
        );
        const partNumber: number = Number(url.searchParams.get("partNumber"));

        if (!upload || upload.key !== key || upload.bucket !== bucketName) {
          return xmlError(404, "NoSuchUpload");
        }

        if (
          !Number.isInteger(partNumber) ||
          partNumber < 1 ||
          partNumber > 10000
        ) {
          return xmlError(400, "InvalidArgument");
        }

        const etag: string = `"${md5Hex(body)}"`;
        upload.parts.set(partNumber, { etag, body: Buffer.from(body) });

        return answer(200, "", { etag });
      }

      case "CompleteMultipartUpload": {
        const uploadId: string = url.searchParams.get("uploadId") || "";
        const upload: FakeS3Upload | undefined = uploads.get(uploadId);

        if (!upload || upload.key !== key) {
          return xmlError(404, "NoSuchUpload");
        }

        const xml: string = body.toString("utf8");
        const partBlocks: Array<string> = readTag(xml, "Part");
        const chosen: Array<{ partNumber: number; body: Buffer }> = [];
        let previous: number = 0;

        for (const block of partBlocks) {
          const partNumber: number = Number(readTag(block, "PartNumber")[0]);
          const etag: string = (readTag(block, "ETag")[0] || "")
            .split("&quot;")
            .join('"');
          const stored: { etag: string; body: Buffer } | undefined =
            upload.parts.get(partNumber);

          if (!stored || stored.etag !== etag) {
            return xmlError(400, "InvalidPart");
          }

          if (partNumber <= previous) {
            return xmlError(400, "InvalidPartOrder");
          }

          previous = partNumber;
          chosen.push({ partNumber, body: stored.body });
        }

        if (chosen.length === 0) {
          return xmlError(400, "MalformedXML");
        }

        for (let index: number = 0; index < chosen.length - 1; index++) {
          if (chosen[index]!.body.length < FAKE_S3_MIN_PART_SIZE) {
            return xmlError(400, "EntityTooSmall");
          }

          if (
            options.requireEqualParts &&
            chosen[index]!.body.length !== chosen[0]!.body.length
          ) {
            return xmlError(400, "InvalidPart");
          }
        }

        if (
          options.requireEqualParts &&
          chosen.length > 1 &&
          chosen[chosen.length - 1]!.body.length > chosen[0]!.body.length
        ) {
          return xmlError(400, "InvalidPart");
        }

        if (completeFailureCode) {
          const code: string = completeFailureCode;
          completeFailureCode = null;

          return answer(
            200,
            `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${code} after a 200</Message></Error>`,
          );
        }

        const whole: Buffer = Buffer.concat(
          chosen.map((part: { body: Buffer }): Buffer => {
            return part.body;
          }),
        );

        bucket.objects.set(key, {
          body: whole,
          contentType: upload.headers["content-type"] || "",
          lastModified: now(),
          headers: upload.headers,
        });
        uploads.delete(uploadId);

        return answer(
          200,
          `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUploadResult><Bucket>${bucketName}</Bucket><Key>${escapeXml(key)}</Key><ETag>"${md5Hex(whole)}-${chosen.length}"</ETag></CompleteMultipartUploadResult>`,
        );
      }

      case "AbortMultipartUpload": {
        const uploadId: string = url.searchParams.get("uploadId") || "";

        if (!uploads.has(uploadId)) {
          return xmlError(404, "NoSuchUpload");
        }

        uploads.delete(uploadId);

        return answer(204);
      }

      case "GetObject": {
        const stored: FakeS3StoredObject | undefined = bucket.objects.get(key);

        if (!stored) {
          return xmlError(404, "NoSuchKey");
        }

        return answer(200, stored.body, {
          "content-type": stored.contentType,
          "last-modified": stored.lastModified.toUTCString(),
        });
      }

      case "HeadObject": {
        const stored: FakeS3StoredObject | undefined = bucket.objects.get(key);

        if (!stored) {
          // HEAD answers carry no body.
          return { statusCode: 404, headers: {}, body: Readable.from([]) };
        }

        return {
          statusCode: 200,
          headers: {
            "content-length": String(stored.body.length),
            "content-type": stored.contentType,
            "last-modified": stored.lastModified.toUTCString(),
          },
          body: Readable.from([]),
        };
      }

      case "DeleteObject": {
        // S3 answers 204 whether or not the key was there.
        bucket.objects.delete(key);

        return answer(204);
      }

      case "ListObjects": {
        const prefix: string = url.searchParams.get("prefix") || "";
        const delimiter: string = url.searchParams.get("delimiter") || "";
        const marker: string = url.searchParams.get("marker") || "";
        const maxKeys: number = Math.min(
          Number(url.searchParams.get("max-keys") || 1000),
          options.maxKeysPerPage || 1000,
        );

        const entries: Array<{ key: string; isPrefix: boolean }> = [];
        const seenPrefixes: Set<string> = new Set<string>();

        for (const objectKey of Array.from(bucket.objects.keys()).sort()) {
          if (!objectKey.startsWith(prefix) || objectKey <= marker) {
            continue;
          }

          if (delimiter) {
            const rest: string = objectKey.slice(prefix.length);
            const at: number = rest.indexOf(delimiter);

            if (at >= 0) {
              const commonPrefix: string = `${prefix}${rest.slice(0, at + delimiter.length)}`;

              if (commonPrefix <= marker || seenPrefixes.has(commonPrefix)) {
                continue;
              }

              seenPrefixes.add(commonPrefix);
              entries.push({ key: commonPrefix, isPrefix: true });
              continue;
            }
          }

          entries.push({ key: objectKey, isPrefix: false });
        }

        const page: Array<{ key: string; isPrefix: boolean }> = entries.slice(
          0,
          maxKeys,
        );
        const isTruncated: boolean = entries.length > page.length;
        const last: string = page.length > 0 ? page[page.length - 1]!.key : "";

        const contents: string = page
          .filter((entry: { isPrefix: boolean }): boolean => {
            return !entry.isPrefix;
          })
          .map((entry: { key: string }): string => {
            const stored: FakeS3StoredObject = bucket.objects.get(entry.key)!;

            return `<Contents><Key>${escapeXml(entry.key)}</Key><LastModified>${stored.lastModified.toISOString()}</LastModified><ETag>"${md5Hex(stored.body)}"</ETag><Size>${stored.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
          })
          .join("");
        const commonPrefixes: string = page
          .filter((entry: { isPrefix: boolean }): boolean => {
            return entry.isPrefix;
          })
          .map((entry: { key: string }): string => {
            return `<CommonPrefixes><Prefix>${escapeXml(entry.key)}</Prefix></CommonPrefixes>`;
          })
          .join("");

        // S3 names a NextMarker only for a listing with a delimiter.
        const nextMarker: string =
          isTruncated && delimiter
            ? `<NextMarker>${escapeXml(last)}</NextMarker>`
            : "";

        return answer(
          200,
          `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult><Name>${bucketName}</Name><Prefix>${escapeXml(prefix)}</Prefix><Marker>${escapeXml(marker)}</Marker>${nextMarker}<MaxKeys>${maxKeys}</MaxKeys>${delimiter ? `<Delimiter>${escapeXml(delimiter)}</Delimiter>` : ""}<IsTruncated>${isTruncated ? "true" : "false"}</IsTruncated>${contents}${commonPrefixes}</ListBucketResult>`,
          { "content-type": "application/xml" },
        );
      }

      default:
        return xmlError(400, "InvalidRequest");
    }
  };

  const transport: BackupHttpTransport = async (
    request: BackupHttpRequest,
  ): Promise<BackupHttpResponse> => {
    const url: URL = new URL(request.url);
    const isAmazon: boolean = url.hostname.endsWith(AMAZON_SUFFIX);
    const isVirtualHosted: boolean =
      isAmazon &&
      !url.hostname.startsWith("s3.") &&
      !url.hostname.startsWith("s3-");
    const decodedPath: string = decodeURIComponent(url.pathname);
    let bucketName: string;
    let key: string;

    if (isVirtualHosted) {
      bucketName = url.hostname.split(".")[0] || "";
      key = decodedPath.slice(1);
    } else {
      const parts: Array<string> = decodedPath.slice(1).split("/");
      bucketName = parts.shift() || "";
      key = parts.join("/");
    }

    const operation: FakeS3Operation | "Unknown" = operationOf(
      request.method,
      url,
      key,
    );

    requests.push({
      method: request.method,
      url: request.url,
      operation,
      headers: lowerHeaders(request.headers),
      bodyLength: request.body ? request.body.length : 0,
    });

    const index: number = failures.findIndex(
      (
        failure:
          | { kind: "status"; operation?: FakeS3Operation | undefined }
          | { kind: "drop" },
      ): boolean => {
        return (
          failure.kind === "drop" ||
          !failure.operation ||
          failure.operation === operation
        );
      },
    );

    if (index >= 0) {
      const failure: (typeof failures)[number] = failures.splice(index, 1)[0]!;

      if (failure.kind === "drop") {
        const error: NodeJS.ErrnoException = new Error(
          "connect ECONNREFUSED 10.0.0.5:9000",
        );
        error.code = "ECONNREFUSED";
        throw error;
      }

      return xmlError(failure.status, failure.code);
    }

    const response: BackupHttpResponse = handle(
      request,
      url,
      operation,
      bucketName,
      key,
    );

    // A HEAD answer has no body, an error's included: its headers say what they can.
    if (request.method === "HEAD" && response.statusCode >= 300) {
      response.body.resume();

      return {
        statusCode: response.statusCode,
        headers: { ...response.headers, "content-length": "0" },
        body: Readable.from([]),
      };
    }

    return response;
  };

  return {
    transport,
    buckets,
    uploads,
    requests,
    failNext: (data: {
      count: number;
      status: number;
      code: string;
      operation?: FakeS3Operation | undefined;
    }): void => {
      for (let index: number = 0; index < data.count; index++) {
        failures.push({
          kind: "status",
          status: data.status,
          code: data.code,
          operation: data.operation,
        });
      }
    },
    dropNext: (count: number): void => {
      for (let index: number = 0; index < count; index++) {
        failures.push({ kind: "drop" });
      }
    },
    failCompleteWithOkStatus: (code: string): void => {
      completeFailureCode = code;
    },
    object: (bucket: string, key: string): FakeS3StoredObject | undefined => {
      return buckets.get(bucket)?.objects.get(key);
    },
    keys: (bucket: string): Array<string> => {
      return Array.from(buckets.get(bucket)?.objects.keys() || []).sort();
    },
  };
}
