import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class TenantNotFoundException extends Exception {
    public constructor(message: string) {
        super(ExceptionCode.TenantNotFoundException, message);
    }
}
