import CompareBase from './CompareBase';

export default class LessThan extends CompareBase {
    public constructor(value: number | Date) {
        super(value);
    }
}
