import { JSONObject } from "Common/Types/JSON";
import {
  MAX_HTTP_CONFIG_BYTES,
  MAX_HTTP_REQUEST_BYTES,
  MAX_HTTP_RESPONSE_BYTES,
  MAX_HTTP_URL_BYTES,
  VM_HTTP_METHODS,
  VMHttpCall,
} from "Common/Server/Utils/VM/VMHttpBridge";
import { TRUNCATED_OUTPUT_MARKER, truncateToBytes } from "../OutputTruncation";

/*
 * What the Runner and a JavaScript step's sandbox process say to each other
 * (SandboxProcess and SandboxHttp on the Runner's side, SandboxWorker in the
 * step's process), on four channels:
 *
 *   - standard input, the Runner's to the step: the request, one line, then
 *     the answer to each of the step's HTTP calls, one line each;
 *   - fd 3, the result channel: the step's one reply, until it closes;
 *   - fd 4, the HTTP channel: each HTTP call of the step, one line each. The
 *     step's process may open no socket (Native/javascript-sandbox-no-
 *     network.c), so the Runner makes its HTTP on its behalf (SandboxHttp),
 *     through VMRunner's SSRF guard with the Runner's own policy for the
 *     step, which the step's process is never told;
 *   - standard output and error, read only for the Runner's own log: what
 *     the process or a library it loads prints, never part of the protocol.
 *
 * Every message is one JSON document - which JSON.stringify writes without
 * a raw newline, so a line is a message - bounded in size, and the reply
 * carries the request's nonce.
 *
 * Plain data only: this file is part of the step's process, which reads
 * none of the Runner's settings (no import of the Runner's Config).
 */

export const SANDBOX_PROTOCOL_VERSION: number = 2;

// The step's process writes its reply here.
export const SANDBOX_RESULT_FD: number = 3;

// And its HTTP calls here, each answered on its standard input.
export const SANDBOX_HTTP_FD: number = 4;

/*
 * The request holds the step's script and its run's inputs, which the server
 * bounds well below this; the reply holds the step's output, cut to the
 * Runner's output limit before it is sent, and its error.
 */
export const MAX_SANDBOX_REQUEST_BYTES: number = 16 * 1024 * 1024;
export const MAX_SANDBOX_REPLY_BYTES: number = 1024 * 1024;

/*
 * One HTTP call, as a line: its URL, body and config within what VMRunner
 * lets a call send (VMHttpBridge.reserve, which the step's process applies
 * before it sends one and the Runner again when it gets one), each written
 * again as a JSON string - which at most doubles a JSON text, and writes a
 * control character of a URL in six.
 */
export const MAX_SANDBOX_HTTP_CALL_BYTES: number =
  6 * MAX_HTTP_URL_BYTES +
  2 * (MAX_HTTP_REQUEST_BYTES + 2 * MAX_HTTP_CONFIG_BYTES) +
  64 * 1024;

/*
 * Every HTTP call of one step together. A run may send MAX_HTTP_REQUEST_BYTES
 * in all, so this leaves room for its lines' escaping and framing, and a
 * process that sends more is not the step's worker: the Runner stops it.
 */
export const MAX_SANDBOX_HTTP_CHANNEL_BYTES: number =
  4 * MAX_HTTP_REQUEST_BYTES + 16 * 1024 * 1024;

/*
 * One answer to an HTTP call, as a line: the response's envelope, within
 * what a run may bring back (MAX_HTTP_RESPONSE_BYTES), written again as a
 * JSON string. What the step's process reads on its standard input is that,
 * or the request.
 */
export const MAX_SANDBOX_HTTP_RESULT_BYTES: number =
  2 * MAX_HTTP_RESPONSE_BYTES + 64 * 1024;

export const MAX_SANDBOX_INPUT_LINE_BYTES: number = Math.max(
  MAX_SANDBOX_REQUEST_BYTES,
  MAX_SANDBOX_HTTP_RESULT_BYTES,
);

// A step's own error, as the reply carries it, and an HTTP call's.
export const MAX_SANDBOX_ERROR_MESSAGE_LENGTH: number = 10_000;

/*
 * Where a step's HTTP may go, exactly as the Runner decided it
 * (RunbookExecutor.getJavaScriptSandboxPolicy) and VMRunner's bridge reads
 * it. The Runner holds it for the step and applies it (SandboxHttp); the
 * step's process decides nothing about it and is never handed it.
 */
export interface SandboxEgressPolicy {
  allowPrivateNetworkRequests?: boolean | undefined;
  privateNetworkAccessIsAllowed?: boolean | undefined;
  privateNetworkHint?: string | undefined;
  includeResolutionDetailInError?: boolean | undefined;
}

export interface SandboxRequest {
  version: number;
  nonce: string;
  code: string;
  args: JSONObject;
  timeoutInMs: number;
  maxOutputBytes: number;
}

export interface SandboxReply {
  version: number;
  nonce: string;
  success: boolean;
  output: string;
  errorMessage?: string | undefined;
}

// One HTTP call of the step, numbered by the step's process.
export interface SandboxHttpCall {
  id: number;
  call: VMHttpCall;
}

// The Runner's answer to one: the response's envelope, or why there is none.
export interface SandboxHttpResult {
  id: number;
  value?: string | undefined;
  errorMessage?: string | undefined;
}

const NONCE_PATTERN: RegExp = /^[a-f0-9]{32}$/;

const NEWLINE: number = 0x0a;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isCallId(value: unknown): value is number {
  return isPositiveInteger(value) && Number.isSafeInteger(value);
}

function parseObject(text: string): Record<string, unknown> | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  return isPlainObject(parsed) ? parsed : null;
}

export function isSandboxNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE_PATTERN.test(value);
}

/*
 * A channel that sent more than it may: a line past its limit, or the
 * channel past its own. The reader takes nothing more from it.
 */
export class SandboxChannelOverflow extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SandboxChannelOverflow";
  }
}

/*
 * Cuts a stream into its lines, each held to maxLineBytes, and the stream to
 * maxTotalBytes in all. A line is decoded whole, so a character split
 * between two chunks is read as itself; a newline byte is never part of a
 * longer UTF-8 character, so cutting there is safe.
 */
export class SandboxLineReader {
  private pending: Array<Buffer> = [];
  private pendingBytes: number = 0;
  private totalBytes: number = 0;
  private overflowed: boolean = false;

  public constructor(
    private readonly limits: {
      maxLineBytes: number;
      maxTotalBytes?: number | undefined;
    },
  ) {}

  public get hasPartialLine(): boolean {
    return this.pendingBytes > 0;
  }

  // The lines this chunk ends. Throws SandboxChannelOverflow past a limit.
  public push(chunk: Buffer | string): Array<string> {
    if (this.overflowed) {
      throw new SandboxChannelOverflow("The channel already sent too much.");
    }

    const buffer: Buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, "utf8");

    this.totalBytes += buffer.length;

    if (
      this.limits.maxTotalBytes !== undefined &&
      this.totalBytes > this.limits.maxTotalBytes
    ) {
      return this.overflow("The channel sent more than it may in all.");
    }

    const lines: Array<string> = [];
    let start: number = 0;

    for (;;) {
      const end: number = buffer.indexOf(NEWLINE, start);
      const piece: Buffer = buffer.subarray(
        start,
        end === -1 ? undefined : end,
      );

      if (this.pendingBytes + piece.length > this.limits.maxLineBytes) {
        return this.overflow("A line on the channel is longer than it may be.");
      }

      if (end === -1) {
        if (piece.length > 0) {
          this.pending.push(piece);
          this.pendingBytes += piece.length;
        }
        return lines;
      }

      this.pending.push(piece);
      lines.push(Buffer.concat(this.pending).toString("utf8"));
      this.pending = [];
      this.pendingBytes = 0;
      start = end + 1;
    }
  }

  private overflow(message: string): never {
    this.overflowed = true;
    this.pending = [];
    this.pendingBytes = 0;
    throw new SandboxChannelOverflow(message);
  }
}

/*
 * The request, read and checked by the step's process. Anything it does not
 * expect is an error: the Runner built it, so a request of another shape is
 * a mismatch between the two, never something to make the best of.
 */
export function parseSandboxRequest(text: string): SandboxRequest {
  if (Buffer.byteLength(text, "utf8") > MAX_SANDBOX_REQUEST_BYTES) {
    throw new Error("The sandbox request is too large.");
  }

  const parsed: unknown = JSON.parse(text);

  if (!isPlainObject(parsed)) {
    throw new Error("The sandbox request is not an object.");
  }

  if (parsed["version"] !== SANDBOX_PROTOCOL_VERSION) {
    throw new Error("The sandbox request is of another protocol version.");
  }

  if (!isSandboxNonce(parsed["nonce"])) {
    throw new Error("The sandbox request has no nonce.");
  }

  if (typeof parsed["code"] !== "string") {
    throw new Error("The sandbox request has no script.");
  }

  if (!isPlainObject(parsed["args"])) {
    throw new Error("The sandbox request's args are not an object.");
  }

  if (!isPositiveInteger(parsed["timeoutInMs"])) {
    throw new Error("The sandbox request's timeout is not a positive integer.");
  }

  if (!isPositiveInteger(parsed["maxOutputBytes"])) {
    throw new Error(
      "The sandbox request's output limit is not a positive integer.",
    );
  }

  return {
    version: SANDBOX_PROTOCOL_VERSION,
    nonce: parsed["nonce"],
    code: parsed["code"],
    args: parsed["args"] as JSONObject,
    timeoutInMs: parsed["timeoutInMs"],
    maxOutputBytes: parsed["maxOutputBytes"],
  };
}

/*
 * The reply, read by the Runner: null for anything but one well-formed reply
 * to this request, which the Runner then reports as a step that ended
 * without a result. The output and error are cut again here, so a reply
 * never puts more in the Runner's report than the request allowed.
 */
export function parseSandboxReply(data: {
  text: string;
  nonce: string;
  maxOutputBytes: number;
}): SandboxReply | null {
  if (Buffer.byteLength(data.text, "utf8") > MAX_SANDBOX_REPLY_BYTES) {
    return null;
  }

  const parsed: Record<string, unknown> | null = parseObject(data.text);

  if (!parsed) {
    return null;
  }

  if (
    parsed["version"] !== SANDBOX_PROTOCOL_VERSION ||
    parsed["nonce"] !== data.nonce ||
    typeof parsed["success"] !== "boolean" ||
    typeof parsed["output"] !== "string"
  ) {
    return null;
  }

  const errorMessage: unknown = parsed["errorMessage"];

  if (errorMessage !== undefined && typeof errorMessage !== "string") {
    return null;
  }

  return {
    version: SANDBOX_PROTOCOL_VERSION,
    nonce: data.nonce,
    success: parsed["success"],
    // The step's process cut it already, its marker included.
    output: truncateToBytes(
      parsed["output"],
      data.maxOutputBytes + Buffer.byteLength(TRUNCATED_OUTPUT_MARKER, "utf8"),
    ),
    ...(typeof errorMessage === "string"
      ? {
          errorMessage: errorMessage.slice(0, MAX_SANDBOX_ERROR_MESSAGE_LENGTH),
        }
      : {}),
  };
}

// One HTTP call as the step's process writes it, newline included.
export function serializeSandboxHttpCall(httpCall: SandboxHttpCall): string {
  return `${JSON.stringify({
    id: httpCall.id,
    method: httpCall.call.method,
    ...(httpCall.call.url !== undefined ? { url: httpCall.call.url } : {}),
    ...(httpCall.call.arg1 !== undefined ? { arg1: httpCall.call.arg1 } : {}),
    ...(httpCall.call.arg2 !== undefined ? { arg2: httpCall.call.arg2 } : {}),
  })}\n`;
}

/*
 * One HTTP call, read by the Runner: null for anything but a call of the
 * shape the step's worker writes - a number of its own, a method VMRunner's
 * axios shim makes, and text or nothing for the rest. The Runner stops a
 * process that writes anything else.
 */
export function parseSandboxHttpCall(text: string): SandboxHttpCall | null {
  if (Buffer.byteLength(text, "utf8") > MAX_SANDBOX_HTTP_CALL_BYTES) {
    return null;
  }

  const parsed: Record<string, unknown> | null = parseObject(text);

  if (!parsed || !isCallId(parsed["id"])) {
    return null;
  }

  const method: unknown = parsed["method"];

  if (typeof method !== "string" || !VM_HTTP_METHODS.includes(method)) {
    return null;
  }

  const call: VMHttpCall = { method };

  for (const name of ["url", "arg1", "arg2"] as const) {
    const value: unknown = parsed[name];

    if (value === undefined) {
      continue;
    }

    if (typeof value !== "string") {
      return null;
    }

    call[name] = value;
  }

  return { id: parsed["id"], call };
}

// The Runner's answer to one call, newline included.
export function serializeSandboxHttpResult(result: SandboxHttpResult): string {
  if (typeof result.value === "string") {
    return `${JSON.stringify({ id: result.id, value: result.value })}\n`;
  }

  return `${JSON.stringify({
    id: result.id,
    errorMessage: (result.errorMessage || "HTTP request failed").slice(
      0,
      MAX_SANDBOX_ERROR_MESSAGE_LENGTH,
    ),
  })}\n`;
}

/*
 * An answer, read by the step's process: an envelope or an error for one of
 * its calls, or null for anything else.
 */
export function parseSandboxHttpResult(text: string): SandboxHttpResult | null {
  const parsed: Record<string, unknown> | null = parseObject(text);

  if (!parsed || !isCallId(parsed["id"])) {
    return null;
  }

  const value: unknown = parsed["value"];
  const errorMessage: unknown = parsed["errorMessage"];

  if (typeof value === "string" && errorMessage === undefined) {
    return { id: parsed["id"], value };
  }

  if (typeof errorMessage === "string" && value === undefined) {
    return {
      id: parsed["id"],
      errorMessage: errorMessage.slice(0, MAX_SANDBOX_ERROR_MESSAGE_LENGTH),
    };
  }

  return null;
}
