import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class SSOAuthorizationException extends Exception {
    private static message: string = 'SSO Authorization Required';

    public constructor() {
        super(
            ExceptionCode.SsoAuthorizationException,
            SSOAuthorizationException.message
        );
    }

    public static isException(errorMessage: string): boolean {
        return errorMessage === SSOAuthorizationException.message;
    }
}
