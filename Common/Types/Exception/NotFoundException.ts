import Exception from './Exception';
import ExceptionCode from './ExceptionCode';

export default class NotFoundException extends Exception {
    public constructor(message: string) {
        super(ExceptionCode.NotFoundException, message);
    }
}
