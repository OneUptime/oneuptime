import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class TimeoutException extends Exception {
    public constructor(message: string) {
        super(ExceptionCode.TimeoutException, message);
    }
}
