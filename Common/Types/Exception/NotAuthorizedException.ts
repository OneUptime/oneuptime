import Exception from "./Exception";
import ExceptionCode from "./ExceptionCode";
import ErrorClass from "../Telemetry/ErrorClass";

export default class NotAuthorizedException extends Exception {
  public constructor(message: string) {
    super(ExceptionCode.NotAuthorizedException, message);
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
