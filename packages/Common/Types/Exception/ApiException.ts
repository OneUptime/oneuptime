import Exception from "./Exception";
import ExceptionCode from "./ExceptionCode";
import ErrorClass from "../Telemetry/ErrorClass";

export default class APIException extends Exception {
  private _error: Error | null = null;
  public get error(): Error | null {
    return this._error || null;
  }
  public set error(v: Error | null) {
    this._error = v;
  }

  public constructor(message: string, error?: Error) {
    super(ExceptionCode.APIException, message);
    if (error) {
      this.error = error;
    }
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
