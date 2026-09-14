import Telemetry, {
  Span,
  SpanStatusCode,
} from "../../../Server/Utils/Telemetry";
import TelemetryContext from "../../../Server/Utils/Telemetry/TelemetryContext";
import ErrorClass from "../../../Types/Telemetry/ErrorClass";
import {
  UNIT_OF_WORK_ATTRIBUTE_KEY,
  UnitOfWork,
} from "../../../Types/Telemetry/UnitOfWork";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import ServerException from "../../../Types/Exception/ServerException";
import TimeoutException from "../../../Types/Exception/TimeoutException";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Run `fn` as though it were inside an HTTP request. ErrorClassResolver only
 * honours user-error / expected-denial inside one; everywhere else those
 * classes are promoted back to code-fault.
 */
function runInHttpRequest<T>(fn: () => T): T {
  return TelemetryContext.runWithContext(
    { [UNIT_OF_WORK_ATTRIBUTE_KEY]: UnitOfWork.HttpRequest },
    fn,
  );
}

type ExceptionAttributes = Record<string, string | undefined>;

// getExceptionAttributes is a private static; reach it through a narrow cast.
function getAttributes(exception: unknown): ExceptionAttributes {
  return (
    Telemetry as unknown as {
      getExceptionAttributes: (e: unknown) => ExceptionAttributes;
    }
  ).getExceptionAttributes(exception);
}

describe("Telemetry.getExceptionAttributes", () => {
  test("extracts Postgres fields from a TypeORM QueryFailedError-shaped error", () => {
    const error: Error = Object.assign(
      new Error('delete on "Project" violates foreign key constraint'),
      {
        driverError: {
          code: "23503",
          detail: 'Key (id)=(abc) is still referenced from table "Monitor".',
          constraint: "FK_monitor_project",
          table: "Monitor",
          column: "projectId",
          schema: "public",
        },
        query: 'DELETE FROM "Project" WHERE "_id" IN ($1)',
      },
    );

    const attributes: ExceptionAttributes = getAttributes(error);

    expect(attributes["exception.code"]).toBe("23503");
    expect(attributes["db.error.constraint"]).toBe("FK_monitor_project");
    expect(attributes["db.error.table"]).toBe("Monitor");
    expect(attributes["db.error.column"]).toBe("projectId");
    expect(attributes["db.error.schema"]).toBe("public");
    expect(attributes["db.error.detail"]).toContain("still referenced");
    expect(attributes["db.statement"]).toBe(
      'DELETE FROM "Project" WHERE "_id" IN ($1)',
    );
    expect(attributes["exception.type"]).toBe("Error");
    expect(attributes["exception.message"]).toContain("violates foreign key");
  });

  test("reads a top-level pg error code when there is no driverError", () => {
    const error: Error = Object.assign(
      new Error("duplicate key value violates unique constraint"),
      { code: "23505", constraint: "uniq_email" },
    );

    const attributes: ExceptionAttributes = getAttributes(error);

    expect(attributes["exception.code"]).toBe("23505");
    expect(attributes["db.error.constraint"]).toBe("uniq_email");
  });

  test("captures type, message and stacktrace for a plain Error", () => {
    const attributes: ExceptionAttributes = getAttributes(new Error("boom"));

    expect(attributes["exception.type"]).toBe("Error");
    expect(attributes["exception.message"]).toBe("boom");
    expect(typeof attributes["exception.stacktrace"]).toBe("string");
  });

  /*
   * exception.type is the exception's identity downstream: it is hashed into
   * the TelemetryException group fingerprint and it is what the Issues list
   * and the AI insight titles show. An Error subclass that never assigns
   * `this.name` inherits the generic "Error" from Error.prototype — which is
   * every exception OneUptime raises — so the constructor name is the one
   * that carries information.
   */
  test("a subclass that never sets `name` is typed by its constructor, not 'Error'", () => {
    class NotAuthenticatedException extends Error {
      public code: number = 401;
    }

    const attributes: ExceptionAttributes = getAttributes(
      new NotAuthenticatedException("Authenticated user is needed"),
    );

    expect(attributes["exception.type"]).toBe("NotAuthenticatedException");
  });

  test("an explicit name still wins over the constructor", () => {
    const error: Error = new Error("boom");
    error.name = "ValidationError";

    expect(getAttributes(error)["exception.type"]).toBe("ValidationError");
  });

  /*
   * Node system errors carry a descriptive string code; HTTP statuses and
   * Postgres SQLSTATEs carry a numeric one that says less than the class.
   */
  test("a descriptive string code is used, a numeric one is not", () => {
    const systemError: Error = Object.assign(new Error("connect failed"), {
      code: "ECONNREFUSED",
    });
    expect(getAttributes(systemError)["exception.type"]).toBe("ECONNREFUSED");

    class ServerException extends Error {
      public code: number = 500;
    }
    expect(getAttributes(new ServerException("boom"))["exception.type"]).toBe(
      "ServerException",
    );
    // The numeric code is not lost — it keeps its own attribute.
    expect(getAttributes(new ServerException("boom"))["exception.code"]).toBe(
      "500",
    );
  });

  test("handles a thrown string", () => {
    const attributes: ExceptionAttributes = getAttributes("kaboom");

    expect(attributes["exception.message"]).toBe("kaboom");
    expect(attributes["exception.type"]).toBeUndefined();
    expect(attributes["db.error.constraint"]).toBeUndefined();
  });

  test("handles null and undefined throws", () => {
    expect(getAttributes(null)["exception.message"]).toBe(
      "Unknown error: null or undefined was thrown",
    );
    expect(getAttributes(undefined)["exception.message"]).toBe(
      "Unknown error: null or undefined was thrown",
    );
  });

  test("serializes a non-Error object throw into the message", () => {
    const attributes: ExceptionAttributes = getAttributes({ a: 1, b: "x" });

    expect(attributes["exception.message"]).toBe('{"a":1,"b":"x"}');
  });

  test("truncates an oversized message and SQL statement", () => {
    const error: Error = Object.assign(new Error("x".repeat(9000)), {
      query: `SELECT ${"a".repeat(9000)}`,
    });

    const attributes: ExceptionAttributes = getAttributes(error);

    expect(attributes["exception.message"]?.length).toBe(4000);
    expect(attributes["db.statement"]?.length).toBe(2000);
  });

  // --- crash-safety: hostile thrown values must never make this throw. ---

  test("does not throw on an object with throwing getters", () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "code", {
      enumerable: true,
      get: (): never => {
        throw new Error("getter blew up");
      },
    });
    Object.defineProperty(hostile, "driverError", {
      enumerable: true,
      get: (): never => {
        throw new Error("driverError blew up");
      },
    });

    let attributes: ExceptionAttributes = {};
    expect((): void => {
      attributes = getAttributes(hostile);
    }).not.toThrow();
    expect(typeof attributes["exception.message"]).toBe("string");
  });

  test("does not throw on a field whose toString throws (good fields survive)", () => {
    const error: Error = Object.assign(new Error("db fail"), {
      driverError: {
        detail: {
          toString: (): never => {
            throw new Error("toString blew up");
          },
        },
      },
    });

    expect((): ExceptionAttributes => {
      return getAttributes(error);
    }).not.toThrow();
    expect(getAttributes(error)["exception.message"]).toBe("db fail");
  });

  test("does not throw on a Proxy that traps every property read", () => {
    const hostile: unknown = new Proxy(
      {},
      {
        get: (): never => {
          throw new Error("proxy trap");
        },
      },
    );

    expect((): ExceptionAttributes => {
      return getAttributes(hostile);
    }).not.toThrow();
  });
});

type FakeSpanEvent = {
  name: string;
  attributes: Record<string, unknown>;
};

type FakeSpanState = {
  attributes: Record<string, unknown> | null;
  status: { code: number; message?: string } | null;
  events: Array<FakeSpanEvent>;
  ended: number;
};

function newSpanState(): FakeSpanState {
  return { attributes: null, status: null, events: [], ended: 0 };
}

function makeFakeSpan(
  state: FakeSpanState,
  opts?: { throwOnSetAttributes?: boolean },
): Span {
  return {
    setAttributes: (a: Record<string, unknown>): unknown => {
      if (opts?.throwOnSetAttributes) {
        throw new Error("setAttributes blew up");
      }
      state.attributes = { ...(state.attributes || {}), ...a };
      return undefined;
    },
    addEvent: (name: string, attributes: Record<string, unknown>): unknown => {
      state.events.push({ name: name, attributes: attributes || {} });
      return undefined;
    },
    setStatus: (s: { code: number; message?: string }): unknown => {
      state.status = s;
      return undefined;
    },
    end: function (this: { endTime?: Array<number> }): void {
      state.ended += 1;

      /*
       * Stamp endTime the way sdk-trace-base does, so Telemetry.endSpan's
       * already-ended guard has something to read. Without it the double-end
       * case below would pass for the wrong reason.
       */
      if (Array.isArray(this?.endTime)) {
        this.endTime = [1700000000, 0];
      }
    },
  } as unknown as Span;
}

function eventsNamed(state: FakeSpanState, name: string): Array<FakeSpanEvent> {
  return state.events.filter((e: FakeSpanEvent): boolean => {
    return e.name === name;
  });
}

describe("Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan", () => {
  // Silence the logger.error console output these tests intentionally trigger.
  beforeAll((): void => {
    jest.spyOn(console, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(console, "warn").mockImplementation((): void => {
      return undefined;
    });
  });

  afterAll((): void => {
    jest.restoreAllMocks();
  });

  test("marks the span as error with a message and ends it", () => {
    const state: FakeSpanState = newSpanState();

    Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
      span: makeFakeSpan(state),
      exception: new Error("kaboom"),
    });

    expect(state.ended).toBe(1);
    expect(state.status?.code).toBe(SpanStatusCode.ERROR);
    expect(state.status?.message).toBe("kaboom");
    expect((state.attributes || {})["exception.message"]).toBe("kaboom");
  });

  /*
   * THE REGRESSION THIS GUARDS. The OTel SDK reads `exception.code` BEFORE
   * `exception.name` when it derives the exception event's `exception.type`,
   * and OneUptime's Exception base exposes an HTTP STATUS as `code`. Handing
   * the raw thrown value to span.recordException therefore typed every
   * exception this platform raises "401"/"400"/"500" — which is hashed into
   * the TelemetryException group fingerprint and rendered as the AI insight
   * title, collapsing a service's unrelated failures into one indistinct row.
   *
   * The event is now constructed here rather than delegated to
   * recordException, which removes the trap structurally: the SDK never sees
   * the thrown object at all.
   */
  test("emits an exception event typed by class name, never by an HTTP status", () => {
    class SomeAuthException extends Error {
      public code: number = 401;
    }

    const state: FakeSpanState = newSpanState();

    Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
      span: makeFakeSpan(state),
      exception: new SomeAuthException("needs an API key"),
    });

    const exceptionEvents: Array<FakeSpanEvent> = eventsNamed(
      state,
      "exception",
    );

    expect(exceptionEvents).toHaveLength(1);

    const attributes: Record<string, unknown> = exceptionEvents[0]!.attributes;

    expect(attributes["exception.type"]).toBe("SomeAuthException");
    expect(attributes["exception.type"]).not.toBe("401");
    expect(attributes["exception.message"]).toBe("needs an API key");
    expect(typeof attributes["exception.stacktrace"]).toBe("string");
  });

  test("still ends and flags the span even if a span write throws", () => {
    const state: FakeSpanState = newSpanState();
    const span: Span = makeFakeSpan(state, { throwOnSetAttributes: true });

    expect((): void => {
      Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
        span,
        exception: new Error("kaboom"),
      });
    }).not.toThrow();

    expect(state.ended).toBe(1);
    expect(state.status?.code).toBe(SpanStatusCode.ERROR);
  });
});

/*
 * The behaviour that keeps user errors out of the Issues list.
 *
 * Ingest builds an ExceptionInstance row and a TelemetryException group for
 * every span event literally named "exception" and for nothing else, so the
 * event NAME is the entire mechanism. These tests pin the name, the absence of
 * a status write, the absence of exception.* keys on the fault event (which
 * would let the log-derived exception path resurrect it), and the fact that
 * nothing is destroyed.
 */
describe("Telemetry fault classification", () => {
  beforeAll((): void => {
    jest.spyOn(console, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(console, "warn").mockImplementation((): void => {
      return undefined;
    });
  });

  afterAll((): void => {
    jest.restoreAllMocks();
  });

  test("a code-fault emits exactly one exception event and sets ERROR", () => {
    const state: FakeSpanState = newSpanState();

    Telemetry.recordExceptionOnSpan({
      span: makeFakeSpan(state),
      exception: new ServerException("database is on fire"),
    });

    expect(eventsNamed(state, "exception")).toHaveLength(1);
    expect(eventsNamed(state, "fault")).toHaveLength(0);
    expect(state.status?.code).toBe(SpanStatusCode.ERROR);
    expect((state.attributes || {})["error.class"]).toBe(ErrorClass.CodeFault);
  });

  test("an infrastructure fault stays an exception event and stays ERROR", () => {
    const state: FakeSpanState = newSpanState();

    Telemetry.recordExceptionOnSpan({
      span: makeFakeSpan(state),
      exception: new TimeoutException("upstream timed out"),
    });

    expect(eventsNamed(state, "exception")).toHaveLength(1);
    expect(state.status?.code).toBe(SpanStatusCode.ERROR);
    expect((state.attributes || {})["error.class"]).toBe(
      ErrorClass.Infrastructure,
    );
  });

  test("a user error inside a request emits a fault event, no exception event, and no status write", () => {
    const state: FakeSpanState = newSpanState();

    runInHttpRequest((): void => {
      Telemetry.recordExceptionOnSpan({
        span: makeFakeSpan(state),
        exception: new BadDataException("Name is required"),
      });
    });

    expect(eventsNamed(state, "exception")).toHaveLength(0);

    const faults: Array<FakeSpanEvent> = eventsNamed(state, "fault");
    expect(faults).toHaveLength(1);

    /*
     * OTel says a 4xx on a SERVER span must stay Unset, and
     * setStatus({code: UNSET}) is a documented no-op — so "leave it unset" is
     * implemented as "never call setStatus". Assert the call never happened,
     * not that it was called with UNSET.
     */
    expect(state.status).toBeNull();
  });

  test("the fault event carries NO exception.* keys, so the log-derived path cannot resurrect it", () => {
    const state: FakeSpanState = newSpanState();

    runInHttpRequest((): void => {
      Telemetry.recordExceptionOnSpan({
        span: makeFakeSpan(state),
        exception: new NotAuthenticatedException("token expired"),
      });
    });

    const attributes: Record<string, unknown> = eventsNamed(state, "fault")[0]!
      .attributes;

    for (const key of Object.keys(attributes)) {
      expect(key.startsWith("exception.")).toBe(false);
    }

    expect(attributes["error.class"]).toBe(ErrorClass.ExpectedDenial);
    expect(attributes["error.type"]).toBe("NotAuthenticatedException");
    expect(attributes["error.message"]).toBe("token expired");
  });

  /*
   * NOTHING IS DESTROYED. The suppressed error is still fully described on the
   * span, so the audit query `attributes.error.class = 'user-error'` in the
   * Traces explorer finds every one of them.
   */
  test("a suppressed fault still records the full exception attribute bag on the span", () => {
    const state: FakeSpanState = newSpanState();

    runInHttpRequest((): void => {
      Telemetry.recordExceptionOnSpan({
        span: makeFakeSpan(state),
        exception: new BadDataException("Name is required"),
      });
    });

    const attributes: Record<string, unknown> = state.attributes || {};

    expect(attributes["exception.type"]).toBe("BadDataException");
    expect(attributes["exception.message"]).toBe("Name is required");
    expect(attributes["error.class"]).toBe(ErrorClass.UserError);
  });

  /*
   * THE PROMOTION GUARD. BadDataException is used for two different things in
   * this repo — rejecting a caller's input, and asserting an internal
   * invariant. They are indistinguishable at the throw site and perfectly
   * distinguishable by unit of work.
   */
  test("a user-error class OUTSIDE a request is promoted back to code-fault", () => {
    const state: FakeSpanState = newSpanState();

    TelemetryContext.runWithContext(
      { [UNIT_OF_WORK_ATTRIBUTE_KEY]: UnitOfWork.WorkerJob },
      (): void => {
        Telemetry.recordExceptionOnSpan({
          span: makeFakeSpan(state),
          exception: new BadDataException("No job found with name: foo"),
        });
      },
    );

    expect(eventsNamed(state, "exception")).toHaveLength(1);
    expect(eventsNamed(state, "fault")).toHaveLength(0);
    expect(state.status?.code).toBe(SpanStatusCode.ERROR);
    expect((state.attributes || {})["error.class"]).toBe(ErrorClass.CodeFault);
  });

  test("with no telemetry scope at all, a user-error class is promoted to code-fault", () => {
    const state: FakeSpanState = newSpanState();

    Telemetry.recordExceptionOnSpan({
      span: makeFakeSpan(state),
      exception: new BadDataException("something internal went wrong"),
    });

    expect(eventsNamed(state, "exception")).toHaveLength(1);
    expect((state.attributes || {})["error.class"]).toBe(ErrorClass.CodeFault);
  });

  /*
   * An authoritative, site-level declaration is a developer's judgment about
   * one specific place, so it is exempt from the promotion — which is what
   * lets a probe say "the endpoint we were asked to check is down" outside any
   * HTTP request.
   */
  test("an authoritative site-level declaration survives outside a request", () => {
    const state: FakeSpanState = newSpanState();

    TelemetryContext.runWithContext(
      { [UNIT_OF_WORK_ATTRIBUTE_KEY]: UnitOfWork.ProbeCheck },
      (): void => {
        Telemetry.recordExceptionOnSpan({
          span: makeFakeSpan(state),
          exception: new BadDataException(
            "customer endpoint refused connection",
          ).asUserError(),
        });
      },
    );

    expect(eventsNamed(state, "fault")).toHaveLength(1);
    expect(eventsNamed(state, "exception")).toHaveLength(0);
  });

  /*
   * THE B2 REGRESSION GUARD, and nothing covered this before.
   *
   * One error crossing N decorated frames used to emit N exception events and
   * N logger.error lines. The fingerprint hashes no spanId and no span name,
   * so all N landed in the same group and occuranceCount jumped by the depth
   * of the call stack — 3 for a create with a missing field, 6 for a
   * permission-denied get-list.
   */
  test("one thrown value reports ONCE across many frames, but every frame still sets ERROR", () => {
    const frames: Array<FakeSpanState> = [
      newSpanState(),
      newSpanState(),
      newSpanState(),
    ];
    const error: Error = new ServerException("one failure, three frames");

    for (const frame of frames) {
      Telemetry.recordExceptionOnSpan({
        span: makeFakeSpan(frame),
        exception: error,
      });
    }

    const totalExceptionEvents: number = frames.reduce(
      (sum: number, frame: FakeSpanState): number => {
        return sum + eventsNamed(frame, "exception").length;
      },
      0,
    );

    expect(totalExceptionEvents).toBe(1);
    expect(eventsNamed(frames[0]!, "exception")).toHaveLength(1);

    /*
     * Outer frames keep the ERROR status and the queryable exception.*
     * attributes so the trace still shows the whole error path — only the
     * duplicate EVENT is suppressed.
     */
    for (const frame of frames) {
      expect(frame.status?.code).toBe(SpanStatusCode.ERROR);
      expect((frame.attributes || {})["exception.message"]).toBe(
        "one failure, three frames",
      );
    }
  });

  test("report-once also applies to suppressed faults", () => {
    const frames: Array<FakeSpanState> = [newSpanState(), newSpanState()];
    const error: Error = new BadDataException("Name is required");

    runInHttpRequest((): void => {
      for (const frame of frames) {
        Telemetry.recordExceptionOnSpan({
          span: makeFakeSpan(frame),
          exception: error,
        });
      }
    });

    expect(eventsNamed(frames[0]!, "fault")).toHaveLength(1);
    expect(eventsNamed(frames[1]!, "fault")).toHaveLength(0);
  });

  test("a thrown string is never taggable, so it is always a code-fault and always reported", () => {
    const first: FakeSpanState = newSpanState();
    const second: FakeSpanState = newSpanState();

    Telemetry.recordExceptionOnSpan({
      span: makeFakeSpan(first),
      exception: "just a string",
    });
    Telemetry.recordExceptionOnSpan({
      span: makeFakeSpan(second),
      exception: "just a string",
    });

    expect(eventsNamed(first, "exception")).toHaveLength(1);
    expect(eventsNamed(second, "exception")).toHaveLength(1);
    expect((first.attributes || {})["error.class"]).toBe(ErrorClass.CodeFault);
  });

  test("recordExceptionOnSpan does not end the span; the wrapper does", () => {
    const state: FakeSpanState = newSpanState();
    const span: Span = makeFakeSpan(state);

    Telemetry.recordExceptionOnSpan({
      span,
      exception: new ServerException("boom"),
    });
    expect(state.ended).toBe(0);

    Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
      span,
      exception: new ServerException("boom again"),
    });
    expect(state.ended).toBe(1);
  });
});

/*
 * Ending a span twice makes the SDK emit "You can only call end() on a span
 * once" through diag. That happened on EVERY error path before this guard: the
 * recorder's finally ended the span, then CaptureSpan ended it again in its
 * own finally / .finally(). Both now route through Telemetry.endSpan.
 */
describe("Telemetry.endSpan is idempotent", () => {
  type EndableSpan = Span & { endTime: Array<number>; endCount: number };

  function makeEndableSpan(): EndableSpan {
    const span: Partial<EndableSpan> = {
      // sdk-trace-base leaves endTime at [0, 0] until the span ends.
      endTime: [0, 0],
      endCount: 0,
    };

    span.end = (): void => {
      span.endCount = (span.endCount || 0) + 1;
      span.endTime = [1700000000, 0];
    };

    return span as EndableSpan;
  }

  test("a second end() is a no-op", () => {
    const span: EndableSpan = makeEndableSpan();

    Telemetry.endSpan(span);
    Telemetry.endSpan(span);
    Telemetry.endSpan(span);

    expect(span.endCount).toBe(1);
  });

  test("the recorder and its caller together end the span exactly once", () => {
    const state: FakeSpanState = newSpanState();
    const fake: Span = makeFakeSpan(state);
    const span: Span = Object.assign(fake, { endTime: [0, 0] }) as Span;

    /*
     * Mirror CaptureSpan's error path: the recorder ends it, then so does the
     * decorator's finally.
     */
    Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
      span,
      exception: new ServerException("boom"),
    });
    Telemetry.endSpan(span);

    expect(state.ended).toBe(1);
  });

  /*
   * A span implementation that does not expose endTime — a no-op span, a test
   * double — must still be ended rather than silently skipped.
   */
  test("a span with no observable endTime is ended normally", () => {
    const state: FakeSpanState = newSpanState();
    const span: Span = makeFakeSpan(state);

    Telemetry.endSpan(span);

    expect(state.ended).toBe(1);
  });
});
