import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span } from "@opentelemetry/sdk-trace-base";
import ContextSpanProcessor from "../../../../Server/Utils/Telemetry/ContextSpanProcessor";
import TelemetryContext from "../../../../Server/Utils/Telemetry/TelemetryContext";

/*
 * This processor runs on the creation of EVERY span in every OneUptime
 * process. That is what makes it useful - it is how projectId and userId
 * reach the ~1958 attribute-less @CaptureSpan spans without touching any of
 * those call sites - and it is also what makes it dangerous.
 *
 * Two properties follow.
 *
 *   IT MUST NEVER THROW. onStart sits inside the OpenTelemetry SDK's tracer,
 *   on the hot path of every traced operation in the product. An exception
 *   escaping it does not lose a span, it fails the OPERATION the span was
 *   describing - telemetry taking down the thing it was watching. The
 *   swallow-everything catch is the point of the file, so the tests drive it
 *   with a context that throws and a span that throws.
 *
 *   IT MUST NOT WRITE undefined. A context attribute that is absent has to
 *   stay absent rather than being stamped as a literal `undefined`, which is
 *   both a wasted attribute slot on every span and a value that reads, on a
 *   dashboard, as though the identifier were known to be empty.
 */

interface RecordedAttribute {
  key: string;
  value: unknown;
}

interface FakeSpan {
  attributes: Array<RecordedAttribute>;
}

type BuildSpanFunction = (options?: { throwOnSet?: boolean }) => {
  span: Span;
  recorded: Array<RecordedAttribute>;
};

const buildSpan: BuildSpanFunction = (options?: {
  throwOnSet?: boolean;
}): { span: Span; recorded: Array<RecordedAttribute> } => {
  const recorded: Array<RecordedAttribute> = [];

  const span: FakeSpan & {
    setAttribute: (key: string, value: unknown) => void;
  } = {
    attributes: recorded,
    setAttribute: (key: string, value: unknown): void => {
      if (options?.throwOnSet) {
        throw new Error("span is already ended");
      }
      recorded.push({ key: key, value: value });
    },
  };

  return { span: span as unknown as Span, recorded: recorded };
};

const EMPTY_CONTEXT: Context = {} as Context;

type StartInContextFunction = (
  attributes: Record<string, string | number | boolean>,
  options?: { throwOnSet?: boolean },
) => Array<RecordedAttribute>;

const startInContext: StartInContextFunction = (
  attributes: Record<string, string | number | boolean>,
  options?: { throwOnSet?: boolean },
): Array<RecordedAttribute> => {
  const built: { span: Span; recorded: Array<RecordedAttribute> } =
    buildSpan(options);

  TelemetryContext.runWithContext(attributes, (): void => {
    new ContextSpanProcessor().onStart(built.span, EMPTY_CONTEXT);
  });

  return built.recorded;
};

describe("the ambient context is stamped onto every span", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("copies the tenant identifiers of the enclosing scope", () => {
    const recorded: Array<RecordedAttribute> = startInContext({
      projectId: "project-1",
      userId: "user-1",
    });

    expect(recorded).toEqual(
      expect.arrayContaining([
        { key: "projectId", value: "project-1" },
        { key: "userId", value: "user-1" },
      ]),
    );
  });

  test("copies numbers and booleans without coercing them to strings", () => {
    const recorded: Array<RecordedAttribute> = startInContext({
      retryCount: 3,
      isRetry: true,
    });

    expect(recorded).toEqual(
      expect.arrayContaining([
        { key: "retryCount", value: 3 },
        { key: "isRetry", value: true },
      ]),
    );
  });

  /*
   * Zero and false are real values. A truthiness check instead of an
   * undefined check would silently drop exactly the attributes an operator
   * most wants to filter on - "the runs where retryCount is 0".
   */
  test("copies zero and false, which a truthiness check would have dropped", () => {
    const recorded: Array<RecordedAttribute> = startInContext({
      retryCount: 0,
      isRetry: false,
      emptyLabel: "",
    });

    expect(recorded).toEqual(
      expect.arrayContaining([
        { key: "retryCount", value: 0 },
        { key: "isRetry", value: false },
        { key: "emptyLabel", value: "" },
      ]),
    );
  });

  test("writes nothing at all when there is no ambient scope", () => {
    const built: { span: Span; recorded: Array<RecordedAttribute> } =
      buildSpan();

    new ContextSpanProcessor().onStart(built.span, EMPTY_CONTEXT);

    expect(built.recorded).toEqual([]);
  });

  test("writes nothing when the scope is empty", () => {
    expect(startInContext({})).toEqual([]);
  });

  /*
   * An absent identifier must stay absent. Stamping a literal `undefined`
   * wastes an attribute slot on every span and, on a dashboard, reads as
   * though the identifier were known to be empty.
   */
  test("never stamps an undefined value", () => {
    const built: { span: Span; recorded: Array<RecordedAttribute> } =
      buildSpan();

    jest.spyOn(TelemetryContext, "getAttributes").mockReturnValue({
      projectId: "project-1",
      monitorId: undefined,
      incidentId: null,
    } as unknown as Record<string, string | number | boolean>);

    new ContextSpanProcessor().onStart(built.span, EMPTY_CONTEXT);

    expect(
      built.recorded.map((attribute: RecordedAttribute) => {
        return attribute.key;
      }),
    ).toEqual(["projectId"]);
  });

  test("a nested scope stamps the identifiers of both levels", () => {
    const built: { span: Span; recorded: Array<RecordedAttribute> } =
      buildSpan();

    TelemetryContext.runWithContext({ projectId: "project-1" }, (): void => {
      TelemetryContext.runWithContext({ monitorId: "monitor-1" }, (): void => {
        new ContextSpanProcessor().onStart(built.span, EMPTY_CONTEXT);
      });
    });

    expect(built.recorded).toEqual(
      expect.arrayContaining([
        { key: "projectId", value: "project-1" },
        { key: "monitorId", value: "monitor-1" },
      ]),
    );
  });

  test("the scope does not leak out of the run it was seeded for", () => {
    TelemetryContext.runWithContext({ projectId: "project-1" }, (): void => {
      // seeded and immediately left
    });

    const built: { span: Span; recorded: Array<RecordedAttribute> } =
      buildSpan();

    new ContextSpanProcessor().onStart(built.span, EMPTY_CONTEXT);

    expect(built.recorded).toEqual([]);
  });
});

describe("telemetry never takes down the operation it is watching", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * onStart runs inside the SDK's tracer, on the hot path of every traced
   * operation. An exception escaping it does not lose a span - it fails the
   * work the span was describing.
   */
  test("swallows a span that refuses attributes", () => {
    expect(() => {
      return startInContext({ projectId: "project-1" }, { throwOnSet: true });
    }).not.toThrow();
  });

  test("swallows a context that throws while being read", () => {
    jest.spyOn(TelemetryContext, "getAttributes").mockImplementation(() => {
      throw new Error("async local storage is unhappy");
    });

    const built: { span: Span; recorded: Array<RecordedAttribute> } =
      buildSpan();

    expect(() => {
      return new ContextSpanProcessor().onStart(built.span, EMPTY_CONTEXT);
    }).not.toThrow();
  });

  test("swallows a context that is not an object at all", () => {
    jest
      .spyOn(TelemetryContext, "getAttributes")
      .mockReturnValue(null as unknown as Record<string, string>);

    const built: { span: Span; recorded: Array<RecordedAttribute> } =
      buildSpan();

    expect(() => {
      return new ContextSpanProcessor().onStart(built.span, EMPTY_CONTEXT);
    }).not.toThrow();
  });
});

describe("the rest of the SpanProcessor contract", () => {
  /*
   * Enrichment happens entirely at creation, so onEnd is deliberately inert.
   * Doing anything to an ended span here would be both useless and a way to
   * throw on the export path.
   */
  test("onEnd does nothing and does not throw", () => {
    expect(() => {
      return new ContextSpanProcessor().onEnd({} as ReadableSpan);
    }).not.toThrow();
  });

  test("shutdown resolves, so the SDK's teardown is never blocked", async () => {
    await expect(
      new ContextSpanProcessor().shutdown(),
    ).resolves.toBeUndefined();
  });

  test("forceFlush resolves, so a flush before exit never hangs", async () => {
    await expect(
      new ContextSpanProcessor().forceFlush(),
    ).resolves.toBeUndefined();
  });

  test("shutdown and forceFlush stay resolvable after an enrichment failure", async () => {
    const processor: ContextSpanProcessor = new ContextSpanProcessor();

    processor.onStart(buildSpan({ throwOnSet: true }).span, EMPTY_CONTEXT);

    await expect(processor.forceFlush()).resolves.toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });
});
