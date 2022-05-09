import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class BadRequestException extends Exception {
    public constructor(message: string) {
        super(ExceptionCode.BadDataException, message);
    }
}
