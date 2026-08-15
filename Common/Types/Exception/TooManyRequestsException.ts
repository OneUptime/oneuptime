import Exception from "./Exception";
import ExceptionCode from "./ExceptionCode";

export default class TooManyRequestsException extends Exception {
  public constructor(message: string) {
    super(ExceptionCode.TooManyRequestsException, message);
  }
}
