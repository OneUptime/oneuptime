import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class WebsiteRequestException extends Exception {
    public constructor(message: string) {
        super(ExceptionCode.WebRequestException, message);
    }
}
