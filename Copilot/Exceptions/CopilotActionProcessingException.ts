import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";

export default class CopilotActionProcessingException extends Exception {
    public constructor(code: ExceptionCode, message: string) {
        super(code, message);
    }
}