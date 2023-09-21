import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class UnableToReachServer extends Exception {
    public constructor(message: string) {
        super(ExceptionCode.UnabletoReachServerException, message);
    }
}
