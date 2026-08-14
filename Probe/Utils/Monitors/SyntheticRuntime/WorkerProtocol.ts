import crypto from "crypto";

export const SYNTHETIC_WORKER_PROTOCOL_VERSION: 1 = 1 as const;
export const SYNTHETIC_WORKER_START_MESSAGE_TYPE: "oneuptime.synthetic.start" =
  "oneuptime.synthetic.start" as const;
export const SYNTHETIC_WORKER_RESULT_MESSAGE_TYPE: "oneuptime.synthetic.result" =
  "oneuptime.synthetic.result" as const;

const MIN_NONCE_LENGTH: number = 16;
const MAX_NONCE_LENGTH: number = 200;
const MAX_ERROR_MESSAGE_LENGTH: number = 10_000;
const MAX_ERROR_STACK_LENGTH: number = 50_000;
const WORKER_NONCE_PATTERN: RegExp = /^[A-Za-z0-9_-]+$/;

export interface SyntheticWorkerStartEnvelope<Config> {
  readonly type: typeof SYNTHETIC_WORKER_START_MESSAGE_TYPE;
  readonly version: typeof SYNTHETIC_WORKER_PROTOCOL_VERSION;
  readonly nonce: string;
  readonly config: Config;
}

export interface SyntheticWorkerSuccessEnvelope<Result> {
  readonly type: typeof SYNTHETIC_WORKER_RESULT_MESSAGE_TYPE;
  readonly version: typeof SYNTHETIC_WORKER_PROTOCOL_VERSION;
  readonly nonce: string;
  readonly ok: true;
  readonly result: Result;
}

export interface SyntheticWorkerFailureEnvelope {
  readonly type: typeof SYNTHETIC_WORKER_RESULT_MESSAGE_TYPE;
  readonly version: typeof SYNTHETIC_WORKER_PROTOCOL_VERSION;
  readonly nonce: string;
  readonly ok: false;
  readonly error: {
    readonly message: string;
    readonly stack?: string | undefined;
  };
}

export type SyntheticWorkerResultEnvelope<Result> =
  | SyntheticWorkerSuccessEnvelope<Result>
  | SyntheticWorkerFailureEnvelope;

type ValueValidator<Value> = (value: unknown) => value is Value;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: ReadonlyArray<string>,
): boolean {
  const actualKeys: string[] = Object.keys(value).sort();
  const sortedExpectedKeys: string[] = [...expectedKeys].sort();

  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key: string, index: number) => {
      return key === sortedExpectedKeys[index];
    })
  );
}

export function isValidWorkerNonce(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= MIN_NONCE_LENGTH &&
    value.length <= MAX_NONCE_LENGTH &&
    WORKER_NONCE_PATTERN.test(value)
  );
}

export function createWorkerNonce(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function createWorkerStartEnvelope<Config>(data: {
  nonce: string;
  config: Config;
}): SyntheticWorkerStartEnvelope<Config> {
  if (!isValidWorkerNonce(data.nonce)) {
    throw new Error("Synthetic worker nonce is invalid.");
  }

  return {
    type: SYNTHETIC_WORKER_START_MESSAGE_TYPE,
    version: SYNTHETIC_WORKER_PROTOCOL_VERSION,
    nonce: data.nonce,
    config: data.config,
  };
}

export function isWorkerStartEnvelope<Config>(data: {
  value: unknown;
  validateConfig?: ValueValidator<Config> | undefined;
}): data is {
  value: SyntheticWorkerStartEnvelope<Config>;
  validateConfig?: ValueValidator<Config> | undefined;
} {
  if (!isRecord(data.value)) {
    return false;
  }

  if (!hasExactKeys(data.value, ["type", "version", "nonce", "config"])) {
    return false;
  }

  if (
    data.value["type"] !== SYNTHETIC_WORKER_START_MESSAGE_TYPE ||
    data.value["version"] !== SYNTHETIC_WORKER_PROTOCOL_VERSION ||
    !isValidWorkerNonce(data.value["nonce"])
  ) {
    return false;
  }

  return data.validateConfig ? data.validateConfig(data.value["config"]) : true;
}

export function createWorkerSuccessEnvelope<Result>(data: {
  nonce: string;
  result: Result;
}): SyntheticWorkerSuccessEnvelope<Result> {
  if (!isValidWorkerNonce(data.nonce)) {
    throw new Error("Synthetic worker nonce is invalid.");
  }

  return {
    type: SYNTHETIC_WORKER_RESULT_MESSAGE_TYPE,
    version: SYNTHETIC_WORKER_PROTOCOL_VERSION,
    nonce: data.nonce,
    ok: true,
    result: data.result,
  };
}

export function createWorkerFailureEnvelope(data: {
  nonce: string;
  error: unknown;
}): SyntheticWorkerFailureEnvelope {
  if (!isValidWorkerNonce(data.nonce)) {
    throw new Error("Synthetic worker nonce is invalid.");
  }

  const error: Error =
    data.error instanceof Error ? data.error : new Error(String(data.error));
  const stack: string | undefined = error.stack
    ? error.stack.substring(0, MAX_ERROR_STACK_LENGTH)
    : undefined;

  return {
    type: SYNTHETIC_WORKER_RESULT_MESSAGE_TYPE,
    version: SYNTHETIC_WORKER_PROTOCOL_VERSION,
    nonce: data.nonce,
    ok: false,
    error: {
      message: (error.message || "Synthetic worker failed.").substring(
        0,
        MAX_ERROR_MESSAGE_LENGTH,
      ),
      ...(stack ? { stack } : {}),
    },
  };
}

export function isWorkerResultEnvelope<Result>(data: {
  value: unknown;
  expectedNonce: string;
  validateResult?: ValueValidator<Result> | undefined;
}): data is {
  value: SyntheticWorkerResultEnvelope<Result>;
  expectedNonce: string;
  validateResult?: ValueValidator<Result> | undefined;
} {
  if (!isRecord(data.value)) {
    return false;
  }

  if (
    data.value["type"] !== SYNTHETIC_WORKER_RESULT_MESSAGE_TYPE ||
    data.value["version"] !== SYNTHETIC_WORKER_PROTOCOL_VERSION ||
    data.value["nonce"] !== data.expectedNonce ||
    !isValidWorkerNonce(data.value["nonce"])
  ) {
    return false;
  }

  if (data.value["ok"] === true) {
    if (
      !hasExactKeys(data.value, ["type", "version", "nonce", "ok", "result"])
    ) {
      return false;
    }

    return data.validateResult
      ? data.validateResult(data.value["result"])
      : true;
  }

  if (data.value["ok"] !== false) {
    return false;
  }

  if (
    !hasExactKeys(data.value, ["type", "version", "nonce", "ok", "error"]) ||
    !isRecord(data.value["error"])
  ) {
    return false;
  }

  const error: Record<string, unknown> = data.value["error"];
  const expectedErrorKeys: string[] =
    error["stack"] === undefined ? ["message"] : ["message", "stack"];

  return (
    hasExactKeys(error, expectedErrorKeys) &&
    typeof error["message"] === "string" &&
    error["message"].length > 0 &&
    error["message"].length <= MAX_ERROR_MESSAGE_LENGTH &&
    (error["stack"] === undefined ||
      (typeof error["stack"] === "string" &&
        error["stack"].length <= MAX_ERROR_STACK_LENGTH))
  );
}
