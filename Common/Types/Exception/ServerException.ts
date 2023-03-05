import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class ServerException extends Exception {
    public constructor() {
        super(ExceptionCode.ServerException, "Server Error");
    }
}
