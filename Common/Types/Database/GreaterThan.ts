import CompareBase from './CompareBase';

export default class GreaterThan extends CompareBase {
    public constructor(value: number | Date) {
        super(value);
    }
}
