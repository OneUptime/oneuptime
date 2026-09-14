/*
 * The fault domain of a thrown value: whose problem is it?
 *
 * This is the canonical vocabulary for the whole platform. It was originally
 * introduced as `ExceptionAIClassification` — an after-the-fact LLM verdict on
 * an already-ingested exception group — but the same five values are what the
 * emitting code needs in order to decide, at the moment an error is thrown,
 * whether it is worth waking anyone up. That file now re-exports this one so
 * there is exactly ONE answer to "what kind of failure is this" in the
 * codebase, with several possible sources (declared > human > AI > default).
 *
 * - CodeFault: a defect in the monitored code — the only class the automatic
 *   fix lane opens pull requests for. This is the BASE DEFAULT on purpose:
 *   forgetting to classify an exception must leave it noisy, never silent.
 * - UserError: expected consequence of invalid end-user input (bad
 *   parameters, malformed values). The right change, if any, is earlier
 *   validation and clearer error UX — routed to a human, never auto-fixed.
 * - ExpectedDenial: an intentional check doing its job (auth failure,
 *   plan/paywall denial, scanner/fuzzer probe tripping validation).
 *   Never auto-fixed; optionally auto-archived.
 * - Infrastructure: environmental conditions (timeouts, connection resets,
 *   resource exhaustion) where a code "fix" is usually tuning — routed to a
 *   human. NOTE: this stays an Issue. It is a real failure, just not one to
 *   auto-fix.
 * - Unknown: triage could not decide — treated conservatively (no automatic
 *   fix, and still shown).
 */
enum ErrorClass {
  CodeFault = "code-fault",
  UserError = "user-error",
  ExpectedDenial = "expected-denial",
  Infrastructure = "infrastructure",
  Unknown = "unknown",
}

/*
 * The classes that do NOT warrant an Issue. Everything else — including
 * Infrastructure and Unknown — stays loud.
 *
 * Exported as the single list so the emit path, the ingest path, the Issues
 * list default scope and the AI detectors can never drift apart on which
 * classes are suppressed.
 */
export const NON_ACTIONABLE_ERROR_CLASSES: ReadonlyArray<ErrorClass> = [
  ErrorClass.UserError,
  ErrorClass.ExpectedDenial,
];

export function isNonActionableErrorClass(value: unknown): boolean {
  return NON_ACTIONABLE_ERROR_CLASSES.includes(value as ErrorClass);
}

/**
 * Every value the enum can take, for validating strings that arrive from
 * outside (an OTLP attribute, a database column written by an older release).
 */
export function toErrorClass(value: unknown): ErrorClass | null {
  if (typeof value !== "string") {
    return null;
  }

  const match: ErrorClass | undefined = Object.values(ErrorClass).find(
    (candidate: ErrorClass) => {
      return candidate === value;
    },
  );

  return match ?? null;
}

/*
 * `Symbol.for` rather than `Symbol()`: Common/ ships its own node_modules and
 * is consumed by App/, Probe/, Runner/ and others, so this module can be
 * instantiated more than once in a single process. A unique symbol would not
 * match across those instances and a tag written by one copy would be
 * invisible to another. The global symbol registry is keyed by string, so all
 * copies agree.
 */
const ERROR_CLASS_SYMBOL: symbol = Symbol.for("oneuptime.error.class");
const ERROR_CLASS_AUTHORITATIVE_SYMBOL: symbol = Symbol.for(
  "oneuptime.error.class.authoritative",
);
const ERROR_REPORTED_SYMBOL: symbol = Symbol.for("oneuptime.error.reported");

/**
 * A fault domain plus how much to trust it.
 *
 * `authoritative: false` is a CLASS-LEVEL default — "BadDataException usually
 * means the caller sent something wrong". It is a generalisation, so it is
 * subject to the unit-of-work promotion: outside an HTTP request there is no
 * caller, and the generalisation does not hold.
 *
 * `authoritative: true` is a SITE-LEVEL declaration — a developer looked at
 * one specific throw or one specific log line and said what it is. That is a
 * deliberate, reviewable judgment about a single place in the code, so it is
 * never second-guessed. This is what lets a probe report "the endpoint we were
 * asked to check is down" as a non-defect even though a probe check has no
 * HTTP request around it.
 */
export interface DeclaredErrorClass {
  errorClass: ErrorClass;
  authoritative: boolean;
}

type Taggable = { [key: symbol]: unknown };

function canTag(value: unknown): value is Taggable {
  return (
    value !== null && (typeof value === "object" || typeof value === "function")
  );
}

/**
 * Attach a fault domain to a thrown value.
 *
 * `enumerable: false` keeps it invisible to `JSON.stringify`,
 * `Logger.redactBody` and `Telemetry.getExceptionAttributes`, so tagging can
 * never change what a log line or a span attribute bag looks like.
 *
 * Never throws: this runs from the `Exception` constructor and from catch
 * blocks, where a frozen object or a hostile Proxy must not take down the
 * error path. Returns the value so it can be tagged inline.
 */
export function tagErrorClass<T>(
  value: T,
  errorClass: ErrorClass,
  authoritative: boolean = false,
): T {
  if (!canTag(value)) {
    return value;
  }

  try {
    Object.defineProperty(value, ERROR_CLASS_SYMBOL, {
      value: errorClass,
      enumerable: false,
      writable: true,
      configurable: true,
    });

    if (authoritative) {
      Object.defineProperty(value, ERROR_CLASS_AUTHORITATIVE_SYMBOL, {
        value: true,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // Frozen / sealed / exotic object — the resolver falls back to CodeFault.
  }

  return value;
}

/**
 * Declare the fault domain for ONE specific throw or log line, overriding the
 * class-level default and exempting it from the unit-of-work promotion.
 */
export function tagErrorClassAuthoritative<T>(
  value: T,
  errorClass: ErrorClass,
): T {
  return tagErrorClass(value, errorClass, true);
}

/**
 * Read the fault domain a thrown value declared for itself, or null when it
 * declared none.
 *
 * A null return is meaningful and must stay distinct from
 * `ErrorClass.Unknown`: "nobody predicted this" is the strongest possible
 * signal that it is a bug, whereas Unknown means "we looked and could not
 * tell". Callers turn null into CodeFault.
 *
 * Also duck-types off a plain `errorClass` property so an error crossing a
 * process or module boundary (where the symbol is lost) can still declare
 * itself.
 */
export function declaredErrorClass(value: unknown): DeclaredErrorClass | null {
  if (!canTag(value)) {
    return null;
  }

  try {
    const authoritative: boolean =
      value[ERROR_CLASS_AUTHORITATIVE_SYMBOL] === true;

    const tagged: ErrorClass | null = toErrorClass(value[ERROR_CLASS_SYMBOL]);

    if (tagged !== null) {
      return { errorClass: tagged, authoritative: authoritative };
    }

    /*
     * Duck-type off a plain property too, so an error that crossed a process
     * or module boundary (where the symbol is lost) can still declare itself.
     * A property survives serialization, so treat it as a deliberate
     * declaration.
     */
    const ducked: ErrorClass | null = toErrorClass(
      (value as { errorClass?: unknown }).errorClass,
    );

    if (ducked !== null) {
      return { errorClass: ducked, authoritative: true };
    }

    return null;
  } catch {
    // Throwing getter on an exotic thrown value.
    return null;
  }
}

/**
 * Mark a thrown value as already reported, returning whether it had ALREADY
 * been marked.
 *
 * This is what stops one thrown error from filing N exception events as it
 * propagates through N `@CaptureSpan` frames. The fingerprint hashes no spanId
 * and no span name, so without this every frame's event lands in the same
 * group and `occuranceCount` jumps by the depth of the call stack — measured
 * at 3 for a create with a missing field and 6 for a permission-denied
 * get-list.
 *
 * Untaggable values (a thrown string, a frozen object) always report `false`,
 * i.e. they are reported every time. Over-reporting is the safe direction.
 */
export function markErrorReported(value: unknown): boolean {
  if (!canTag(value)) {
    return false;
  }

  try {
    const alreadyReported: boolean = value[ERROR_REPORTED_SYMBOL] === true;

    if (!alreadyReported) {
      Object.defineProperty(value, ERROR_REPORTED_SYMBOL, {
        value: true,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }

    return alreadyReported;
  } catch {
    return false;
  }
}

/**
 * Test seam: forget that a value was reported. Only used by tests that reuse
 * one error object across cases.
 */
export function clearErrorReported(value: unknown): void {
  if (!canTag(value)) {
    return;
  }

  try {
    Object.defineProperty(value, ERROR_REPORTED_SYMBOL, {
      value: false,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  } catch {
    // Nothing to clear.
  }
}

export default ErrorClass;
