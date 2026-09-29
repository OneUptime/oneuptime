import Exception from "./Exception";
import ExceptionCode from "./ExceptionCode";
import ErrorClass from "../Telemetry/ErrorClass";

export default class TimeoutException extends Exception {
  public constructor(message: string) {
    super(ExceptionCode.TimeoutException, message);
  }

  /*
   * The environment failed, not our code and not the caller. Stays an
   * Issue: it is a real failure worth a human, it is just never something the
   * automatic fix lane should open a pull request for.
   */
  protected override getErrorClass(): ErrorClass {
    return ErrorClass.Infrastructure;
  }
}
