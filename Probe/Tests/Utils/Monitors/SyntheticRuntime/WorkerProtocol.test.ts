import {
  SYNTHETIC_WORKER_PROTOCOL_VERSION,
  SyntheticWorkerSuccessEnvelope,
  createWorkerFailureEnvelope,
  createWorkerNonce,
  createWorkerStartEnvelope,
  createWorkerSuccessEnvelope,
  isValidWorkerNonce,
  isWorkerResultEnvelope,
  isWorkerStartEnvelope,
} from "../../../../Utils/Monitors/SyntheticRuntime/WorkerProtocol";

interface TestConfig {
  readonly monitorId: string;
}

interface TestResult {
  readonly output: string;
}

function isTestConfig(value: unknown): value is TestConfig {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<string, unknown>)["monitorId"] === "monitor-1",
  );
}

function isTestResult(value: unknown): value is TestResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>)["output"] === "string",
  );
}

describe("SyntheticRuntime WorkerProtocol", () => {
  test("creates a nonce-bound generic start envelope", () => {
    const nonce: string = createWorkerNonce();
    const validation: {
      value: unknown;
      validateConfig: typeof isTestConfig;
    } = {
      value: createWorkerStartEnvelope<TestConfig>({
        nonce,
        config: { monitorId: "monitor-1" },
      }),
      validateConfig: isTestConfig,
    };

    expect(isValidWorkerNonce(nonce)).toBe(true);
    expect(isWorkerStartEnvelope<TestConfig>(validation)).toBe(true);

    if (!isWorkerStartEnvelope<TestConfig>(validation)) {
      throw new Error("Expected a valid start envelope.");
    }

    expect(validation.value.version).toBe(SYNTHETIC_WORKER_PROTOCOL_VERSION);
    expect(validation.value.nonce).toBe(nonce);
    expect(validation.value.config.monitorId).toBe("monitor-1");
  });

  test("rejects start envelopes with extra fields or an invalid config", () => {
    const nonce: string = createWorkerNonce();

    expect(
      isWorkerStartEnvelope<TestConfig>({
        value: {
          ...createWorkerStartEnvelope({
            nonce,
            config: { monitorId: "monitor-1" },
          }),
          unexpected: true,
        },
        validateConfig: isTestConfig,
      }),
    ).toBe(false);

    expect(
      isWorkerStartEnvelope<TestConfig>({
        value: createWorkerStartEnvelope({
          nonce,
          config: { monitorId: "wrong-monitor" },
        }),
        validateConfig: isTestConfig,
      }),
    ).toBe(false);
  });

  test("accepts exactly shaped success and failure results", () => {
    const nonce: string = createWorkerNonce();
    const successValidation: {
      value: unknown;
      expectedNonce: string;
      validateResult: typeof isTestResult;
    } = {
      value: createWorkerSuccessEnvelope<TestResult>({
        nonce,
        result: { output: "ok" },
      }),
      expectedNonce: nonce,
      validateResult: isTestResult,
    };

    expect(isWorkerResultEnvelope<TestResult>(successValidation)).toBe(true);

    const failureValidation: {
      value: unknown;
      expectedNonce: string;
    } = {
      value: createWorkerFailureEnvelope({
        nonce,
        error: new Error("worker failed"),
      }),
      expectedNonce: nonce,
    };

    expect(isWorkerResultEnvelope<TestResult>(failureValidation)).toBe(true);
  });

  test("rejects a result with the wrong nonce, schema, or payload", () => {
    const nonce: string = createWorkerNonce();
    const success: SyntheticWorkerSuccessEnvelope<TestResult> =
      createWorkerSuccessEnvelope({
        nonce,
        result: { output: "ok" },
      });

    expect(
      isWorkerResultEnvelope<TestResult>({
        value: success,
        expectedNonce: createWorkerNonce(),
        validateResult: isTestResult,
      }),
    ).toBe(false);

    expect(
      isWorkerResultEnvelope<TestResult>({
        value: { ...success, unexpected: true },
        expectedNonce: nonce,
        validateResult: isTestResult,
      }),
    ).toBe(false);

    expect(
      isWorkerResultEnvelope<TestResult>({
        value: createWorkerSuccessEnvelope({
          nonce,
          result: { notOutput: true },
        }),
        expectedNonce: nonce,
        validateResult: isTestResult,
      }),
    ).toBe(false);
  });

  test("rejects invalid nonces before sending", () => {
    expect(() => {
      return createWorkerStartEnvelope({ nonce: "short", config: {} });
    }).toThrow("nonce is invalid");

    expect(() => {
      return createWorkerSuccessEnvelope({
        nonce: "spaces are invalid",
        result: {},
      });
    }).toThrow("nonce is invalid");
  });
});
