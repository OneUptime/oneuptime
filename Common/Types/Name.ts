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

    public constructor(name: string) {
        this.name = name;
    }

    public getFirstName(): string {
        return this.name.split(' ')[0] || '';
    }

    public getLastName(): string {
        if (this.name.split(' ').length > 1) {
            return this.name.split(' ')[this.name.split(' ').length - 1] || '';
        }
        return '';
    }

    public getMiddleName(): string {
        if (this.name.split(' ').length > 2) {
            return this.name.split(' ')[1] || '';
        }
        return '';
    }

    public toString(): string {
        return this.name;
    }
}
