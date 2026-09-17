import ExceptionCode from "./ExceptionCode";
import ErrorClass, {
  tagErrorClass,
  tagErrorClassAuthoritative,
} from "../Telemetry/ErrorClass";

export default class Exception extends Error {
  private _code: ExceptionCode = ExceptionCode.GeneralException;

  public get code(): ExceptionCode {
    return this._code;
  }

  public set code(value: ExceptionCode) {
    this._code = value;
  }

  public constructor(code: ExceptionCode, message: string) {
    super(message);
    this.code = code;

    /*
     * Tag the fault domain at construction. Calling a prototype method from
     * the base constructor dispatches to the subclass override (prototypes are
     * wired before the constructor body runs), so each subclass answers for
     * itself. getErrorClass must therefore never read subclass FIELDS — those
     * initialize after super() returns — which is why every override returns a
     * constant.
     */
    tagErrorClass(this, this.getErrorClass());
  }

  /*
   * The fault domain for this exception class.
   *
   * CODE-FAULT IS THE BASE DEFAULT ON PURPOSE. A new subclass added without an
   * override, or an exception whose author never thought about this, stays
   * NOISY. The failure mode of the whole classification scheme must be
   * over-reporting — there is no configuration in which silence is the
   * default.
   *
   * This is deliberately keyed on the CLASS, not on `code`: BadDataException
   * and BadRequestException are both 400, ServerException and
   * DatabaseNotConnectedException are both 500, and five ExceptionCode members
   * (NotImplemented=0, General=1, API=2, BadOperation=5, WebRequest=6) are not
   * HTTP statuses at all.
   *
   * Note that declaring a class here is not the last word: a user-error or
   * expected-denial raised OUTSIDE an HTTP request is promoted back to
   * code-fault by ErrorClassResolver, because a background job has no client
   * to blame.
   */
  protected getErrorClass(): ErrorClass {
    return ErrorClass.CodeFault;
  }

  /**
   * Override the declared fault domain for one particular throw, where the
   * class-level default is wrong at a specific site. Chainable:
   * `throw new BadDataException(msg).asCodeFault()`.
   *
   * These are AUTHORITATIVE: a developer looked at this one site and said what
   * it is, so unlike the class-level default they are exempt from the
   * unit-of-work promotion. Use them when the surrounding context genuinely
   * changes the answer — e.g. a probe reporting that the endpoint it was asked
   * to check is down, which is the product working, not a defect.
   */
  public asCodeFault(): this {
    return tagErrorClassAuthoritative(this, ErrorClass.CodeFault);
  }

  public asUserError(): this {
    return tagErrorClassAuthoritative(this, ErrorClass.UserError);
  }

  public asExpectedDenial(): this {
    return tagErrorClassAuthoritative(this, ErrorClass.ExpectedDenial);
  }

  public asInfrastructure(): this {
    return tagErrorClassAuthoritative(this, ErrorClass.Infrastructure);
  }

  public getMessage(): string {
    return this.message;
  }
}
