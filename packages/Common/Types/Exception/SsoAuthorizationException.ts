import Exception from "./Exception";
import ExceptionCode from "./ExceptionCode";
import ErrorClass from "../Telemetry/ErrorClass";

export default class SSOAuthorizationException extends Exception {
  private static message: string = "SSO Authorization Required";

  public constructor() {
    super(
      ExceptionCode.SsoAuthorizationException,
      SSOAuthorizationException.message,
    );
  }

  public static isException(errorMessage: string): boolean {
    return errorMessage === SSOAuthorizationException.message;
  }

  /*
   * A check we deliberately wrote, doing exactly its job. Denying this
   * request IS the correct behaviour, so it is not an Issue. Promoted back to
   * CodeFault outside an HTTP request — see ErrorClassResolver.
   */
  protected override getErrorClass(): ErrorClass {
    return ErrorClass.ExpectedDenial;
  }
}
