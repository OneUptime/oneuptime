import { createHash, createHmac } from "crypto";
import { gunzipSync } from "zlib";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "Common/Server/Utils/DataSource/HttpFetch";
import Dictionary from "Common/Types/Dictionary";
import { AuditLogExportHttpTransport } from "../../../../Server/AuditLogExport/Destinations/Types";

/*
 * A FAITHFUL FAKE OF THE S3 API, for the S3 destination's suite: it answers
 * PutObject the way Amazon S3 (and MinIO, R2, B2...) does, and checks what
 * S3 checks before it stores anything, with its own code - never the
 * signer under test:
 *
 *   - the bucket from the host (bucket.s3.region.amazonaws.com) or the path
 *     (s3.region.amazonaws.com/bucket/key, endpoint/bucket/key);
 *   - the Signature Version 4 Authorization header: the access key must be
 *     one it knows (InvalidAccessKeyId), the credential scope must name the
 *     bucket's region (AuthorizationHeaderMalformed, with <Region>), and the
 *     signature, recomputed here from the request as it arrived, must match
 *     (SignatureDoesNotMatch);
 *   - x-amz-content-sha256 must be the SHA-256 of the body that arrived;
 *   - the bucket must exist (NoSuchBucket) and the key's policy must let it
 *     write under the prefix (AccessDenied).
 *
 * Errors are the XML documents S3 answers with. Not a test file itself.
 */

export interface FakeS3Object {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface FakeS3Bucket {
  region: string;
  // The prefixes the access key may PutObject under ("" for anywhere).
  writablePrefixes: Array<string>;
  objects: Map<string, FakeS3Object>;
}

export interface FakeS3Options {
  credentials: Dictionary<string>;
  buckets: Dictionary<{ region: string; writablePrefixes?: Array<string> }>;
  /*
   * Hosts that are S3-compatible endpoints rather than Amazon's: every
   * request to one names its bucket in the path.
   */
  pathStyleHosts?: Array<string> | undefined;
}

export interface FakeS3 {
  transport: AuditLogExportHttpTransport;
  buckets: Map<string, FakeS3Bucket>;
  requests: Array<DataSourceHttpRequest>;
  // Answers the next n requests with this status (and S3's code for it).
  failNext: (count: number, status: number, code: string) => void;
  // Answers the next n requests with no answer at all.
  dropNext: (count: number) => void;
  // The NDJSON lines of a stored object, parsed.
  readObject: (bucket: string, key: string) => Array<Record<string, unknown>>;
}

const AMAZON_SUFFIXES: Array<string> = [".amazonaws.com", ".amazonaws.com.cn"];

function xmlError(
  status: number,
  code: string,
  extra: string = "",
): DataSourceHttpResponse {
  const bodyText: string = `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${code} from the fake S3</Message>${extra}<RequestId>FAKE</RequestId></Error>`;

  return { statusCode: status, bodyText, bodyJson: undefined };
}

function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

// What DataSourceHttpFetch would throw for a non-2xx answer, as the transport contract says.
function asTransportAnswer(
  response: DataSourceHttpResponse,
): DataSourceHttpResponse {
  if (response.statusCode >= 200 && response.statusCode < 300) {
    return response;
  }

  throw new Error(
    `Data source responded with HTTP ${response.statusCode}: ${response.bodyText}`,
  );
}

function lowerHeaders(
  headers: Dictionary<string> | undefined,
): Dictionary<string> {
  const lowered: Dictionary<string> = {};

  for (const name of Object.keys(headers || {})) {
    lowered[name.toLowerCase()] = String((headers || {})[name]);
  }

  return lowered;
}

/*
 * The signature S3 expects for the request as it arrived: its own reading
 * of the canonical request (the path exactly as sent, which S3 does not
 * encode again; the signed headers by name; the payload hash header).
 */
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

  const canonicalQuery: string = Array.from(data.url.searchParams.entries())
    .map(([key, value]: [string, string]): string => {
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .sort()
    .join("&");

  const canonicalRequest: string = [
    data.method,
    data.url.pathname,
    canonicalQuery,
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

export function createFakeS3(options: FakeS3Options): FakeS3 {
  const buckets: Map<string, FakeS3Bucket> = new Map<string, FakeS3Bucket>();

  for (const name of Object.keys(options.buckets)) {
    const bucket: { region: string; writablePrefixes?: Array<string> } =
      options.buckets[name]!;

    buckets.set(name, {
      region: bucket.region,
      writablePrefixes: bucket.writablePrefixes || [""],
      objects: new Map<string, FakeS3Object>(),
    });
  }

  const requests: Array<DataSourceHttpRequest> = [];
  const failures: Array<{ status: number; code: string } | "drop"> = [];

  const handle: (request: DataSourceHttpRequest) => DataSourceHttpResponse = (
    request: DataSourceHttpRequest,
  ): DataSourceHttpResponse => {
    const url: URL = new URL(request.url);
    const headers: Dictionary<string> = lowerHeaders(request.headers);
    const body: Buffer = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(String(request.body ?? ""), "utf8");

    if (request.method !== "PUT") {
      return xmlError(405, "MethodNotAllowed");
    }

    // Which bucket, and which key, the request names.
    const isAmazon: boolean = AMAZON_SUFFIXES.some(
      (suffix: string): boolean => {
        return url.hostname.endsWith(suffix);
      },
    );
    const isPathStyle: boolean =
      !isAmazon ||
      (options.pathStyleHosts || []).includes(url.host) ||
      url.hostname.startsWith("s3.");

    const decodedPath: string = decodeURIComponent(url.pathname);
    let bucketName: string;
    let key: string;

    if (isPathStyle) {
      const parts: Array<string> = decodedPath.slice(1).split("/");
      bucketName = parts.shift() || "";
      key = parts.join("/");
    } else {
      bucketName = url.hostname.split(".")[0] || "";
      key = decodedPath.slice(1);
    }

    // The Authorization header S3 parses.
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

    const bucket: FakeS3Bucket | undefined = buckets.get(bucketName);

    if (service !== "s3" || terminator !== "aws4_request") {
      return xmlError(400, "AuthorizationHeaderMalformed");
    }

    if (bucket && region !== bucket.region) {
      return xmlError(
        400,
        "AuthorizationHeaderMalformed",
        `<Region>${bucket.region}</Region>`,
      );
    }

    const payloadHash: string = headers["x-amz-content-sha256"] || "";
    const amzDate: string = headers["x-amz-date"] || "";

    if (!amzDate.startsWith(dateStamp || "-")) {
      return xmlError(403, "SignatureDoesNotMatch");
    }

    const signature: string = expectedSignature({
      method: request.method,
      url,
      headers,
      signedHeaders: (fields["SignedHeaders"] || "").split(";"),
      payloadHash,
      secretAccessKey,
      dateStamp: dateStamp || "",
      region: region || "",
      amzDate,
    });

    if (signature !== fields["Signature"]) {
      return xmlError(403, "SignatureDoesNotMatch");
    }

    // Every header the request sends besides host must be signed, as S3 requires for x-amz-*.
    for (const name of Object.keys(headers)) {
      if (
        name.startsWith("x-amz-") &&
        !(fields["SignedHeaders"] || "").split(";").includes(name)
      ) {
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

    const mayWrite: boolean = bucket.writablePrefixes.some(
      (prefix: string): boolean => {
        return key.startsWith(prefix);
      },
    );

    if (!mayWrite) {
      return xmlError(403, "AccessDenied");
    }

    bucket.objects.set(key, {
      key,
      body,
      contentType: headers["content-type"] || "",
    });

    return { statusCode: 200, bodyText: "", bodyJson: undefined };
  };

  return {
    buckets,
    requests,
    failNext: (count: number, status: number, code: string): void => {
      for (let index: number = 0; index < count; index++) {
        failures.push({ status, code });
      }
    },
    dropNext: (count: number): void => {
      for (let index: number = 0; index < count; index++) {
        failures.push("drop");
      }
    },
    readObject: (
      bucketName: string,
      key: string,
    ): Array<Record<string, unknown>> => {
      const object: FakeS3Object | undefined = buckets
        .get(bucketName)
        ?.objects.get(key);

      if (!object) {
        throw new Error(`No object ${key} in ${bucketName}.`);
      }

      return gunzipSync(object.body)
        .toString("utf8")
        .split("\n")
        .filter((line: string): boolean => {
          return line.length > 0;
        })
        .map((line: string): Record<string, unknown> => {
          return JSON.parse(line) as Record<string, unknown>;
        });
    },
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      const failure: { status: number; code: string } | "drop" | undefined =
        failures.shift();

      if (failure === "drop") {
        const error: NodeJS.ErrnoException = new Error(
          "connect ECONNREFUSED 52.95.110.1:443",
        );
        error.code = "ECONNREFUSED";
        throw error;
      }

      if (failure) {
        return asTransportAnswer(xmlError(failure.status, failure.code));
      }

      return asTransportAnswer(handle(request));
    },
  };
}
