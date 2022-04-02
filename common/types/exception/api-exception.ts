import Exception from '.';
import ExceptionCode from './exception-code';

export default class APIException extends Exception {
    constructor(message: string) {
        super(ExceptionCode.APIException, message);
    }
}
