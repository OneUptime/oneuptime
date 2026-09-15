import {
  MAX_ERROR_INTERNAL_DETAIL_LENGTH,
  SYNTHETIC_WORKER_PROTOCOL_VERSION,
  SyntheticWorkerFailureEnvelope,
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

interface DetailValueCase {
  readonly name: string;
  readonly internalDetail: unknown;
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

/*
 * A failure envelope whose error object is written by hand: the shapes a
 * buggy or compromised worker could send, which createWorkerFailureEnvelope
 * itself never produces.
 */
function forgedFailureEnvelope(
  nonce: string,
  error: Record<string, unknown>,
): unknown {
  return {
    ...createWorkerFailureEnvelope({ nonce, error: new Error("boom") }),
    error,
  };
}

function isValidFailureFor(nonce: string, value: unknown): boolean {
  return isWorkerResultEnvelope({ value, expectedNonce: nonce });
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

  /*
   * A bootstrap that stalled used to reach the probe's logs as nothing but
   * the fault's own stack: WorkerController, and not a word about which step
   * stalled or what Playwright said. The worker's diagnosis now crosses the
   * fork beside the tenant-facing message -- never inside it, and only on a
   * runtime fault.
   */
  describe("a runtime fault's internal detail", () => {
    const TENANT_MESSAGE: string =
      "Synthetic monitor could not start on this probe.";
    const BOOTSTRAP_DIAGNOSIS: string = [
      "Bootstrap attempt 1/3 failed after 20004 ms of its 20000 ms budget. Reached: page opened, route installed, binding installed, navigation started. Error: page.goto: Timeout 20000ms exceeded.",
      "Bootstrap attempt 2/3 failed after 20002 ms of its 20000 ms budget. Reached: page opened. Error: page.route did not settle within the attempt deadline.",
      "Last error: page.goto: Timeout 20000ms exceeded.\n    at https://synthetic-runtime.oneuptime.invalid/3f0c9d",
    ].join("\n");

    const nonStringDetails: Array<DetailValueCase> = [
      { name: "a number", internalDetail: 42 },
      { name: "an object", internalDetail: { callLog: BOOTSTRAP_DIAGNOSIS } },
      { name: "an array", internalDetail: [BOOTSTRAP_DIAGNOSIS] },
      { name: "a boolean", internalDetail: true },
      { name: "null", internalDetail: null },
    ];

    test("round-trips through the failure envelope beside the message", () => {
      const nonce: string = createWorkerNonce();
      const envelope: SyntheticWorkerFailureEnvelope =
        createWorkerFailureEnvelope({
          nonce,
          error: new SyntheticRuntimeFault({
            message: TENANT_MESSAGE,
            internalDetail: BOOTSTRAP_DIAGNOSIS,
          }),
        });

      expect(Object.keys(envelope.error).sort()).toEqual([
        "internalDetail",
        "kind",
        "message",
        "stack",
      ]);
      expect(envelope.error.internalDetail).toBe(BOOTSTRAP_DIAGNOSIS);
      expect(envelope.error.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
      expect(envelope.error.message).toBe(TENANT_MESSAGE);
      expect(envelope.error.stack).not.toContain("Bootstrap attempt");

      /*
       * fork() IPC serializes the envelope as JSON, so what the supervisor
       * validates is a parsed copy, not this object.
       */
      const received: unknown = JSON.parse(JSON.stringify(envelope));
      expect(isValidFailureFor(nonce, received)).toBe(true);
      expect(received).toEqual(envelope);
    });

    test("carries the stack of the Playwright error a fault wraps", () => {
      const nonce: string = createWorkerNonce();
      const playwrightError: Error = new Error(
        "browserType.launch: Failed to launch chromium because executable doesn't exist at /playwright/chromium",
      );
      const envelope: SyntheticWorkerFailureEnvelope =
        createWorkerFailureEnvelope({
          nonce,
          error: new SyntheticRuntimeFault({
            message:
              "Synthetic monitor could not start on this probe: the Chromium browser did not start.",
            internalDetail: playwrightError,
          }),
        });

      expect(envelope.error.internalDetail).toBe(playwrightError.stack);
      expect(envelope.error.internalDetail).toContain(
        "browserType.launch: Failed to launch chromium",
      );
      expect(envelope.error.message).not.toContain("browserType.launch");
      expect(isValidFailureFor(nonce, envelope)).toBe(true);
    });

    test("is truncated to MAX_ERROR_INTERNAL_DETAIL_LENGTH so the envelope stays valid", () => {
      /*
       * A Playwright call log has no natural bound. Sent whole, it would push
       * the worker's own failure report past the validator's limit, and the
       * supervisor would discard the envelope -- fault marker and all -- as a
       * protocol violation.
       */
      const nonce: string = createWorkerNonce();
      const oversizedDetail: string = `${BOOTSTRAP_DIAGNOSIS}\n${"call log: waiting for navigation\n".repeat(
        Math.ceil(MAX_ERROR_INTERNAL_DETAIL_LENGTH / 10),
      )}`;
      const envelope: SyntheticWorkerFailureEnvelope =
        createWorkerFailureEnvelope({
          nonce,
          error: new SyntheticRuntimeFault({
            message: TENANT_MESSAGE,
            internalDetail: oversizedDetail,
          }),
        });

      expect(oversizedDetail.length).toBeGreaterThan(
        MAX_ERROR_INTERNAL_DETAIL_LENGTH,
      );
      expect(envelope.error.internalDetail).toHaveLength(
        MAX_ERROR_INTERNAL_DETAIL_LENGTH,
      );
      expect(envelope.error.internalDetail).toBe(
        oversizedDetail.substring(0, MAX_ERROR_INTERNAL_DETAIL_LENGTH),
      );
      expect(envelope.error.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
      expect(isValidFailureFor(nonce, envelope)).toBe(true);
    });

    test("is kept whole at exactly MAX_ERROR_INTERNAL_DETAIL_LENGTH", () => {
      const nonce: string = createWorkerNonce();
      const detail: string = "d".repeat(MAX_ERROR_INTERNAL_DETAIL_LENGTH);
      const envelope: SyntheticWorkerFailureEnvelope =
        createWorkerFailureEnvelope({
          nonce,
          error: new SyntheticRuntimeFault({
            message: TENANT_MESSAGE,
            internalDetail: detail,
          }),
        });

      expect(envelope.error.internalDetail).toBe(detail);
      expect(isValidFailureFor(nonce, envelope)).toBe(true);
    });

    test("is left off an ordinary Error, even one that carries the property", () => {
      /*
       * The validator rejects a detail with no fault to describe, so putting
       * one on an ordinary failure would turn a readable worker error into a
       * protocol violation. An ordinary failure's detail is its stack, which
       * already travels in the message.
       */
      const nonce: string = createWorkerNonce();
      const envelope: SyntheticWorkerFailureEnvelope =
        createWorkerFailureEnvelope({
          nonce,
          error: Object.assign(
            new Error("TypeError: page.clickk is not a function"),
            { internalDetail: "not a diagnosis the worker vouched for" },
          ),
        });

      expect(Object.keys(envelope.error).sort()).toEqual(["message", "stack"]);
      expect(JSON.stringify(envelope)).not.toContain(
        "not a diagnosis the worker vouched for",
      );
      expect(isValidFailureFor(nonce, envelope)).toBe(true);
    });

    const missingDetails: Array<DetailValueCase> = [
      { name: "no detail at all", internalDetail: undefined },
      { name: "a null detail", internalDetail: null },
      { name: "an empty detail", internalDetail: "" },
    ];

    test.each(missingDetails)(
      "is left off a fault with $name",
      ({ internalDetail }: DetailValueCase) => {
        const nonce: string = createWorkerNonce();
        const envelope: SyntheticWorkerFailureEnvelope =
          createWorkerFailureEnvelope({
            nonce,
            error: new SyntheticRuntimeFault({
              message: TENANT_MESSAGE,
              internalDetail,
            }),
          });

        expect(Object.keys(envelope.error).sort()).toEqual([
          "kind",
          "message",
          "stack",
        ]);
        expect(isValidFailureFor(nonce, envelope)).toBe(true);
      },
    );

    test.each(nonStringDetails)(
      "is left off a kind-shaped Error whose detail is $name",
      ({ internalDetail }: DetailValueCase) => {
        /*
         * isSyntheticRuntimeFault is structural, so anything with the right
         * `kind` is treated as a fault -- including an error whose detail is
         * not text. Sending that detail would get the whole envelope rejected;
         * dropping it keeps the fault marker and the message.
         */
        const nonce: string = createWorkerNonce();
        const envelope: SyntheticWorkerFailureEnvelope =
          createWorkerFailureEnvelope({
            nonce,
            error: Object.assign(new Error(TENANT_MESSAGE), {
              kind: SYNTHETIC_RUNTIME_FAULT_KIND,
              internalDetail,
            }),
          });

        expect(envelope.error.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
        expect(envelope.error.message).toBe(TENANT_MESSAGE);
        expect(Object.keys(envelope.error).sort()).toEqual([
          "kind",
          "message",
          "stack",
        ]);
        expect(isValidFailureFor(nonce, envelope)).toBe(true);
      },
    );

    test("is left off a plain kind-shaped object whose detail is not a string", () => {
      const nonce: string = createWorkerNonce();
      const envelope: SyntheticWorkerFailureEnvelope =
        createWorkerFailureEnvelope({
          nonce,
          error: {
            kind: SYNTHETIC_RUNTIME_FAULT_KIND,
            message: TENANT_MESSAGE,
            internalDetail: { callLog: BOOTSTRAP_DIAGNOSIS },
          },
        });

      expect(envelope.error.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
      expect(envelope.error.internalDetail).toBeUndefined();
      expect(JSON.stringify(envelope)).not.toContain("Bootstrap attempt");
      expect(isValidFailureFor(nonce, envelope)).toBe(true);
    });

    test("is accepted on a marked envelope that has no stack, up to the maximum length", () => {
      const nonce: string = createWorkerNonce();

      expect(
        isValidFailureFor(
          nonce,
          forgedFailureEnvelope(nonce, {
            message: TENANT_MESSAGE,
            kind: SYNTHETIC_RUNTIME_FAULT_KIND,
            internalDetail: BOOTSTRAP_DIAGNOSIS,
          }),
        ),
      ).toBe(true);
      expect(
        isValidFailureFor(
          nonce,
          forgedFailureEnvelope(nonce, {
            message: TENANT_MESSAGE,
            kind: SYNTHETIC_RUNTIME_FAULT_KIND,
            internalDetail: "d".repeat(MAX_ERROR_INTERNAL_DETAIL_LENGTH),
          }),
        ),
      ).toBe(true);
    });

    test("is rejected on an envelope without a kind", () => {
      /*
       * A diagnosis with no fault to describe is malformed, not merely
       * redundant: an ordinary failure's detail belongs in its message.
       */
      const nonce: string = createWorkerNonce();

      expect(
        isValidFailureFor(
          nonce,
          forgedFailureEnvelope(nonce, {
            message: "worker failed",
            stack: "Error: worker failed",
            internalDetail: BOOTSTRAP_DIAGNOSIS,
          }),
        ),
      ).toBe(false);
      expect(
        isValidFailureFor(
          nonce,
          forgedFailureEnvelope(nonce, {
            message: "worker failed",
            internalDetail: BOOTSTRAP_DIAGNOSIS,
          }),
        ),
      ).toBe(false);
    });

    test.each(nonStringDetails)(
      "is rejected when it is $name rather than a string",
      ({ internalDetail }: DetailValueCase) => {
        const nonce: string = createWorkerNonce();

        expect(
          isValidFailureFor(
            nonce,
            forgedFailureEnvelope(nonce, {
              message: TENANT_MESSAGE,
              kind: SYNTHETIC_RUNTIME_FAULT_KIND,
              internalDetail,
            }),
          ),
        ).toBe(false);
      },
    );

    test("is rejected over MAX_ERROR_INTERNAL_DETAIL_LENGTH", () => {
      const nonce: string = createWorkerNonce();

      expect(
        isValidFailureFor(
          nonce,
          forgedFailureEnvelope(nonce, {
            message: TENANT_MESSAGE,
            kind: SYNTHETIC_RUNTIME_FAULT_KIND,
            internalDetail: "d".repeat(MAX_ERROR_INTERNAL_DETAIL_LENGTH + 1),
          }),
        ),
      ).toBe(false);
    });

    test("is rejected when empty, which the worker's own envelope never is", () => {
      /*
       * An empty diagnosis is a key with nothing behind it. The worker never
       * sends one -- createWorkerFailureEnvelope drops an empty detail even
       * when the fault carries it -- so an envelope that has one did not come
       * from this protocol's code, and it is malformed like any other bad
       * field. The supervisor discards a malformed envelope whole.
       */
      const nonce: string = createWorkerNonce();
      const fault: SyntheticRuntimeFault = new SyntheticRuntimeFault({
        message: TENANT_MESSAGE,
        internalDetail: "",
      });
      expect(fault.internalDetail).toBe("");

      const envelope: SyntheticWorkerFailureEnvelope =
        createWorkerFailureEnvelope({ nonce, error: fault });
      expect(envelope.error.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
      expect(Object.keys(envelope.error)).not.toContain("internalDetail");
      expect(isValidFailureFor(nonce, envelope)).toBe(true);

      expect(
        isValidFailureFor(
          nonce,
          forgedFailureEnvelope(nonce, {
            message: TENANT_MESSAGE,
            kind: SYNTHETIC_RUNTIME_FAULT_KIND,
            internalDetail: "",
          }),
        ),
      ).toBe(false);
      expect(
        isValidFailureFor(
          nonce,
          forgedFailureEnvelope(nonce, {
            message: TENANT_MESSAGE,
            stack: `SyntheticRuntimeFault: ${TENANT_MESSAGE}`,
            kind: SYNTHETIC_RUNTIME_FAULT_KIND,
            internalDetail: "",
          }),
        ),
      ).toBe(false);
    });

    test("does not open the error object to unknown keys", () => {
      /*
       * Allowing one more optional key must not have loosened the exact-key
       * check that stops a worker smuggling arbitrary fields to the supervisor.
       */
      const nonce: string = createWorkerNonce();
      const forgedErrors: Array<Record<string, unknown>> = [
        {
          message: TENANT_MESSAGE,
          kind: SYNTHETIC_RUNTIME_FAULT_KIND,
          internalDetail: BOOTSTRAP_DIAGNOSIS,
          unexpected: true,
        },
        {
          message: TENANT_MESSAGE,
          stack: "SyntheticRuntimeFault: forged",
          kind: SYNTHETIC_RUNTIME_FAULT_KIND,
          internalDetail: BOOTSTRAP_DIAGNOSIS,
          callLog: BOOTSTRAP_DIAGNOSIS,
        },
        {
          message: TENANT_MESSAGE,
          kind: SYNTHETIC_RUNTIME_FAULT_KIND,
          internaldetail: BOOTSTRAP_DIAGNOSIS,
        },
      ];

      for (const forgedError of forgedErrors) {
        expect(
          isValidFailureFor(nonce, forgedFailureEnvelope(nonce, forgedError)),
        ).toBe(false);
      }
    });
  });
});
