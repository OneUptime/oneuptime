import { JSONObject } from "Common/Types/JSON";
import { TRUNCATED_OUTPUT_MARKER, truncateToBytes } from "../OutputTruncation";

/*
 * What the Runner and a JavaScript step's sandbox process say to each other
 * (SandboxProcess on the Runner's side, SandboxWorker in the step's
 * process). One request on the process's standard input, one reply on the
 * result channel, fd 3 - never on its standard output, which carries
 * whatever the process or a library it loads prints and is read only for the
 * Runner's own log. Both are one JSON document, bounded in size, and the
 * reply carries the request's nonce.
 *
 * Plain data only: this file is part of the step's process, which reads
 * none of the Runner's settings (no import of the Runner's Config).
 */

export const SANDBOX_PROTOCOL_VERSION: number = 1;

// The step's process writes its reply here.
export const SANDBOX_RESULT_FD: number = 3;

/*
 * The request holds the step's script and its run's inputs, which the server
 * bounds well below this; the reply holds the step's output, cut to the
 * Runner's output limit before it is sent, and its error.
 */
export const MAX_SANDBOX_REQUEST_BYTES: number = 16 * 1024 * 1024;
export const MAX_SANDBOX_REPLY_BYTES: number = 1024 * 1024;

// A step's own error, as the reply carries it.
export const MAX_SANDBOX_ERROR_MESSAGE_LENGTH: number = 10_000;

/*
 * Where a step's HTTP may go, exactly as the Runner decided it
 * (RunbookExecutor.getJavaScriptSandboxPolicy) and VMRunner reads it. The
 * step's process decides nothing about it.
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
  policy: SandboxEgressPolicy;
}

export interface SandboxReply {
  version: number;
  nonce: string;
  success: boolean;
  output: string;
  errorMessage?: string | undefined;
}

const NONCE_PATTERN: RegExp = /^[a-f0-9]{32}$/;

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

function readOptionalBoolean(
  source: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value: unknown = source[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`The sandbox request's policy.${key} is not a boolean.`);
  }

  return value;
}

export function isSandboxNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE_PATTERN.test(value);
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

  const policySource: unknown = parsed["policy"];

  if (!isPlainObject(policySource)) {
    throw new Error("The sandbox request's policy is not an object.");
  }

  const hint: unknown = policySource["privateNetworkHint"];

  if (hint !== undefined && typeof hint !== "string") {
    throw new Error(
      "The sandbox request's policy.privateNetworkHint is not a string.",
    );
  }

  const policy: SandboxEgressPolicy = {};
  const allowPrivateNetworkRequests: boolean | undefined = readOptionalBoolean(
    policySource,
    "allowPrivateNetworkRequests",
  );
  const privateNetworkAccessIsAllowed: boolean | undefined =
    readOptionalBoolean(policySource, "privateNetworkAccessIsAllowed");
  const includeResolutionDetailInError: boolean | undefined =
    readOptionalBoolean(policySource, "includeResolutionDetailInError");

  if (allowPrivateNetworkRequests !== undefined) {
    policy.allowPrivateNetworkRequests = allowPrivateNetworkRequests;
  }

  if (privateNetworkAccessIsAllowed !== undefined) {
    policy.privateNetworkAccessIsAllowed = privateNetworkAccessIsAllowed;
  }

  if (typeof hint === "string") {
    policy.privateNetworkHint = hint;
  }

  if (includeResolutionDetailInError !== undefined) {
    policy.includeResolutionDetailInError = includeResolutionDetailInError;
  }

  return {
    version: SANDBOX_PROTOCOL_VERSION,
    nonce: parsed["nonce"],
    code: parsed["code"],
    args: parsed["args"] as JSONObject,
    timeoutInMs: parsed["timeoutInMs"],
    maxOutputBytes: parsed["maxOutputBytes"],
    policy,
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

  let parsed: unknown;

  try {
    parsed = JSON.parse(data.text);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) {
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
