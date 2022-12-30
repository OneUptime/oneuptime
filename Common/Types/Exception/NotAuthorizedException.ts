import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class NotAuthorizedException extends Exception {
    public constructor(message: string) {
        super(ExceptionCode.NotAuthorizedException, message);
    }
}
