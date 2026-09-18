import crypto from "crypto";

export const SYNTHETIC_RUNTIME_PROTOCOL_VERSION: number = 1;

export const MAX_RPC_REQUEST_BYTES: number = 1_000_000;
export const MAX_RPC_RESULT_BYTES: number = 5_000_000;
export const MAX_RPC_CALLS: number = 5_000;
export const MAX_RPC_IN_FLIGHT: number = 32;
export const MAX_SANDBOX_LOG_BYTES: number = 1_000_000;
export const MAX_SANDBOX_LOG_MESSAGES: number = 10_000;
export const MAX_SANDBOX_METRICS: number = 100;
export const MAX_SCREENSHOTS: number = 20;
export const MAX_SCREENSHOT_BYTES: number = 10_000_000;
export const MAX_TOTAL_SCREENSHOT_BYTES: number = 50_000_000;

const BIGINT_VALUE_PATTERN: RegExp = /^-?(?:0|[1-9][0-9]*)$/;
const RPC_METHOD_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9]*$/;

export type PlaywrightCapabilityType =
  | "browser-context"
  | "dialog"
  | "element-handle"
  | "file-chooser"
  | "frame"
  | "js-handle"
  | "keyboard"
  | "locator"
  | "mouse"
  | "page"
  | "request"
  | "response"
  | "runtime"
  | "touchscreen";

export interface CapabilityDescriptor {
  readonly __oneuptimeCapability: true;
  readonly id: string;
  readonly type: PlaywrightCapabilityType;
  readonly snapshot?: Record<string, unknown> | undefined;
}

export interface LocatorChainStep {
  readonly method: string;
  readonly args: unknown[];
}

export interface LocatorDescriptor {
  readonly __oneuptimeLocator: true;
  readonly rootCapabilityId: string;
  readonly chain: LocatorChainStep[];
}

export interface FunctionDescriptor {
  readonly __oneuptimeFunction: true;
  readonly source: string;
}

export interface RegExpDescriptor {
  readonly __oneuptimeRegExp: true;
  readonly source: string;
  readonly flags: string;
}

export interface BinaryDescriptor {
  readonly __oneuptimeBinary: true;
  readonly base64: string;
}

export interface BigIntDescriptor {
  readonly __oneuptimeBigInt: true;
  readonly value: string;
}

export interface MapDescriptor {
  readonly __oneuptimeMap: true;
  readonly entries: [unknown, unknown][];
}

export interface ScreenshotDescriptor {
  readonly __oneuptimeScreenshot: true;
  readonly id: string;
  readonly byteLength: number;
}

export interface PlaywrightRpcRequest {
  readonly version: number;
  readonly executionId: string;
  readonly requestId: string;
  readonly capabilityId: string;
  readonly locatorChain?: LocatorChainStep[] | undefined;
  readonly method: string;
  readonly args: unknown[];
}

export interface PlaywrightRpcResponse {
  readonly version: number;
  readonly requestId: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
  readonly state?: RuntimeStateSnapshot;
}

export interface RuntimeStateSnapshot {
  readonly pages: CapabilityDescriptor[];
  /**
   * The capability targeted by the completed call when it is no longer part
   * of the live page set (for example, a Page immediately after close()).
   * Keeping this to one descriptor makes refreshes independent of the number
   * of capabilities created earlier in the execution.
   */
  readonly invokedCapability?: CapabilityDescriptor | undefined;
}

export interface SandboxMetric {
  name: string;
  value: number;
  attributes?: Record<string, string> | undefined;
}

export interface SandboxExecutionResult {
  returnValue?: unknown;
  logMessages: string[];
  capturedMetrics: SandboxMetric[];
  screenshots: Record<string, Buffer>;
  scriptError?: string | undefined;
}

export function createExecutionId(): string {
  return crypto.randomUUID();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isCapabilityDescriptor(
  value: unknown,
): value is CapabilityDescriptor {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value["__oneuptimeCapability"] === true &&
    typeof value["id"] === "string" &&
    typeof value["type"] === "string"
  );
}

export function isLocatorDescriptor(
  value: unknown,
): value is LocatorDescriptor {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value["__oneuptimeLocator"] === true &&
    typeof value["rootCapabilityId"] === "string" &&
    Array.isArray(value["chain"])
  );
}

export function isFunctionDescriptor(
  value: unknown,
): value is FunctionDescriptor {
  return (
    isRecord(value) &&
    value["__oneuptimeFunction"] === true &&
    typeof value["source"] === "string"
  );
}

export function isRegExpDescriptor(value: unknown): value is RegExpDescriptor {
  return (
    isRecord(value) &&
    value["__oneuptimeRegExp"] === true &&
    typeof value["source"] === "string" &&
    typeof value["flags"] === "string"
  );
}

export function isBinaryDescriptor(value: unknown): value is BinaryDescriptor {
  return (
    isRecord(value) &&
    value["__oneuptimeBinary"] === true &&
    typeof value["base64"] === "string"
  );
}

export function isBigIntDescriptor(value: unknown): value is BigIntDescriptor {
  return (
    isRecord(value) &&
    value["__oneuptimeBigInt"] === true &&
    typeof value["value"] === "string" &&
    BIGINT_VALUE_PATTERN.test(value["value"])
  );
}

export function isMapDescriptor(value: unknown): value is MapDescriptor {
  return (
    isRecord(value) &&
    value["__oneuptimeMap"] === true &&
    Array.isArray(value["entries"]) &&
    value["entries"].length <= 1_000 &&
    value["entries"].every((entry: unknown) => {
      return Array.isArray(entry) && entry.length === 2;
    })
  );
}

export function isScreenshotDescriptor(
  value: unknown,
): value is ScreenshotDescriptor {
  return (
    isRecord(value) &&
    value["__oneuptimeScreenshot"] === true &&
    typeof value["id"] === "string" &&
    typeof value["byteLength"] === "number"
  );
}

export function byteLengthOfJson(value: unknown): number {
  try {
    const serialized: string | undefined = JSON.stringify(value);
    return serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function validateRpcRequest(
  value: unknown,
  expectedExecutionId: string,
): PlaywrightRpcRequest {
  if (!isRecord(value)) {
    throw new Error("Sandbox RPC request must be an object.");
  }

  if (byteLengthOfJson(value) > MAX_RPC_REQUEST_BYTES) {
    throw new Error("Sandbox RPC request exceeded the size limit.");
  }

  if (value["version"] !== SYNTHETIC_RUNTIME_PROTOCOL_VERSION) {
    throw new Error("Unsupported sandbox RPC protocol version.");
  }

  if (value["executionId"] !== expectedExecutionId) {
    throw new Error("Sandbox RPC execution identifier did not match.");
  }

  if (
    typeof value["requestId"] !== "string" ||
    value["requestId"].length < 1 ||
    value["requestId"].length > 200
  ) {
    throw new Error("Sandbox RPC request identifier is invalid.");
  }

  if (
    typeof value["capabilityId"] !== "string" ||
    value["capabilityId"].length < 1 ||
    value["capabilityId"].length > 200
  ) {
    throw new Error("Sandbox RPC capability identifier is invalid.");
  }

  if (
    typeof value["method"] !== "string" ||
    value["method"].length < 1 ||
    value["method"].length > 100 ||
    !RPC_METHOD_PATTERN.test(value["method"])
  ) {
    throw new Error("Sandbox RPC method is invalid.");
  }

  if (!Array.isArray(value["args"])) {
    throw new Error("Sandbox RPC arguments must be an array.");
  }

  if (
    value["locatorChain"] !== undefined &&
    !Array.isArray(value["locatorChain"])
  ) {
    throw new Error("Sandbox RPC locator chain is invalid.");
  }

  return value as unknown as PlaywrightRpcRequest;
}
