import { describe, expect, jest, test, beforeEach } from "@jest/globals";

/*
 * Contract under test — @CaptureSpan's export gating.
 *
 * The decorator wraps ~hundreds of methods, some of which sit on per-record
 * telemetry ingest paths. It must be a plain method call (no span, no
 * attribute flattening, no AsyncLocalStorage transition) whenever no span
 * exporter is installed — spans that are never exported are pure overhead —
 * and only build the attribute object when there is actually something to
 * attach. When an exporter IS installed it must keep the full original
 * behavior: named span, OK status on success, recorded exception + rethrow
 * on failure, for both sync and async methods.
 */

type JestMock = ReturnType<typeof jest.fn>;

type FakeSpan = {
  setStatus: JestMock;
  end: JestMock;
};

const fakeSpan: FakeSpan = {
  setStatus: jest.fn(),
  end: jest.fn(),
};

let spanExportEnabled: boolean = false;

const startActiveSpanMock: JestMock = jest.fn((data: any) => {
  return data.fn(fakeSpan);
});
const recordExceptionMock: JestMock = jest.fn();

jest.mock("../../../Server/Utils/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      isSpanExportEnabled: (): boolean => {
        return spanExportEnabled;
      },
      startActiveSpan: (data: unknown): unknown => {
        return startActiveSpanMock(data);
      },
      recordExceptionMarkSpanAsErrorAndEndSpan: (data: unknown): unknown => {
        return recordExceptionMock(data);
      },
      /*
       * CaptureSpan ends spans through Telemetry.endSpan rather than calling
       * span.end() directly, so that ending twice on the error path (the
       * recorder's finally, then the decorator's) is a no-op instead of an SDK
       * "You can only call end() on a span once" diagnostic. The real
       * implementation guards on the span's endTime; the fake just forwards.
       */
      endSpan: (span: { end: () => void }): void => {
        span.end();
      },
    },
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  return {
    ...actual,
    DisableTelemetry: false,
  };
});

import CaptureSpan from "../../../Server/Utils/Telemetry/CaptureSpan";

/*
 * Apply the decorator exactly the way TypeScript does for a static method,
 * without relying on decorator syntax support in the test transform.
 */
function decorate(
  data: Parameters<typeof CaptureSpan>[0] | undefined,
  fn: (...args: Array<any>) => any,
  methodName: string = "method",
): (...args: Array<any>) => any {
  class Host {}
  const descriptor: TypedPropertyDescriptor<any> = { value: fn };
  CaptureSpan(data)(Host, methodName, descriptor);
  return descriptor.value;
}

beforeEach(() => {
  spanExportEnabled = false;
  startActiveSpanMock.mockClear();
  recordExceptionMock.mockClear();
  fakeSpan.setStatus.mockClear();
  fakeSpan.end.mockClear();
});

describe("CaptureSpan with no span exporter installed", () => {
  test("calls the original method directly and creates no span", () => {
    const original: JestMock = jest.fn().mockReturnValue("result");
    const wrapped: (...args: Array<any>) => any = decorate(undefined, original);

    expect(wrapped("a", 1)).toBe("result");
    expect(original).toHaveBeenCalledWith("a", 1);
    expect(startActiveSpanMock).not.toHaveBeenCalled();
  });

  test("preserves `this` binding", () => {
    const wrapped: (...args: Array<any>) => any = decorate(
      undefined,
      function (this: { value: number }): number {
        return this.value;
      },
    );

    expect(wrapped.call({ value: 42 })).toBe(42);
  });

  test("async results and rejections pass through untouched", async () => {
    const wrappedOk: (...args: Array<any>) => any = decorate(
      undefined,
      async (): Promise<string> => {
        return "async-result";
      },
    );
    await expect(wrappedOk()).resolves.toBe("async-result");

    const boom: Error = new Error("boom");
    const wrappedFail: (...args: Array<any>) => any = decorate(
      undefined,
      async (): Promise<never> => {
        throw boom;
      },
    );
    await expect(wrappedFail()).rejects.toBe(boom);
    expect(startActiveSpanMock).not.toHaveBeenCalled();
  });

  test("sync throws pass through untouched", () => {
    const boom: Error = new Error("sync-boom");
    const wrapped: (...args: Array<any>) => any = decorate(undefined, () => {
      throw boom;
    });

    expect(() => {
      return wrapped();
    }).toThrow(boom);
    expect(startActiveSpanMock).not.toHaveBeenCalled();
  });
});

describe("CaptureSpan with a span exporter installed", () => {
  beforeEach(() => {
    spanExportEnabled = true;
  });

  test("creates a span named Class.method and returns the result", () => {
    const wrapped: (...args: Array<any>) => any = decorate(
      undefined,
      () => {
        return "spanned";
      },
      "doWork",
    );

    expect(wrapped()).toBe("spanned");
    expect(startActiveSpanMock).toHaveBeenCalledTimes(1);

    const callData: any = startActiveSpanMock.mock.calls[0]![0];
    expect(callData.name).toBe("Host.doWork");
    expect(fakeSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // OK
    expect(fakeSpan.end).toHaveBeenCalledTimes(1);
  });

  test("bare @CaptureSpan() attaches no attributes (flattening skipped)", () => {
    const wrapped: (...args: Array<any>) => any = decorate(undefined, () => {
      return "x";
    });
    wrapped("argument-that-must-not-be-captured");

    const callData: any = startActiveSpanMock.mock.calls[0]![0];
    expect(callData.options).toEqual({});
  });

  test("captureArguments flattens call arguments into span attributes", () => {
    const wrapped: (...args: Array<any>) => any = decorate(
      { captureArguments: true },
      () => {
        return "x";
      },
    );
    wrapped("first", { nested: { key: "v" } });

    const callData: any = startActiveSpanMock.mock.calls[0]![0];
    expect(callData.options.attributes["arg0"]).toBe("first");
    expect(callData.options.attributes["arg1.nested.key"]).toBe("v");
  });

  test("static attributes are attached", () => {
    const wrapped: (...args: Array<any>) => any = decorate(
      { attributes: { component: "test" } },
      () => {
        return "x";
      },
    );
    wrapped();

    const callData: any = startActiveSpanMock.mock.calls[0]![0];
    expect(callData.options.attributes["component"]).toBe("test");
  });

  test("async success marks the span OK and ends it", async () => {
    const wrapped: (...args: Array<any>) => any = decorate(
      undefined,
      async (): Promise<string> => {
        return "ok";
      },
    );

    await expect(wrapped()).resolves.toBe("ok");
    expect(fakeSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
    expect(fakeSpan.end).toHaveBeenCalledTimes(1);
  });

  test("async failure records the exception, rethrows, and ends the span", async () => {
    const boom: Error = new Error("async-span-boom");
    const wrapped: (...args: Array<any>) => any = decorate(
      undefined,
      async (): Promise<never> => {
        throw boom;
      },
    );

    await expect(wrapped()).rejects.toBe(boom);
    expect(recordExceptionMock).toHaveBeenCalledTimes(1);
    expect(recordExceptionMock.mock.calls[0]![0]).toMatchObject({
      exception: boom,
    });
    expect(fakeSpan.end).toHaveBeenCalledTimes(1);
  });

  test("sync failure records the exception and rethrows", () => {
    const boom: Error = new Error("sync-span-boom");
    const wrapped: (...args: Array<any>) => any = decorate(undefined, () => {
      throw boom;
    });

    expect(() => {
      return wrapped();
    }).toThrow(boom);
    expect(recordExceptionMock).toHaveBeenCalledTimes(1);
  });
});

describe("export flag is consulted at call time, not decoration time", () => {
  /*
   * Decorators run at class-definition (import) time, long before
   * Telemetry.init() installs an exporter and flips the flag. If the wrapper
   * captured the flag when it was applied instead of reading it per call,
   * every span in the process would be silently lost — decoration always
   * happens while the flag is still false.
   */
  test("a method decorated before the exporter exists starts spanning once export turns on", () => {
    const wrapped: (...args: Array<any>) => any = decorate(undefined, () => {
      return "x";
    });

    expect(wrapped()).toBe("x");
    expect(startActiveSpanMock).not.toHaveBeenCalled();

    spanExportEnabled = true;
    expect(wrapped()).toBe("x");
    expect(startActiveSpanMock).toHaveBeenCalledTimes(1);
  });

  test("a method decorated while export was on drops to passthrough when it turns off", () => {
    spanExportEnabled = true;
    const wrapped: (...args: Array<any>) => any = decorate(undefined, () => {
      return "y";
    });

    expect(wrapped()).toBe("y");
    expect(startActiveSpanMock).toHaveBeenCalledTimes(1);

    spanExportEnabled = false;
    expect(wrapped()).toBe("y");
    expect(startActiveSpanMock).toHaveBeenCalledTimes(1);
  });
});

describe("Telemetry.isSpanExportEnabled (real module)", () => {
  test("defaults to false before init installs a trace exporter", () => {
    const RealTelemetry: any = (
      jest.requireActual("../../../Server/Utils/Telemetry") as any
    ).default;

    expect(RealTelemetry.isSpanExportEnabled()).toBe(false);
  });
});

/*
 * THE MULTI-FRAME CONTRACT.
 *
 * One thrown error propagates through every decorated frame on its way out,
 * and each frame's catch calls the recorder on its OWN span. Nothing here
 * deduplicates — the report-once marker lives inside the recorder, where it
 * can be asserted against real exception events (see
 * Tests/Server/Utils/Telemetry.test.ts). What this file pins is the shape the
 * recorder depends on: N frames means N recorder calls carrying the SAME
 * object identity, and every frame still ends its own span exactly once.
 *
 * Nothing covered this before, which is why the N-fold occuranceCount
 * inflation shipped.
 */
describe("CaptureSpan across nested frames", () => {
  beforeEach(() => {
    spanExportEnabled = true;
  });

  test("an error crossing three frames reaches the recorder three times, as one object", () => {
    const boom: Error = new Error("one failure, three frames");

    const inner: (...args: Array<any>) => any = decorate(
      undefined,
      () => {
        throw boom;
      },
      "inner",
    );
    const middle: (...args: Array<any>) => any = decorate(
      undefined,
      () => {
        return inner();
      },
      "middle",
    );
    const outer: (...args: Array<any>) => any = decorate(
      undefined,
      () => {
        return middle();
      },
      "outer",
    );

    expect(() => {
      return outer();
    }).toThrow(boom);

    expect(recordExceptionMock).toHaveBeenCalledTimes(3);

    /*
     * Identity, not equality. The report-once marker is a non-enumerable
     * symbol written onto the thrown value itself, so it only works if every
     * frame sees the very same object — a wrapped or copied error would
     * report N times again.
     */
    for (const call of recordExceptionMock.mock.calls) {
      expect((call[0] as { exception: unknown }).exception).toBe(boom);
    }

    // Three spans created, three ended. No double-end, no leak.
    expect(startActiveSpanMock).toHaveBeenCalledTimes(3);
    expect(fakeSpan.end).toHaveBeenCalledTimes(3);
  });

  test("the same holds for async frames", async () => {
    const boom: Error = new Error("async, three frames");

    const inner: (...args: Array<any>) => any = decorate(
      undefined,
      async (): Promise<never> => {
        throw boom;
      },
      "inner",
    );
    const middle: (...args: Array<any>) => any = decorate(
      undefined,
      async (): Promise<unknown> => {
        return inner();
      },
      "middle",
    );
    const outer: (...args: Array<any>) => any = decorate(
      undefined,
      async (): Promise<unknown> => {
        return middle();
      },
      "outer",
    );

    await expect(outer()).rejects.toBe(boom);

    expect(recordExceptionMock).toHaveBeenCalledTimes(3);
    expect(fakeSpan.end).toHaveBeenCalledTimes(3);
  });

  /*
   * A span that already carries an ERROR must not be downgraded to OK. That is
   * reachable whenever a decorated method swallows an error and signals
   * failure another way — Express middleware calling next(err) is the case
   * that actually occurs — because the decorator then sees a normal return.
   * The SDK's own setStatus guard does not help: it only early-returns when
   * the CURRENT status is already OK.
   */
  test("a success return does not overwrite an ERROR status set from inside", () => {
    const erroredSpan: FakeSpan & { status?: { code: number } } = {
      setStatus: jest.fn(),
      end: jest.fn(),
      status: { code: 2 }, // SpanStatusCode.ERROR
    };

    startActiveSpanMock.mockImplementationOnce((data: any) => {
      return data.fn(erroredSpan);
    });

    const wrapped: (...args: Array<any>) => any = decorate(undefined, () => {
      return "swallowed the error and returned normally";
    });

    wrapped();

    expect(erroredSpan.setStatus).not.toHaveBeenCalled();
  });

  test("a span with no observable status is still marked OK", () => {
    const wrapped: (...args: Array<any>) => any = decorate(undefined, () => {
      return "fine";
    });

    wrapped();

    expect(fakeSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
  });
});
