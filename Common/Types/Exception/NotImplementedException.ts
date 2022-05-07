import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class BadDataException extends Exception {
    public constructor() {
        super(
            ExceptionCode.NotImplementedException,
            'This code is not implemented'
        );
    }
}
