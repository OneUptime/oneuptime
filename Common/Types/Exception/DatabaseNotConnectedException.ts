import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class DatabaseNotConnectedException extends Exception {
    public constructor() {
        super(
            ExceptionCode.DatabaseNotConnectedException,
            'Database not connected'
        );
    }
}
