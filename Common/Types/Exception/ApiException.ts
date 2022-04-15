import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class APIException extends Exception {
    public constructor(message: string) {
        super(ExceptionCode.APIException, message);
    }
}
