import CompareBase from './CompareBase';

export default class GreaterThan extends CompareBase {
    constructor(value: number | Date) {
        super(value);
    }
}
