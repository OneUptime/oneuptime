import Exception from '.';
import ExceptionCode from './exceptionCode';

export default class BadDataException extends Exception {
    constructor(message: string) {
        super(ExceptionCode.BadDataException, message);
    }
}
