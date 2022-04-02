export default class PositiveNumber {
    private _positiveNumber: number = 0;
    public get positiveNumber(): number {
        return this._positiveNumber;
    }
    public set positiveNumber(v: number) {
        this._positiveNumber = v;
    }

    constructor(positiveNumber: number) {
        this.positiveNumber = positiveNumber;
    }

    toString(): string {
        return this.positiveNumber.toString();
    }

    toNumber(): number {
        return this.positiveNumber;
    }
}
