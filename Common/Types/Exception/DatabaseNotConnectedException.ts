import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class DatabaseNotConnectedException extends Exception {
    public constructor(message?: string) {
        super(
            ExceptionCode.DatabaseNotConnectedException,
            message || 'Database not connected'
        );
    }
}
