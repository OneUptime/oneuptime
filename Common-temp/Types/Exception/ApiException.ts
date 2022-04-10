import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class APIException extends Exception {
    constructor(message: string) {
        super(ExceptionCode.APIException, message);
    }
}
