import crypto from "crypto";

/*
 * AWS Signature Version 4, for the Cloud AI agent's calls to AWS (no AWS
 * SDK in the image). Implements "Create a signed AWS API request" exactly:
 *
 *   CanonicalRequest = Method \n CanonicalURI \n CanonicalQueryString \n
 *                      CanonicalHeaders \n SignedHeaders \n hex(SHA256(body))
 *   StringToSign     = "AWS4-HMAC-SHA256" \n AmzDate \n Scope \n
 *                      hex(SHA256(CanonicalRequest))
 *   SigningKey       = HMAC chain of "AWS4"+secret over date, region,
 *                      service and "aws4_request"
 *   Authorization    = AWS4-HMAC-SHA256 Credential=AKID/Scope,
 *                      SignedHeaders=..., Signature=hex(HMAC(key, sts))
 *
 * Every service the agent calls is not S3, so the canonical URI is the
 * path as sent (each segment already percent-encoded once) encoded once
 * more — the double encoding AWS requires, which botocore does too (an ARN
 * in a Lambda path is "%3A" on the wire and "%253A" in the canonical
 * request). Every header the agent sends is signed, besides those the
 * transport adds itself (Content-Length, User-Agent): Host, X-Amz-Date,
 * X-Amz-Security-Token for temporary credentials, Content-Type and
 * X-Amz-Target.
 *
 * Pure (the date is an input): tested against AWS's published example and
 * against requests the AWS CLI signed.
 */

export const AWS_SIGV4_ALGORITHM: string = "AWS4-HMAC-SHA256";

export interface AwsSigningCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  // Temporary credentials' session token; null for long-term keys.
  sessionToken: string | null;
}

export interface AwsSignInput {
  method: string;
  // The path as sent: "/" or segments each percent-encoded once.
  path: string;
  // Query parameters, decoded (encoded and sorted here).
  query: Record<string, string>;
  // The Host header: the endpoint's host name (and port, when not the default).
  host: string;
  // Headers the request carries besides Host and the X-Amz-* ones added here.
  headers: Record<string, string>;
  body: string;
  // The signing name ("ecs", "lambda", "application-autoscaling") and Region.
  service: string;
  region: string;
  date: Date;
  credentials: AwsSigningCredentials;
}

export interface AwsSignedRequest {
  // Every header to send: the input's, X-Amz-Date, X-Amz-Security-Token, Authorization.
  headers: Record<string, string>;
  // The canonical query string, which is also what the URL carries ("" for none).
  queryString: string;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

const HEX_DIGITS: string = "0123456789ABCDEF";

/*
 * RFC 3986 percent-encoding as SigV4 defines it: the unreserved characters
 * (A-Z a-z 0-9 - _ . ~) stay, "/" stays when encodeSlash is false, every
 * other UTF-8 byte becomes %XX with uppercase hex.
 */
export function awsUriEncode(value: string, encodeSlash: boolean): string {
  const bytes: Buffer = Buffer.from(value, "utf8");
  let encoded: string = "";

  for (const byte of bytes) {
    const isUnreserved: boolean =
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      (byte >= 0x30 && byte <= 0x39) ||
      byte === 0x2d ||
      byte === 0x5f ||
      byte === 0x2e ||
      byte === 0x7e;

    if (isUnreserved || (byte === 0x2f && !encodeSlash)) {
      encoded += String.fromCharCode(byte);
    } else {
      encoded += `%${HEX_DIGITS.charAt(byte >> 4)}${HEX_DIGITS.charAt(byte & 0x0f)}`;
    }
  }

  return encoded;
}

// A path of these (decoded) segments, each encoded once: what the URL carries.
export function buildAwsPath(segments: ReadonlyArray<string>): string {
  return `/${segments
    .map((segment: string): string => {
      return awsUriEncode(segment, true);
    })
    .join("/")}`;
}

// A form body (Query protocol): name=value pairs in the given order, encoded.
export function encodeAwsForm(params: ReadonlyArray<[string, string]>): string {
  return params
    .map(([name, value]: [string, string]): string => {
      return `${awsUriEncode(name, true)}=${awsUriEncode(value, true)}`;
    })
    .join("&");
}

// 20150830T123600Z
export function formatAmzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

function sha256Hex(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

// The signing key for one day, Region and service.
export function deriveAwsSigningKey(data: {
  secretAccessKey: string;
  dateStamp: string;
  region: string;
  service: string;
}): Buffer {
  const dateKey: Buffer = hmac(`AWS4${data.secretAccessKey}`, data.dateStamp);
  const regionKey: Buffer = hmac(dateKey, data.region);
  const serviceKey: Buffer = hmac(regionKey, data.service);

  return hmac(serviceKey, "aws4_request");
}

// Header values are trimmed and inner runs of spaces folded to one.
function canonicalHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function canonicalAwsQueryString(query: Record<string, string>): string {
  return Object.keys(query)
    .map((name: string): [string, string] => {
      return [awsUriEncode(name, true), awsUriEncode(query[name] || "", true)];
    })
    .sort((left: [string, string], right: [string, string]): number => {
      if (left[0] !== right[0]) {
        return left[0] < right[0] ? -1 : 1;
      }

      return left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
    })
    .map(([name, value]: [string, string]): string => {
      return `${name}=${value}`;
    })
    .join("&");
}

export function signAwsRequest(input: AwsSignInput): AwsSignedRequest {
  const amzDate: string = formatAmzDate(input.date);
  const dateStamp: string = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...input.headers };

  headers["X-Amz-Date"] = amzDate;

  if (input.credentials.sessionToken) {
    headers["X-Amz-Security-Token"] = input.credentials.sessionToken;
  }

  const signed: Record<string, string> = { host: input.host };

  for (const name of Object.keys(headers)) {
    signed[name.toLowerCase()] = canonicalHeaderValue(headers[name] || "");
  }

  const names: Array<string> = Object.keys(signed).sort();
  const canonicalHeaders: string = names
    .map((name: string): string => {
      return `${name}:${signed[name] || ""}\n`;
    })
    .join("");
  const signedHeaders: string = names.join(";");
  const queryString: string = canonicalAwsQueryString(input.query);
  const canonicalUri: string = awsUriEncode(input.path || "/", false);

  const canonicalRequest: string = [
    input.method.toUpperCase(),
    canonicalUri,
    queryString,
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.body),
  ].join("\n");

  const scope: string = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign: string = [
    AWS_SIGV4_ALGORITHM,
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature: string = crypto
    .createHmac(
      "sha256",
      deriveAwsSigningKey({
        secretAccessKey: input.credentials.secretAccessKey,
        dateStamp,
        region: input.region,
        service: input.service,
      }),
    )
    .update(stringToSign, "utf8")
    .digest("hex");

  headers["Authorization"] =
    `${AWS_SIGV4_ALGORITHM} Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers, queryString, canonicalRequest, stringToSign, signature };
}
