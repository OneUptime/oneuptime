/*
 * google.rpc.Status, encoded by hand: the body the OTLP specification asks
 * every OTLP/HTTP error response to carry (protobuf-encoded for a protobuf
 * request, JSON for a JSON one), and the gRPC status details a RetryInfo
 * rides in (the grpc-status-details-bin trailer).
 *
 * Hand-encoded because it is three fields and the alternative is loading
 * status.proto, any.proto and duration.proto into every ingest process for
 * the one error path that needs them:
 *
 *   message Status   { int32 code = 1; string message = 2; repeated Any details = 3; }
 *   message Any      { string type_url = 1; bytes value = 2; }
 *   message RetryInfo { Duration retry_delay = 1; }
 *   message Duration { int64 seconds = 1; int32 nanos = 2; }
 *
 * The OpenTelemetry Collector's exporters decode a 4xx/5xx body as this
 * message, so its message is what a collector prints in its own log - which
 * is where a customer whose telemetry is being refused looks first.
 */

// gRPC's code for "a quota or a rate was exceeded" (google.rpc.Code).
export const GRPC_RESOURCE_EXHAUSTED_CODE: number = 8;

export const RETRY_INFO_TYPE_URL: string =
  "type.googleapis.com/google.rpc.RetryInfo";

const encodeVarint: (value: number) => Buffer = (value: number): Buffer => {
  const bytes: Array<number> = [];
  let remaining: number = Math.max(0, Math.floor(value));

  while (remaining >= 0x80) {
    bytes.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }

  bytes.push(remaining);

  return Buffer.from(bytes);
};

// A length-delimited field (wire type 2): tag, length, bytes.
const encodeBytesField: (fieldNumber: number, value: Buffer) => Buffer = (
  fieldNumber: number,
  value: Buffer,
): Buffer => {
  return Buffer.concat([
    encodeVarint((fieldNumber << 3) | 2),
    encodeVarint(value.length),
    value,
  ]);
};

// A varint field (wire type 0), omitted when 0 as proto3 does.
const encodeVarintField: (fieldNumber: number, value: number) => Buffer = (
  fieldNumber: number,
  value: number,
): Buffer => {
  if (!value) {
    return Buffer.alloc(0);
  }

  return Buffer.concat([encodeVarint(fieldNumber << 3), encodeVarint(value)]);
};

export const encodeRetryInfo: (retryDelaySeconds: number) => Buffer = (
  retryDelaySeconds: number,
): Buffer => {
  const duration: Buffer = encodeVarintField(1, retryDelaySeconds);

  return encodeBytesField(1, duration);
};

export const encodeGoogleRpcStatus: (data: {
  code: number;
  message: string;
  retryDelaySeconds?: number | undefined;
}) => Buffer = (data: {
  code: number;
  message: string;
  retryDelaySeconds?: number | undefined;
}): Buffer => {
  const parts: Array<Buffer> = [
    encodeVarintField(1, data.code),
    encodeBytesField(2, Buffer.from(data.message, "utf8")),
  ];

  if (data.retryDelaySeconds !== undefined && data.retryDelaySeconds > 0) {
    const any: Buffer = Buffer.concat([
      encodeBytesField(1, Buffer.from(RETRY_INFO_TYPE_URL, "utf8")),
      encodeBytesField(2, encodeRetryInfo(data.retryDelaySeconds)),
    ]);

    parts.push(encodeBytesField(3, any));
  }

  return Buffer.concat(parts);
};
