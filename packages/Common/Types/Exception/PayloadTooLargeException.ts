import Exception from "./Exception";
import ExceptionCode from "./ExceptionCode";
import ErrorClass from "../Telemetry/ErrorClass";

export default class PayloadTooLargeException extends Exception {
  public constructor(message: string) {
    super(ExceptionCode.PayloadTooLargeException, message);
  }

  /*
   * The caller sent something we cannot accept. Nothing is broken; the
   * request was. Promoted back to CodeFault by ErrorClassResolver when it is
   * raised outside an HTTP request, because a background job has no client to
   * blame — see Common/Server/Utils/Telemetry/ErrorClassResolver.ts.
   */
  protected override getErrorClass(): ErrorClass {
    return ErrorClass.UserError;
  }
}
