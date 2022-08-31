import CompareBase from './CompareBase';

export default class LessThanOrEqual extends CompareBase {
    public constructor(value: number | Date) {
        super(value);
    }
}
