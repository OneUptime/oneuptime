import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class BadOperationException extends Exception {
    public constructor(message: string) {
        super(ExceptionCode.BadOperationException, message);
    }
}
