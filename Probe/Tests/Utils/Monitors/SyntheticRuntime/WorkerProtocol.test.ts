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
import SyntheticRuntimeFault, {
  SYNTHETIC_RUNTIME_FAULT_KIND,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticRuntimeFault";

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

  /*
   * The worker raises the fault; the supervisor has to be able to tell it
   * apart from the tenant's script failing. The Error object does not survive
   * the fork, so the marker travels on the envelope.
   */
  test("marks a probe runtime fault on the failure envelope", () => {
    const nonce: string = createWorkerNonce();
    const envelope: ReturnType<typeof createWorkerFailureEnvelope> =
      createWorkerFailureEnvelope({
        nonce,
        error: new SyntheticRuntimeFault({
          message: "Synthetic monitor could not start on this probe.",
          internalDetail: new Error("page.goto: Timeout 30000ms exceeded."),
        }),
      });

    expect(envelope.ok).toBe(false);
    expect(envelope.error.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
    expect(envelope.error.message).toBe(
      "Synthetic monitor could not start on this probe.",
    );
    expect(
      isWorkerResultEnvelope({ value: envelope, expectedNonce: nonce }),
    ).toBe(true);
  });

  test("leaves the marker off a tenant script failure", () => {
    const nonce: string = createWorkerNonce();
    const envelope: ReturnType<typeof createWorkerFailureEnvelope> =
      createWorkerFailureEnvelope({
        nonce,
        error: new Error("TypeError: page.clickk is not a function"),
      });

    expect(envelope.error.kind).toBeUndefined();
    expect(Object.keys(envelope.error).sort()).toEqual(["message", "stack"]);
    expect(
      isWorkerResultEnvelope({ value: envelope, expectedNonce: nonce }),
    ).toBe(true);
  });

  test("does not carry the fault's internal detail across the boundary", () => {
    /*
     * internalDetail is for the probe's own logs on this side of the fork.
     * The envelope carries only what the supervisor needs.
     */
    const nonce: string = createWorkerNonce();
    const envelope: ReturnType<typeof createWorkerFailureEnvelope> =
      createWorkerFailureEnvelope({
        nonce,
        error: new SyntheticRuntimeFault({
          message: "Synthetic monitor could not start on this probe.",
          internalDetail: "a very long playwright call log",
        }),
      });

    expect(Object.keys(envelope.error).sort()).toEqual([
      "kind",
      "message",
      "stack",
    ]);
  });

  test("rejects an envelope carrying an unknown error kind", () => {
    const nonce: string = createWorkerNonce();
    const forged: unknown = {
      ...createWorkerFailureEnvelope({ nonce, error: new Error("boom") }),
      error: { message: "boom", kind: "tenant-fault" },
    };

    expect(
      isWorkerResultEnvelope({ value: forged, expectedNonce: nonce }),
    ).toBe(false);
  });

  test("accepts a marked envelope that has no stack", () => {
    const nonce: string = createWorkerNonce();
    const envelope: unknown = {
      ...createWorkerFailureEnvelope({ nonce, error: new Error("boom") }),
      error: {
        message: "Synthetic monitor could not start on this probe.",
        kind: SYNTHETIC_RUNTIME_FAULT_KIND,
      },
    };

    expect(
      isWorkerResultEnvelope({ value: envelope, expectedNonce: nonce }),
    ).toBe(true);
  });
});
