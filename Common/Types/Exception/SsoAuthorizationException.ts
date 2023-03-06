import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class NotAuthorizedException extends Exception {
    public constructor() {
        super(ExceptionCode.NotAuthorizedException, "SSO Authorization Required");
    }
}
