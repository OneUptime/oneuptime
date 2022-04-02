import Exception from '.';
import ExceptionCode from './exception-code';

export default class BadDataException extends Exception {
    constructor(message: string) {
        super(ExceptionCode.BadDataException, message);
    }
}
