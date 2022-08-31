export default class InBetween {
    private _startValue!: number | Date;
    public get startValue(): number | Date {
        return this._startValue;
    }
    public set startValue(v: number | Date) {
        this._startValue = v;
    }

    private _endValue!: number | Date;
    public get endValue(): number | Date {
        return this._endValue;
    }
    public set endValue(v: number | Date) {
        this._endValue = v;
    }

    public constructor(startValue: number | Date, endValue: number | Date) {
        this.endValue = endValue;
        this.startValue = startValue;
    }

    public toString(): string {
        return this.startValue.toString() + ' - ' + this.endValue.toString();
    }
}
