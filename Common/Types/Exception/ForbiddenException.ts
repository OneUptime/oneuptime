import Exception from "./Exception";
import ExceptionCode from "./ExceptionCode";

export default class ForbiddenException extends Exception {
  public constructor(message: string) {
    super(ExceptionCode.ForbiddenException, message);
  }
}
