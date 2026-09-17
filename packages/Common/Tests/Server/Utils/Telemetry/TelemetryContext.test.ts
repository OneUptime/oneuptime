import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * TelemetryContext is the AsyncLocalStorage-backed attribute bag that carries
 * tenant identifiers (projectId, userId, ...) from where middleware learns
 * them down to the spans and logs created much deeper in the call stack. These
 * tests pin the contracts every one of its ~1958 span/log consumers leans on:
 * scoping and inheritance, safe no-ops outside a scope, the merge rules, the
 * best-effort payload extraction, and the DisableTelemetry short-circuit.
 */

type TelemetryContextClass =
  typeof import("../../../../Server/Utils/Telemetry/TelemetryContext").default;

/*
 * Load a fresh module with the DisableTelemetry env gate forced to a known
 * value. resetModules also gives each test its own AsyncLocalStorage so scopes
 * never leak between tests.
 */
async function load(disabled: boolean): Promise<TelemetryContextClass> {
  jest.resetModules();
  jest.doMock("../../../../Server/EnvironmentConfig", () => {
    return {
      __esModule: true,
      DisableTelemetry: disabled,
    };
  });

  return (
    (await import(
      "../../../../Server/Utils/Telemetry/TelemetryContext"
    )) as unknown as { default: TelemetryContextClass }
  ).default;
}

describe("TelemetryContext (telemetry enabled)", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  describe("getAttributes / runWithContext", () => {
    test("returns an empty object when there is no active scope", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);
      expect(TelemetryContext.getAttributes()).toEqual({});
    });

    test("seeds the scope with the supplied attributes", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      const inside: Record<string, string | number | boolean> =
        TelemetryContext.runWithContext(
          { projectId: "p1", userId: "u1" },
          () => {
            return TelemetryContext.getAttributes();
          },
        );

      expect(inside).toEqual({ projectId: "p1", userId: "u1" });
    });

    test("the scope does not leak past runWithContext", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      TelemetryContext.runWithContext({ projectId: "p1" }, () => {
        return undefined;
      });

      expect(TelemetryContext.getAttributes()).toEqual({});
    });

    test("returns the callback's return value", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      const result: number = TelemetryContext.runWithContext(
        { projectId: "p1" },
        () => {
          return 42;
        },
      );

      expect(result).toBe(42);
    });

    test("drops undefined and null attribute values while seeding", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      const inside: Record<string, string | number | boolean> =
        TelemetryContext.runWithContext(
          {
            projectId: "p1",
            userId: undefined,
            monitorId: null as unknown as undefined,
          },
          () => {
            return TelemetryContext.getAttributes();
          },
        );

      expect(inside).toEqual({ projectId: "p1" });
    });
  });

  describe("nested scopes", () => {
    test("a nested scope inherits the enclosing attributes", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      const inner: Record<string, string | number | boolean> =
        TelemetryContext.runWithContext({ projectId: "p1" }, () => {
          return TelemetryContext.runWithContext({ userId: "u1" }, () => {
            return TelemetryContext.getAttributes();
          });
        });

      expect(inner).toEqual({ projectId: "p1", userId: "u1" });
    });

    test("a nested scope can override an inherited attribute", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      const inner: Record<string, string | number | boolean> =
        TelemetryContext.runWithContext({ projectId: "p1" }, () => {
          return TelemetryContext.runWithContext({ projectId: "p2" }, () => {
            return TelemetryContext.getAttributes();
          });
        });

      expect(inner).toEqual({ projectId: "p2" });
    });

    test("leaving a nested scope restores the enclosing attributes", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      const outerAfter: Record<string, string | number | boolean> =
        TelemetryContext.runWithContext({ projectId: "p1" }, () => {
          TelemetryContext.runWithContext(
            { projectId: "p2", userId: "u1" },
            () => {
              return undefined;
            },
          );
          return TelemetryContext.getAttributes();
        });

      expect(outerAfter).toEqual({ projectId: "p1" });
    });
  });

  describe("setAttributes", () => {
    test("enriches the current scope", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      const inside: Record<string, string | number | boolean> =
        TelemetryContext.runWithContext({ projectId: "p1" }, () => {
          TelemetryContext.setAttributes({ userId: "u1", incidentId: "i1" });
          return TelemetryContext.getAttributes();
        });

      expect(inside).toEqual({
        projectId: "p1",
        userId: "u1",
        incidentId: "i1",
      });
    });

    test("is a safe no-op outside any scope", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      expect(() => {
        TelemetryContext.setAttributes({ userId: "u1" });
      }).not.toThrow();
      expect(TelemetryContext.getAttributes()).toEqual({});
    });
  });

  describe("pickKnownAttributes", () => {
    test("extracts only known identifier keys", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      expect(
        TelemetryContext.pickKnownAttributes({
          projectId: "p1",
          monitorId: "m1",
          somethingUnknown: "ignored",
        }),
      ).toEqual({ projectId: "p1", monitorId: "m1" });
    });

    test("keeps number and boolean values without stringifying them", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      expect(
        TelemetryContext.pickKnownAttributes({
          projectId: 5,
          workspaceType: true,
        }),
      ).toEqual({ projectId: 5, workspaceType: true });
    });

    test("skips undefined and null identifier values", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      expect(
        TelemetryContext.pickKnownAttributes({
          projectId: "p1",
          userId: undefined,
          monitorId: null,
        }),
      ).toEqual({ projectId: "p1" });
    });

    test("stringifies an ObjectID-like value via toString()", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      expect(
        TelemetryContext.pickKnownAttributes({
          projectId: {
            toString: () => {
              return "obj-123";
            },
          },
        }),
      ).toEqual({ projectId: "obj-123" });
    });

    test("skips a plain object whose toString is '[object Object]'", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      expect(TelemetryContext.pickKnownAttributes({ projectId: {} })).toEqual(
        {},
      );
    });

    test("returns an empty object for non-object input", async () => {
      const TelemetryContext: TelemetryContextClass = await load(false);

      expect(TelemetryContext.pickKnownAttributes(null)).toEqual({});
      expect(TelemetryContext.pickKnownAttributes(undefined)).toEqual({});
      expect(TelemetryContext.pickKnownAttributes("string")).toEqual({});
      expect(TelemetryContext.pickKnownAttributes(7)).toEqual({});
    });
  });
});

describe("TelemetryContext (telemetry disabled)", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("runWithContext still runs the callback but seeds no scope", async () => {
    const TelemetryContext: TelemetryContextClass = await load(true);

    const inside: Record<string, string | number | boolean> =
      TelemetryContext.runWithContext({ projectId: "p1" }, () => {
        return TelemetryContext.getAttributes();
      });

    // No scope was created, so nothing is captured.
    expect(inside).toEqual({});
  });

  test("runWithContext returns the callback value when disabled", async () => {
    const TelemetryContext: TelemetryContextClass = await load(true);

    expect(
      TelemetryContext.runWithContext({ projectId: "p1" }, () => {
        return "ok";
      }),
    ).toBe("ok");
  });

  test("setAttributes is a no-op when disabled", async () => {
    const TelemetryContext: TelemetryContextClass = await load(true);

    expect(() => {
      TelemetryContext.setAttributes({ userId: "u1" });
    }).not.toThrow();
    expect(TelemetryContext.getAttributes()).toEqual({});
  });
});
