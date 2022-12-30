export default class Search {
    private _searchValue!: string;
    public get value(): string {
        return this._searchValue;
    }
    public set value(v: string) {
        this._searchValue = v;
    }

    public constructor(value: string) {
        this.value = value;
    }

    public toString(): string {
        return this.value;
    }
}
