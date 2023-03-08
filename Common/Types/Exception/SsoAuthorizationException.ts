import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class NotAuthorizedException extends Exception {
    public constructor() {
        super(
            ExceptionCode.SsoAuthorizationException,
            'SSO Authorization Required'
        );
    }
}
