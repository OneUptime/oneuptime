import Exception from "./Exception";
import ExceptionCode from "./ExceptionCode";

export default class ServiceUnavailableException extends Exception {
  public constructor(message: string) {
    super(ExceptionCode.ServiceUnavailableException, message);
  }
}
