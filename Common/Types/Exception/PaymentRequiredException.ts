import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class PaymentRequiredException extends Exception {
    public constructor(message: string) {
        super(ExceptionCode.PaymentRequiredException, message);
    }
}
