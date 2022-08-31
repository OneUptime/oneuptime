import CompareBase from './CompareBase';

export default class GreaterThanOrEqual extends CompareBase {
    public constructor(value: number | Date) {
        super(value);
    }
}
