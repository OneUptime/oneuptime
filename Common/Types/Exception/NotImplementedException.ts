import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class NotImplementedException extends Exception {
    public constructor() {
        super(
            ExceptionCode.NotImplementedException,
            'This code is not implemented'
        );
    }
}
