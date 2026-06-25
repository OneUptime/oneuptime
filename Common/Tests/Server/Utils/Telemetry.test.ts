import Telemetry, {
  Span,
  SpanStatusCode,
} from "../../../Server/Utils/Telemetry";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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

describe("Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan", () => {
  type FakeSpanState = {
    attributes: Record<string, unknown> | null;
    status: { code: number; message?: string } | null;
    recorded: unknown;
    ended: number;
  };

  // Silence the logger.error console output these tests intentionally trigger.
  beforeAll((): void => {
    jest.spyOn(console, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterAll((): void => {
    jest.restoreAllMocks();
  });

  function makeFakeSpan(
    state: FakeSpanState,
    opts?: { throwOnSetAttributes?: boolean },
  ): Span {
    return {
      setAttributes: (a: Record<string, unknown>): unknown => {
        if (opts?.throwOnSetAttributes) {
          throw new Error("setAttributes blew up");
        }
        state.attributes = a;
        return undefined;
      },
      recordException: (e: unknown): unknown => {
        state.recorded = e;
        return undefined;
      },
      setStatus: (s: { code: number; message?: string }): unknown => {
        state.status = s;
        return undefined;
      },
      end: (): void => {
        state.ended += 1;
      },
    } as unknown as Span;
  }

  test("marks the span as error with a message and ends it", () => {
    const state: FakeSpanState = {
      attributes: null,
      status: null,
      recorded: null,
      ended: 0,
    };

    Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
      span: makeFakeSpan(state),
      exception: new Error("kaboom"),
    });

    expect(state.ended).toBe(1);
    expect(state.status?.code).toBe(SpanStatusCode.ERROR);
    expect(state.status?.message).toBe("kaboom");
    expect((state.attributes || {})["exception.message"]).toBe("kaboom");
  });

  test("still ends and flags the span even if a span write throws", () => {
    const state: FakeSpanState = {
      attributes: null,
      status: null,
      recorded: null,
      ended: 0,
    };
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
