import OneUptimeDate from '../Date';

export default class InBetween {
    private _startValue!: number | Date | string;
    public get startValue(): number | Date | string {
        return this._startValue;
    }
    public set startValue(v: number | Date | string) {
        this._startValue = v;
    }

    private _endValue!: number | Date | string;
    public get endValue(): number | Date | string {
        return this._endValue;
    }
    public set endValue(v: number | Date | string) {
        this._endValue = v;
    }

    public constructor(
        startValue: number | Date | string,
        endValue: number | Date | string
    ) {
        this.endValue = endValue;
        this.startValue = startValue;
    }

    public toString(): string {
        let startValue: number | Date | string = this.startValue;
        let endValue: number | Date | string = this.endValue;

        if (startValue instanceof Date) {
            startValue = OneUptimeDate.asDateForDatabaseQuery(startValue);
        }

        if (endValue instanceof Date) {
            endValue = OneUptimeDate.asDateForDatabaseQuery(endValue);
        }

        if (startValue.toString() === endValue.toString()) {
            return this.startValue.toString();
        }

        return this.startValue.toString() + ' - ' + this.endValue.toString();
    }

    public toStartValueString(): string {
        return this.startValue.toString();
    }

    public toEndValueString(): string {
        return this.endValue.toString();
    }
}
