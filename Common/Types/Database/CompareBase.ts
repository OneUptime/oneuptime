export default class CompareBase {
    private _value!: number;
    public get value(): number {
        return this._value;
    }
    public set value(v: number) {
        this._value = v;
    }

    public constructor(value: number) {
        this.value = value;
    }

    public toString(): string {
        return this.value.toString();
    }

    public toNumber(): number {
        return this.value;
    }
}
