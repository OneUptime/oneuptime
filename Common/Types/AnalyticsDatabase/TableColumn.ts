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

    
    private _isTenantId : boolean = false;
    public get isTenantId() : boolean {
        return this._isTenantId;
    }
    public set isTenantId(v : boolean) {
        this._isTenantId = v;
    }
    

    private _type: TableColumnType = TableColumnType.ShortText;
    public get type(): TableColumnType {
        return this._type;
    }
    public set type(v: TableColumnType) {
        this._type = v;
    }
    
    private _forceGetDefaultValueOnCreate?: (() =>  Date | string | number | boolean) | undefined;
    public get forceGetDefaultValueOnCreate(): (() =>  Date | string | number | boolean) | undefined {
        return this._forceGetDefaultValueOnCreate;
    }
    public set forceGetDefaultValueOnCreate(v: (() =>  Date | string | number | boolean) | undefined) {
        this._forceGetDefaultValueOnCreate = v;
    }

    private _isDefaultValueColumn : boolean = false;
    public get isDefaultValueColumn() : boolean {
        return this._isDefaultValueColumn;
    }
    public set isDefaultValueColumn(v : boolean) {
        this._isDefaultValueColumn = v;
    }
    

    public constructor(data: {
        key: string;
        title: string;
        description: string;
        required: boolean;
        type: TableColumnType;
        isDefaultValueColumn? : boolean | undefined;
        isTenantId?: boolean | undefined;
        forceGetDefaultValueOnCreate?: (() =>  Date | string | number | boolean) | undefined;
    }) {
        this.key = data.key;
        this.title = data.title;
        this.description = data.description;
        this.required = data.required;
        this.type = data.type;
        this.isTenantId = data.isTenantId || false;
        this.forceGetDefaultValueOnCreate = data.forceGetDefaultValueOnCreate;
        this.isDefaultValueColumn = data.isDefaultValueColumn || false;
    }
}
