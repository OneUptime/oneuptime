import TableColumnType from '../BaseDatabase/TableColumnType';

export default class AnalyticsTableColumn {
    private _key: string = 'id';
    public get key(): string {
        return this._key;
    }
    public set key(v: string) {
        this._key = v;
    }

    private _title: string = '';
    public get title(): string {
        return this._title;
    }
    public set title(v: string) {
        this._title = v;
    }

    private _description: string = '';
    public get description(): string {
        return this._description;
    }
    public set description(v: string) {
        this._description = v;
    }

    private _required: boolean = false;
    public get required(): boolean {
        return this._required;
    }
    public set required(v: boolean) {
        this._required = v;
    }

    private _type: TableColumnType = TableColumnType.ShortText;
    public get type(): TableColumnType {
        return this._type;
    }
    public set type(v: TableColumnType) {
        this._type = v;
    }

    public constructor(data: {
        key: string;
        title: string;
        description: string;
        required: boolean;
        type: TableColumnType;
    }) {
        this.key = data.key;
        this.title = data.title;
        this.description = data.description;
        this.required = data.required;
        this.type = data.type;
    }
}
