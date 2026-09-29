import ErrorClass, {
  DeclaredErrorClass,
  declaredErrorClass,
  isNonActionableErrorClass,
  toErrorClass,
} from "../../../Types/Telemetry/ErrorClass";
import {
  UNIT_OF_WORK_ATTRIBUTE_KEY,
  UnitOfWork,
} from "../../../Types/Telemetry/UnitOfWork";
import { TelemetryErrorClassEnabled } from "../../EnvironmentConfig";
import TelemetryContext from "./TelemetryContext";

/**
 * Decides the fault domain of a thrown value: is this OUR bug, or a
 * consequence of what someone asked us to do?
 *
 * Two rules, in order, and neither of them asks the catch site to make a
 * judgment call.
 *
 * 1. UNDECLARED MEANS CODE-FAULT. A raw TypeError, a TypeORM QueryFailedError,
 *    an axios error, a thrown string — nobody predicted it, so by definition
 *    it is a bug. This is also what happens to an Exception subclass whose
 *    author never overrode getErrorClass. The scheme's failure mode is
 *    over-reporting, always.
 *
 * 1b. UNLESS THE SITE SAID SO ITSELF. A class declared for one specific throw
 *    or one specific log line (Exception.asUserError(), or an `error.class`
 *    attribute on a logger.error call) is authoritative and skips rule 2. Rule
 *    2 exists to stop a class-level GENERALISATION being trusted in the wrong
 *    context; it should not overrule a developer who looked at one site. This
 *    is what lets a probe report "the endpoint we were asked to check is down"
 *    as a non-defect even though a probe check has no request around it.
 *
 * 2. A USER-ERROR NEEDS A USER. user-error and expected-denial are honoured
 *    only inside an HTTP request. In a worker job, a cron run, a probe check,
 *    at startup, or outside any scope at all, there is no client whose request
 *    could have been wrong — so the "bad input" was produced by our own code,
 *    and that is a bug. They are promoted back to code-fault.
 *
 * code-fault and infrastructure are honoured everywhere: neither is ever
 * suppressed, so promoting them would be meaningless.
 *
 * Known limitation, documented rather than papered over: a request handler
 * that starts background work with `.catch()` after responding stays inside
 * the http-request scope, so an invariant violation in that async tail is
 * still labelled user-error. It still emits a `fault` span event, a WARN log
 * and an `oneuptime.fault.count` increment, so it remains findable — see the
 * standing review queries in the release notes.
 */
export default class ErrorClassResolver {
  public static resolve(
    error: unknown,
    declaredOverride?: unknown,
  ): ErrorClass {
    if (!TelemetryErrorClassEnabled) {
      /*
       * Kill switch. Everything is a code-fault, which reproduces the
       * pre-classification behaviour exactly: exception event, ERROR status,
       * ERROR log.
       */
      return ErrorClass.CodeFault;
    }

    /*
     * An explicit class handed in by the caller (e.g. the `error.class`
     * attribute on a logger.error call) is a site-level declaration and wins
     * outright — including over the unit-of-work promotion.
     */
    const override: ErrorClass | null = toErrorClass(declaredOverride);

    if (override !== null) {
      return override;
    }

    const declared: DeclaredErrorClass | null = declaredErrorClass(error);

    if (declared === null) {
      return ErrorClass.CodeFault;
    }

    if (
      declared.authoritative ||
      !isNonActionableErrorClass(declared.errorClass)
    ) {
      return declared.errorClass;
    }

    return this.isInsideHttpRequest()
      ? declared.errorClass
      : ErrorClass.CodeFault;
  }

  /**
   * Whether the resolved class is one we deliberately keep out of the Issues
   * list. Convenience so callers do not have to import both this and the
   * predicate.
   */
  public static isNonActionable(
    error: unknown,
    declaredOverride?: unknown,
  ): boolean {
    return isNonActionableErrorClass(this.resolve(error, declaredOverride));
  }

  private static isInsideHttpRequest(): boolean {
    try {
      return (
        TelemetryContext.getAttributes()[UNIT_OF_WORK_ATTRIBUTE_KEY] ===
        UnitOfWork.HttpRequest
      );
    } catch {
      /*
       * No AsyncLocalStorage scope, or telemetry disabled. "Not a request" is
       * the safe answer: it promotes toward code-fault.
       */
      return false;
    }
  }
}
