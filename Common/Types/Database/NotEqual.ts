export default class NotEqual {
    private _value!: string;
    public get value(): string {
        return this._value;
    }
    public set value(v: string) {
        this._value = v;
    }

    public constructor(value: string) {
        this.value = value;
    }

    public toString(): string {
        return this.value;
    }
}
