import ErrorClass, {
  DeclaredErrorClass,
  NON_ACTIONABLE_ERROR_CLASSES,
  clearErrorReported,
  declaredErrorClass,
  isNonActionableErrorClass,
  markErrorReported,
  tagErrorClass,
  tagErrorClassAuthoritative,
  toErrorClass,
} from "../../../Types/Telemetry/ErrorClass";
import ExceptionAIClassification from "../../../Types/AI/ExceptionAIClassification";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import APIException from "../../../Types/Exception/ApiException";
import BadDataException from "../../../Types/Exception/BadDataException";
import BadOperationException from "../../../Types/Exception/BadOperationException";
import BadRequestException from "../../../Types/Exception/BadRequestException";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import MasterPasswordRequiredException from "../../../Types/Exception/MasterPasswordRequiredException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import NotImplementedException from "../../../Types/Exception/NotImplementedException";
import PayloadTooLargeException from "../../../Types/Exception/PayloadTooLargeException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import SSOAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import ServerException from "../../../Types/Exception/ServerException";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import TenantNotFoundException from "../../../Types/Exception/TenantNotFoundException";
import TimeoutException from "../../../Types/Exception/TimeoutException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import UnableToReachServer from "../../../Types/Exception/UnableToReachServer";
import WebsiteRequestException from "../../../Types/Exception/WebsiteRequestException";
import { describe, expect, test } from "@jest/globals";

/*
 * THE CLASS TABLE, IN EXECUTABLE FORM.
 *
 * This is the semantic rule the whole design rests on, and it is the one place
 * a future contributor can silently make the platform blind — either by
 * mis-declaring a class, or by adding a subclass and forgetting to. Both are
 * cheap to pin, so pin them.
 *
 * Every concrete Exception subclass in Common/Types/Exception is listed. If a
 * new one is added and not added here, the completeness test at the bottom
 * fails.
 */
const CLASS_TABLE: Array<{
  name: string;
  make: () => Exception;
  expected: ErrorClass;
}> = [
  // user-error — the caller sent something we cannot accept.
  {
    name: "BadDataException",
    make: (): Exception => {
      return new BadDataException("bad");
    },
    expected: ErrorClass.UserError,
  },
  {
    name: "BadRequestException",
    make: (): Exception => {
      return new BadRequestException("bad");
    },
    expected: ErrorClass.UserError,
  },
  {
    name: "NotFoundException",
    make: (): Exception => {
      return new NotFoundException("nope");
    },
    expected: ErrorClass.UserError,
  },
  {
    name: "TenantNotFoundException",
    make: (): Exception => {
      return new TenantNotFoundException("nope");
    },
    expected: ErrorClass.UserError,
  },
  {
    name: "PayloadTooLargeException",
    make: (): Exception => {
      return new PayloadTooLargeException("too big");
    },
    expected: ErrorClass.UserError,
  },

  // expected-denial — a check we deliberately wrote, doing its job.
  {
    name: "NotAuthenticatedException",
    make: (): Exception => {
      return new NotAuthenticatedException("who?");
    },
    expected: ErrorClass.ExpectedDenial,
  },
  {
    // Inherits from NotAuthenticatedException and needs no override of its own.
    name: "MasterPasswordRequiredException",
    make: (): Exception => {
      return new MasterPasswordRequiredException("master password required");
    },
    expected: ErrorClass.ExpectedDenial,
  },
  {
    name: "NotAuthorizedException",
    make: (): Exception => {
      return new NotAuthorizedException("not you");
    },
    expected: ErrorClass.ExpectedDenial,
  },
  {
    name: "ForbiddenException",
    make: (): Exception => {
      return new ForbiddenException("no");
    },
    expected: ErrorClass.ExpectedDenial,
  },
  {
    name: "SSOAuthorizationException",
    make: (): Exception => {
      return new SSOAuthorizationException();
    },
    expected: ErrorClass.ExpectedDenial,
  },
  {
    name: "PaymentRequiredException",
    make: (): Exception => {
      return new PaymentRequiredException("pay up");
    },
    expected: ErrorClass.ExpectedDenial,
  },
  {
    name: "TooManyRequestsException",
    make: (): Exception => {
      return new TooManyRequestsException("slow down");
    },
    expected: ErrorClass.ExpectedDenial,
  },

  // infrastructure — the environment failed. STILL AN ISSUE.
  {
    name: "TimeoutException",
    make: (): Exception => {
      return new TimeoutException("timed out");
    },
    expected: ErrorClass.Infrastructure,
  },
  {
    name: "UnableToReachServer",
    make: (): Exception => {
      return new UnableToReachServer("unreachable");
    },
    expected: ErrorClass.Infrastructure,
  },
  {
    name: "ServiceUnavailableException",
    make: (): Exception => {
      return new ServiceUnavailableException("down");
    },
    expected: ErrorClass.Infrastructure,
  },
  {
    name: "APIException",
    make: (): Exception => {
      return new APIException("upstream said no");
    },
    expected: ErrorClass.Infrastructure,
  },
  {
    name: "WebsiteRequestException",
    make: (): Exception => {
      return new WebsiteRequestException("request failed");
    },
    expected: ErrorClass.Infrastructure,
  },

  // code-fault — the base default, inherited without an override.
  {
    name: "Exception",
    make: (): Exception => {
      return new Exception(ExceptionCode.GeneralException, "generic");
    },
    expected: ErrorClass.CodeFault,
  },
  {
    name: "ServerException",
    make: (): Exception => {
      return new ServerException("boom");
    },
    expected: ErrorClass.CodeFault,
  },
  {
    name: "NotImplementedException",
    make: (): Exception => {
      return new NotImplementedException();
    },
    expected: ErrorClass.CodeFault,
  },
  {
    name: "DatabaseNotConnectedException",
    make: (): Exception => {
      return new DatabaseNotConnectedException("no db");
    },
    expected: ErrorClass.CodeFault,
  },
  {
    name: "BadOperationException",
    make: (): Exception => {
      return new BadOperationException("cannot do that");
    },
    expected: ErrorClass.CodeFault,
  },
];

function declaredClassOf(value: unknown): ErrorClass | null {
  const declared: DeclaredErrorClass | null = declaredErrorClass(value);
  return declared === null ? null : declared.errorClass;
}

describe("ErrorClass: the class table", () => {
  test.each(CLASS_TABLE)(
    "$name declares $expected",
    ({ make, expected }: { make: () => Exception; expected: ErrorClass }) => {
      expect(declaredClassOf(make())).toBe(expected);
    },
  );

  /*
   * THE FAILURE DIRECTION. This is the single most important assertion in the
   * file: a subclass added without an override must land on CodeFault, i.e.
   * stay NOISY. There must be no configuration in which forgetting to classify
   * something makes it silent.
   */
  test("a NEW subclass with no override defaults to code-fault", () => {
    class BrandNewException extends Exception {
      public constructor(message: string) {
        super(ExceptionCode.GeneralException, message);
      }
    }

    expect(declaredClassOf(new BrandNewException("nobody classified me"))).toBe(
      ErrorClass.CodeFault,
    );
  });

  /*
   * Class-level declarations are NOT authoritative — they are generalisations,
   * so ErrorClassResolver is allowed to promote them back to code-fault
   * outside an HTTP request. Site-level ones are.
   */
  test("a class-level declaration is not authoritative", () => {
    expect(declaredErrorClass(new BadDataException("bad"))).toEqual({
      errorClass: ErrorClass.UserError,
      authoritative: false,
    });
  });

  test.each([
    ["asCodeFault", ErrorClass.CodeFault],
    ["asUserError", ErrorClass.UserError],
    ["asExpectedDenial", ErrorClass.ExpectedDenial],
    ["asInfrastructure", ErrorClass.Infrastructure],
  ])(
    "%s() overrides the class default and IS authoritative",
    (method: string, expected: ErrorClass) => {
      const exception: Exception = new BadDataException("bad");
      const returned: Exception = (
        exception as unknown as Record<string, () => Exception>
      )[method]!();

      // Chainable: it must return the same object, not a copy.
      expect(returned).toBe(exception);
      expect(declaredErrorClass(exception)).toEqual({
        errorClass: expected,
        authoritative: true,
      });
    },
  );

  /*
   * COMPLETENESS. Every concrete subclass file in Common/Types/Exception must
   * appear in CLASS_TABLE above. Enumerated from the enum rather than from the
   * filesystem so this test stays a pure unit test; ExceptionCode gains a
   * member whenever a class is added.
   */
  test("every exception class in the codebase is covered by the table", () => {
    const covered: Set<string> = new Set(
      CLASS_TABLE.map((row: { name: string }): string => {
        return row.name;
      }),
    );

    /*
     * The classes whose names differ from their ExceptionCode member, plus the
     * base class and the one subclass with no code of its own.
     */
    const KNOWN_NAME_ALIASES: Record<string, string> = {
      UnabletoReachServerException: "UnableToReachServer",
      SsoAuthorizationException: "SSOAuthorizationException",
      ApiException: "APIException",
      WebRequestException: "WebsiteRequestException",
      GeneralException: "Exception",
    };

    const uncovered: Array<string> = Object.keys(ExceptionCode)
      .filter((key: string): boolean => {
        return Number.isNaN(Number(key));
      })
      .map((key: string): string => {
        return KNOWN_NAME_ALIASES[key] || key;
      })
      .filter((name: string): boolean => {
        return !covered.has(name);
      });

    expect(uncovered).toEqual([]);
  });
});

describe("ErrorClass: vocabulary", () => {
  test("the AI classification enum is literally the same object", () => {
    expect(ExceptionAIClassification).toBe(ErrorClass);
    expect(ExceptionAIClassification.CodeFault).toBe("code-fault");
    expect(ExceptionAIClassification.UserError).toBe("user-error");
    expect(ExceptionAIClassification.ExpectedDenial).toBe("expected-denial");
    expect(ExceptionAIClassification.Infrastructure).toBe("infrastructure");
    expect(ExceptionAIClassification.Unknown).toBe("unknown");
  });

  /*
   * Only two classes are ever suppressed. Infrastructure and Unknown MUST NOT
   * be in this list: an infrastructure failure is a real failure worth a
   * human, and "we could not tell" must never mean "hide it".
   */
  test("exactly user-error and expected-denial are non-actionable", () => {
    expect([...NON_ACTIONABLE_ERROR_CLASSES].sort()).toEqual([
      ErrorClass.ExpectedDenial,
      ErrorClass.UserError,
    ]);

    expect(isNonActionableErrorClass(ErrorClass.UserError)).toBe(true);
    expect(isNonActionableErrorClass(ErrorClass.ExpectedDenial)).toBe(true);
    expect(isNonActionableErrorClass(ErrorClass.CodeFault)).toBe(false);
    expect(isNonActionableErrorClass(ErrorClass.Infrastructure)).toBe(false);
    expect(isNonActionableErrorClass(ErrorClass.Unknown)).toBe(false);
  });

  test("unrecognised values are never non-actionable", () => {
    for (const value of [
      undefined,
      null,
      "",
      "USER-ERROR",
      "user_error",
      "whatever",
      0,
      true,
      {},
    ]) {
      expect(isNonActionableErrorClass(value)).toBe(false);
      expect(toErrorClass(value)).toBeNull();
    }
  });
});

describe("ErrorClass: tagging", () => {
  test("the tag is non-enumerable, so it never leaks into logs or JSON", () => {
    const exception: Exception = new BadDataException("bad");

    expect(Object.keys(exception)).not.toContain("errorClass");
    expect(JSON.stringify({ ...exception })).not.toContain("user-error");
  });

  test("an untagged plain Error declares nothing", () => {
    expect(declaredErrorClass(new Error("plain"))).toBeNull();
    expect(declaredErrorClass("a string")).toBeNull();
    expect(declaredErrorClass(null)).toBeNull();
    expect(declaredErrorClass(undefined)).toBeNull();
    expect(declaredErrorClass(42)).toBeNull();
  });

  /*
   * A plain `errorClass` property survives serialization, so an error that
   * crossed a process or module boundary can still declare itself — and that
   * is a deliberate declaration, so it counts as authoritative.
   */
  test("a plain errorClass property is honoured and is authoritative", () => {
    const error: Error = Object.assign(new Error("from elsewhere"), {
      errorClass: "user-error",
    });

    expect(declaredErrorClass(error)).toEqual({
      errorClass: ErrorClass.UserError,
      authoritative: true,
    });
  });

  test("an invalid errorClass property is ignored", () => {
    const error: Error = Object.assign(new Error("from elsewhere"), {
      errorClass: "not-a-real-class",
    });

    expect(declaredErrorClass(error)).toBeNull();
  });

  test("tagging never throws on a frozen object", () => {
    const frozen: Error = Object.freeze(new Error("frozen"));

    expect((): void => {
      tagErrorClass(frozen, ErrorClass.UserError);
    }).not.toThrow();

    // It could not be tagged, so it declares nothing and stays a code-fault.
    expect(declaredErrorClass(frozen)).toBeNull();
  });

  test("tagging a non-object is a no-op that returns the value", () => {
    expect(tagErrorClass("a string", ErrorClass.UserError)).toBe("a string");
    expect(tagErrorClass(null, ErrorClass.UserError)).toBeNull();
    expect(tagErrorClassAuthoritative(7, ErrorClass.UserError)).toBe(7);
  });

  test("re-tagging replaces the previous class", () => {
    const error: Error = new Error("x");

    tagErrorClass(error, ErrorClass.UserError);
    expect(declaredClassOf(error)).toBe(ErrorClass.UserError);

    tagErrorClass(error, ErrorClass.Infrastructure);
    expect(declaredClassOf(error)).toBe(ErrorClass.Infrastructure);
  });
});

describe("ErrorClass: report-once", () => {
  /*
   * The B2 guard at the primitive level: one thrown value must be reported
   * once no matter how many @CaptureSpan frames it crosses on its way out.
   */
  test("markErrorReported returns false first, then true", () => {
    const error: Error = new Error("once");

    expect(markErrorReported(error)).toBe(false);
    expect(markErrorReported(error)).toBe(true);
    expect(markErrorReported(error)).toBe(true);
  });

  test("each distinct thrown value gets its own first report", () => {
    expect(markErrorReported(new Error("a"))).toBe(false);
    expect(markErrorReported(new Error("b"))).toBe(false);
  });

  /*
   * A value that cannot carry the marker is reported EVERY time. Duplicated
   * reports are noisy; a dropped report is invisible. Noisy is the safe
   * direction.
   */
  test("unmarkable values are always reported", () => {
    expect(markErrorReported("a thrown string")).toBe(false);
    expect(markErrorReported("a thrown string")).toBe(false);
    expect(markErrorReported(null)).toBe(false);
    expect(markErrorReported(undefined)).toBe(false);
    expect(markErrorReported(Object.freeze(new Error("frozen")))).toBe(false);
  });

  test("clearErrorReported resets the marker", () => {
    const error: Error = new Error("reusable");

    expect(markErrorReported(error)).toBe(false);
    clearErrorReported(error);
    expect(markErrorReported(error)).toBe(false);
  });

  test("the reported marker is non-enumerable too", () => {
    const error: Error = new Error("x");
    markErrorReported(error);

    expect(Object.keys(error)).toHaveLength(0);
  });
});
