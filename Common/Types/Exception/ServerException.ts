import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class ServerException extends Exception {
    public constructor(message?: string) {
        super(ExceptionCode.ServerException, message || 'Server Error');
    }
}
