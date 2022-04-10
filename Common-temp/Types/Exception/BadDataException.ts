import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class BadDataException extends Exception {
    constructor(message: string) {
        super(ExceptionCode.BadDataException, message);
    }
}
