export default class Name {
    private _title: string = '';
    public get title(): string {
        return this._title;
    }
    public set title(v: string) {
        this._title = v;
    }

    private _name: string = '';
    public get name(): string {
        return this._name;
    }
    public set name(v: string) {
        this._name = v;
    }

    constructor(name: string) {
        this.name = name;
    }

    getFirstName(): string {
        return this.name.split(' ')[0];
    }

    getLastName(): string {
        return this.name.split(' ')[this.name.split(' ').length - 1];
    }

    getMiddleName(): string {
        return this.name.split(' ')[0];
    }

    toString(): string {
        return this.name;
    }
}
