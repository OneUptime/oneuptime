import {
  FIREHOSE_MAX_RECORDS,
  FIREHOSE_MAX_RECORD_DATA_LENGTH,
  FIREHOSE_REQUEST_ID_HEADER,
} from "Common/Types/CloudConnection/CloudStream";
import { ExpressResponse } from "Common/Server/Utils/Express";
import { JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * AMAZON DATA FIREHOSE'S HTTP ENDPOINT CONTRACT, AS FIREHOSE WRITES IT.
 *
 * ("Appendix - HTTP Endpoint Delivery Request and Response
 * Specifications", Amazon Data Firehose Developer Guide.)
 *
 * A REQUEST is a POST of one JSON document - Content-Encoding: gzip when
 * the stream compresses - with the request's id in X-Amz-Firehose-Request-Id
 * (the same on every retry of one batch), the stream's ARN in
 * X-Amz-Firehose-Source-Arn and its access key in X-Amz-Firehose-Access-Key:
 *
 *   { "requestId": "...", "timestamp": 1578090901599,
 *     "records": [ { "data": "<base64>" }, ... ] }
 *
 * at most 10,000 records, each at most 1,024,000 bytes before base64 - an
 * empty one allowed.
 *
 * A RESPONSE is JSON, never compressed, of at most 1 MiB, with the
 * request's id and the time it was processed:
 *
 *   { "requestId": "...", "timestamp": 1578090903599, "errorMessage": "..." }
 *
 * Firehose reads its status: 200 is delivered; 413 is too large, a
 * permanent failure it does not send again; anything else - a 4xx or a
 * 5xx - it sends again, backing off, until the stream's retry duration is
 * up, and then keeps the batch in the stream's backup bucket with the last
 * errorMessage. A response it cannot read is a 500 to it. So every answer
 * here, a refusal too, is a body in that shape, and errorMessage says what
 * to do, since it is what the person reads in the bucket and in the
 * stream's error log.
 *
 * Every body stays under 1,000 bytes: nginx gzips answers of 1,000 bytes
 * and more, which a client that asked for gzip would get compressed.
 */

// Firehose's request ids are GUIDs; one longer than this is not read as one.
export const FIREHOSE_MAX_REQUEST_ID_LENGTH: number = 128;
// What an errorMessage is cut to: the whole answer stays under 1,000 bytes.
export const FIREHOSE_MAX_ERROR_MESSAGE_LENGTH: number = 700;

export const FIREHOSE_RESPONSE_CONTENT_TYPE: string = "application/json";

function isRequestIdCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 45 ||
    code === 95 ||
    code === 46 ||
    code === 58
  );
}

// A request id as it can be echoed: letters, digits and - _ . : only.
export function readFirehoseRequestId(value: unknown): string {
  const text: string = Array.isArray(value)
    ? String(value[0] ?? "")
    : typeof value === "string"
      ? value
      : "";
  const trimmed: string = text.trim();

  if (!trimmed || trimmed.length > FIREHOSE_MAX_REQUEST_ID_LENGTH) {
    return "";
  }

  for (let index: number = 0; index < trimmed.length; index++) {
    if (!isRequestIdCharacter(trimmed.charCodeAt(index))) {
      return "";
    }
  }

  return trimmed;
}

export function readFirehoseRequestIdHeader(
  headers: Record<string, string | Array<string> | undefined>,
): string {
  return readFirehoseRequestId(headers[FIREHOSE_REQUEST_ID_HEADER]);
}

// The answer's body: the request's id, now, and why when it is a refusal.
export function buildFirehoseResponseBody(data: {
  requestId: string;
  now: Date;
  errorMessage?: string | undefined;
}): Buffer {
  const body: JSONObject = {
    requestId: data.requestId,
    timestamp: data.now.getTime(),
  };

  if (data.errorMessage) {
    body["errorMessage"] = data.errorMessage.slice(
      0,
      FIREHOSE_MAX_ERROR_MESSAGE_LENGTH,
    );
  }

  return Buffer.from(JSON.stringify(body), "utf8");
}

/*
 * Answers Firehose: the status, exactly "application/json", a length, and
 * nothing a cache or a proxy may change.
 */
export function sendFirehoseResponse(data: {
  res: ExpressResponse;
  status: number;
  requestId: string;
  now: Date;
  errorMessage?: string | undefined;
}): void {
  if (data.res.headersSent) {
    return;
  }

  const body: Buffer = buildFirehoseResponseBody({
    requestId: data.requestId,
    now: data.now,
    errorMessage: data.errorMessage,
  });

  data.res.status(data.status);
  data.res.setHeader("Content-Type", FIREHOSE_RESPONSE_CONTENT_TYPE);
  data.res.setHeader("Content-Length", String(body.length));
  data.res.setHeader("Cache-Control", "no-store, no-transform");
  data.res.end(body);
}

export interface FirehoseEnvelope {
  // The body's own request id: the header's, duplicated.
  requestId: string;
  timestamp: number | null;
  // Each record's data, base64, in order. Empty records are left out.
  records: Array<string>;
}

export type FirehoseEnvelopeReading =
  | { envelope: FirehoseEnvelope }
  | { problem: string };

/*
 * A request body as Firehose writes it - or what is wrong with it, said so
 * the person reading Firehose's error log knows the endpoint is the wrong
 * one. Never throws.
 */
export function readFirehoseEnvelope(body: Buffer): FirehoseEnvelopeReading {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return {
      problem:
        "The request body is not JSON. Send this endpoint deliveries of an Amazon Data Firehose HTTP endpoint destination only.",
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      problem:
        "The request body is not a Firehose delivery: it has no records.",
    };
  }

  const document: JSONObject = parsed as JSONObject;
  const records: JSONValue | undefined = document["records"];

  if (!Array.isArray(records)) {
    return {
      problem:
        "The request body is not a Firehose delivery: it has no records.",
    };
  }

  if (records.length > FIREHOSE_MAX_RECORDS) {
    return {
      problem: `A delivery holds at most ${FIREHOSE_MAX_RECORDS} records.`,
    };
  }

  const data: Array<string> = [];

  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return { problem: "Each record must be an object with its data." };
    }

    const value: JSONValue | undefined = (record as JSONObject)["data"];

    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (typeof value !== "string") {
      return { problem: "A record's data must be base64 text." };
    }

    if (value.length > FIREHOSE_MAX_RECORD_DATA_LENGTH) {
      return {
        problem: `A record's data is at most ${FIREHOSE_MAX_RECORD_DATA_LENGTH} characters of base64.`,
      };
    }

    data.push(value);
  }

  const timestamp: JSONValue | undefined = document["timestamp"];

  return {
    envelope: {
      requestId: readFirehoseRequestId(document["requestId"]),
      timestamp:
        typeof timestamp === "number" && Number.isFinite(timestamp)
          ? timestamp
          : null,
      records: data,
    },
  };
}
