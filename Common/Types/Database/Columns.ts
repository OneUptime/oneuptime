import GenericObject from "../GenericObject";

export default class Columns<T extends GenericObject> {
    private _columns: Array<keyof T> = [];
    public get columns(): Array<keyof T> {
        return this._columns;
    }
    public set columns(v: Array<keyof T>) {
        this._columns = v;
    }

    public constructor(columns: Array<keyof T>) {
        this.columns = columns;
    }

    public addColumn(columnName: keyof T): void {
        this.columns.push(columnName);
    }

    public hasColumn(columnName: keyof T): boolean {
        return this.columns.includes(columnName);
    }
}
