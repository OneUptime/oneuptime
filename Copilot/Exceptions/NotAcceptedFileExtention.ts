import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";

export default class NotAcceptedFileExtentionForCopilotAction extends Exception {
  public constructor(message: string) {
    super(ExceptionCode.BadDataException, message);
  }
}
