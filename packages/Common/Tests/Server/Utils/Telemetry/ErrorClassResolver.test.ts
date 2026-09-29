import ErrorClassResolver from "../../../../Server/Utils/Telemetry/ErrorClassResolver";
import TelemetryContext from "../../../../Server/Utils/Telemetry/TelemetryContext";
import ErrorClass from "../../../../Types/Telemetry/ErrorClass";
import {
  UNIT_OF_WORK_ATTRIBUTE_KEY,
  UnitOfWork,
} from "../../../../Types/Telemetry/UnitOfWork";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../../Types/Exception/ForbiddenException";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ServerException from "../../../../Types/Exception/ServerException";
import TimeoutException from "../../../../Types/Exception/TimeoutException";
import { describe, expect, test } from "@jest/globals";

function inUnitOfWork<T>(unitOfWork: UnitOfWork, fn: () => T): T {
  return TelemetryContext.runWithContext(
    { [UNIT_OF_WORK_ATTRIBUTE_KEY]: unitOfWork },
    fn,
  );
}

describe("ErrorClassResolver: undeclared means code-fault", () => {
  /*
   * Rule 1, and the reason the whole scheme fails safe. Anything OneUptime did
   * not deliberately construct was not predicted by anybody, so by definition
   * it is a bug — even inside an HTTP request, where a user-error would
   * otherwise be honoured.
   */
  test.each([
    ["a plain Error", new Error("boom")],
    ["a TypeError", new TypeError("x is not a function")],
    ["a thrown string", "something went wrong"],
    ["a thrown object", { message: "not an error at all" }],
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
  ])(
    "%s resolves to code-fault inside a request",
    (_name: string, thrown: unknown) => {
      expect(
        inUnitOfWork(UnitOfWork.HttpRequest, (): ErrorClass => {
          return ErrorClassResolver.resolve(thrown);
        }),
      ).toBe(ErrorClass.CodeFault);
    },
  );

  test("a TypeORM-shaped QueryFailedError resolves to code-fault", () => {
    const error: Error = Object.assign(
      new Error('duplicate key value violates unique constraint "PK_x"'),
      { code: "23505", constraint: "PK_x", table: "Project" },
    );

    expect(
      inUnitOfWork(UnitOfWork.HttpRequest, (): ErrorClass => {
        return ErrorClassResolver.resolve(error);
      }),
    ).toBe(ErrorClass.CodeFault);
  });
});

describe("ErrorClassResolver: the unit-of-work promotion", () => {
  /*
   * THE GUARD THAT MAKES A PER-CLASS DEFAULT DEFENSIBLE.
   *
   * BadDataException is used for two different things in this repo:
   * rejecting a caller's input, and asserting an internal invariant. They are
   * indistinguishable at the throw site and perfectly distinguishable by unit
   * of work — one has a caller who can fix their request, the other does not.
   */
  test.each([
    [
      "BadDataException",
      (): Error => {
        return new BadDataException("Name is required");
      },
    ],
    [
      "NotFoundException",
      (): Error => {
        return new NotFoundException("no such monitor");
      },
    ],
    [
      "NotAuthenticatedException",
      (): Error => {
        return new NotAuthenticatedException("token expired");
      },
    ],
    [
      "ForbiddenException",
      (): Error => {
        return new ForbiddenException("nope");
      },
    ],
  ])(
    "%s keeps its declared class inside an HTTP request",
    (_name: string, make: () => Error) => {
      const resolved: ErrorClass = inUnitOfWork(
        UnitOfWork.HttpRequest,
        (): ErrorClass => {
          return ErrorClassResolver.resolve(make());
        },
      );

      expect([ErrorClass.UserError, ErrorClass.ExpectedDenial]).toContain(
        resolved,
      );
    },
  );

  test.each([
    [UnitOfWork.WorkerJob],
    [UnitOfWork.CronJob],
    [UnitOfWork.ProbeCheck],
    [UnitOfWork.Notification],
    [UnitOfWork.Startup],
  ])(
    "a user-error class is promoted back to code-fault in a %s",
    (unitOfWork: UnitOfWork) => {
      expect(
        inUnitOfWork(unitOfWork, (): ErrorClass => {
          return ErrorClassResolver.resolve(
            new BadDataException("No job found with name: foo"),
          );
        }),
      ).toBe(ErrorClass.CodeFault);
    },
  );

  test("an expected-denial class is promoted back to code-fault in a worker job", () => {
    expect(
      inUnitOfWork(UnitOfWork.WorkerJob, (): ErrorClass => {
        return ErrorClassResolver.resolve(
          new NotAuthenticatedException("internal call had no credentials"),
        );
      }),
    ).toBe(ErrorClass.CodeFault);
  });

  /*
   * No scope at all — an unhandled rejection, a module-load failure, code
   * running outside any seeded entry point. "Not a request" is the correct and
   * safe answer.
   */
  test("with no telemetry scope, a user-error class is promoted to code-fault", () => {
    expect(
      ErrorClassResolver.resolve(new BadDataException("Name is required")),
    ).toBe(ErrorClass.CodeFault);
  });

  /*
   * The classes that are never suppressed are never promoted either —
   * promoting them would be a no-op with extra steps, and asserting it keeps
   * anyone from "simplifying" the resolver into promoting everything.
   */
  test.each([
    [
      "ServerException",
      (): Error => {
        return new ServerException("boom");
      },
      ErrorClass.CodeFault,
    ],
    [
      "TimeoutException",
      (): Error => {
        return new TimeoutException("timed out");
      },
      ErrorClass.Infrastructure,
    ],
  ])(
    "%s keeps its class in every unit of work",
    (_name: string, make: () => Error, expected: ErrorClass) => {
      for (const unitOfWork of Object.values(UnitOfWork)) {
        expect(
          inUnitOfWork(unitOfWork, (): ErrorClass => {
            return ErrorClassResolver.resolve(make());
          }),
        ).toBe(expected);
      }

      expect(ErrorClassResolver.resolve(make())).toBe(expected);
    },
  );

  /*
   * runWithContext INHERITS the enclosing scope's attributes, which is why
   * every entry point must seed the marker explicitly. This pins that a
   * worker job started from inside a request does not inherit "http-request".
   */
  test("a nested worker-job scope overrides an inherited http-request marker", () => {
    const resolved: ErrorClass = inUnitOfWork(
      UnitOfWork.HttpRequest,
      (): ErrorClass => {
        return inUnitOfWork(UnitOfWork.WorkerJob, (): ErrorClass => {
          return ErrorClassResolver.resolve(new BadDataException("internal"));
        });
      },
    );

    expect(resolved).toBe(ErrorClass.CodeFault);
  });
});

describe("ErrorClassResolver: authoritative site-level declarations", () => {
  /*
   * The promotion exists to stop a class-level GENERALISATION being trusted in
   * the wrong context. It must not overrule a developer who looked at one
   * specific site — which is exactly what lets a probe report "the endpoint we
   * were asked to check is down" as a non-defect with no request in sight.
   */
  test.each([
    [UnitOfWork.ProbeCheck],
    [UnitOfWork.WorkerJob],
    [UnitOfWork.Notification],
  ])(
    "asUserError() survives the promotion in a %s",
    (unitOfWork: UnitOfWork) => {
      expect(
        inUnitOfWork(unitOfWork, (): ErrorClass => {
          return ErrorClassResolver.resolve(
            new BadDataException(
              "customer endpoint refused connection",
            ).asUserError(),
          );
        }),
      ).toBe(ErrorClass.UserError);
    },
  );

  test("asCodeFault() makes a user-error class loud again inside a request", () => {
    expect(
      inUnitOfWork(UnitOfWork.HttpRequest, (): ErrorClass => {
        return ErrorClassResolver.resolve(
          new BadDataException("this one really is our bug").asCodeFault(),
        );
      }),
    ).toBe(ErrorClass.CodeFault);
  });

  /*
   * The declaredOverride parameter — how a logger.error call site carrying an
   * `error.class` attribute declares a plain STRING log as external. Those
   * sites have no Error object to tag.
   */
  test("an explicit override wins over the thrown value and over the promotion", () => {
    expect(
      inUnitOfWork(UnitOfWork.ProbeCheck, (): ErrorClass => {
        return ErrorClassResolver.resolve(
          "Website Monitor - ping failed",
          ErrorClass.UserError,
        );
      }),
    ).toBe(ErrorClass.UserError);
  });

  test("an explicit override can also make something louder", () => {
    expect(
      inUnitOfWork(UnitOfWork.HttpRequest, (): ErrorClass => {
        return ErrorClassResolver.resolve(
          new BadDataException("bad"),
          ErrorClass.CodeFault,
        );
      }),
    ).toBe(ErrorClass.CodeFault);
  });

  test("an unrecognised override is ignored and the normal rules apply", () => {
    for (const bogus of ["USER-ERROR", "nonsense", "", null, undefined, 7]) {
      expect(
        inUnitOfWork(UnitOfWork.HttpRequest, (): ErrorClass => {
          return ErrorClassResolver.resolve(new BadDataException("bad"), bogus);
        }),
      ).toBe(ErrorClass.UserError);
    }
  });
});

describe("ErrorClassResolver.isNonActionable", () => {
  test("agrees with resolve()", () => {
    inUnitOfWork(UnitOfWork.HttpRequest, (): void => {
      expect(
        ErrorClassResolver.isNonActionable(new BadDataException("bad")),
      ).toBe(true);
      expect(
        ErrorClassResolver.isNonActionable(new ServerException("boom")),
      ).toBe(false);
      expect(
        ErrorClassResolver.isNonActionable(new TimeoutException("slow")),
      ).toBe(false);
      expect(ErrorClassResolver.isNonActionable(new Error("plain"))).toBe(
        false,
      );
    });
  });
});
