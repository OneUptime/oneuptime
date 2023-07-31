import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class NotAuthenticatedException extends Exception {
    public constructor(message: string) {
        super(ExceptionCode.NotAuthenticatedException, message);
    }
}
