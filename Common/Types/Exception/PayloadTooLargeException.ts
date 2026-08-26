import Exception from "./Exception";
import ExceptionCode from "./ExceptionCode";

export default class PayloadTooLargeException extends Exception {
  public constructor(message: string) {
    super(ExceptionCode.PayloadTooLargeException, message);
  }
}
