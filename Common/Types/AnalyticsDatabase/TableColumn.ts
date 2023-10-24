import { ColumnAccessControl } from '../BaseDatabase/AccessControl';
import ColumnBillingAccessControl from '../BaseDatabase/ColumnBillingAccessControl';
import TableColumnType from '../AnalyticsDatabase/TableColumnType';
import { JSONValue } from '../JSON';
import NestedModel from '../../AnalyticsModels/NestedModel';

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

    private _isTenantId: boolean = false;
    public get isTenantId(): boolean {
        return this._isTenantId;
    }
    public set isTenantId(v: boolean) {
        this._isTenantId = v;
    }

    private _type: TableColumnType = TableColumnType.Text;
    public get type(): TableColumnType {
        return this._type;
    }
    public set type(v: TableColumnType) {
        this._type = v;
    }

    private _forceGetDefaultValueOnCreate?:
        | (() => Date | string | number | boolean)
        | undefined;
    public get forceGetDefaultValueOnCreate():
        | (() => Date | string | number | boolean)
        | undefined {
        return this._forceGetDefaultValueOnCreate;
    }
    public set forceGetDefaultValueOnCreate(
        v: (() => Date | string | number | boolean) | undefined
    ) {
        this._forceGetDefaultValueOnCreate = v;
    }

    private _defaultValue: JSONValue | undefined;
    public get defaultValue(): JSONValue {
        return this._defaultValue;
    }
    public set defaultValue(v: JSONValue) {
        this._defaultValue = v;
    }

    public get isDefaultValueColumn(): boolean {
        return Boolean(this.defaultValue !== undefined);
    }

    private _billingAccessControl?: ColumnBillingAccessControl | undefined;
    public get billingAccessControl(): ColumnBillingAccessControl | undefined {
        return this._billingAccessControl;
    }
    public set billingAccessControl(v: ColumnBillingAccessControl | undefined) {
        this._billingAccessControl = v;
    }

    private _allowAccessIfSubscriptionIsUnpaid: boolean = false;
    public get allowAccessIfSubscriptionIsUnpaid(): boolean {
        return this._allowAccessIfSubscriptionIsUnpaid;
    }
    public set allowAccessIfSubscriptionIsUnpaid(v: boolean) {
        this._allowAccessIfSubscriptionIsUnpaid = v;
    }

    private _accessControl: ColumnAccessControl | undefined;
    public get accessControl(): ColumnAccessControl | undefined {
        return this._accessControl;
    }
    public set accessControl(v: ColumnAccessControl | undefined) {
        this._accessControl = v;
    }

    private _nestedModel?: NestedModel | undefined;
    public get nestedModel(): NestedModel | undefined {
        return this._nestedModel;
    }
    public set nestedModel(v: NestedModel | undefined) {
        this._nestedModel = v;
    }

    public constructor(data: {
        key: string;
        nestedModel?: NestedModel | undefined;
        title: string;
        description: string;
        required: boolean;
        defaultValue?: JSONValue | undefined;
        type: TableColumnType;
        billingAccessControl?: ColumnBillingAccessControl | undefined;
        isTenantId?: boolean | undefined;
        accessControl?: ColumnAccessControl | undefined;
        allowAccessIfSubscriptionIsUnpaid?: boolean | undefined;
        forceGetDefaultValueOnCreate?:
            | (() => Date | string | number | boolean)
            | undefined;
    }) {
        if (data.type === TableColumnType.NestedModel && !data.nestedModel) {
            throw new Error('NestedModel is required when type is NestedModel');
        }

        this.accessControl = data.accessControl;
        this.key = data.key;
        this.title = data.title;
        this.description = data.description;
        this.required = data.required;
        this.type = data.type;
        this.isTenantId = data.isTenantId || false;
        this.forceGetDefaultValueOnCreate = data.forceGetDefaultValueOnCreate;
        this.defaultValue = data.defaultValue;
        this.billingAccessControl = data.billingAccessControl;
        this.allowAccessIfSubscriptionIsUnpaid =
            data.allowAccessIfSubscriptionIsUnpaid || false;
        this.nestedModel = data.nestedModel;
    }
}
