import Exception from '.';
import ExceptionCode from './exceptionCode';

export default class APIException extends Exception {
    constructor(message: string) {
        super(ExceptionCode.APIException, message);
    }
}
