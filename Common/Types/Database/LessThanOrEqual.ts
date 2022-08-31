import CompareBase from './CompareBase';

export default class LessThanOrEqual extends CompareBase {
    constructor(value: number | Date) {
        super(value);
    }
}
