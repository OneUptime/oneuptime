import Exception from "./Exception";
import ExceptionCode from "./ExceptionCode";

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
}
