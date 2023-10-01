import TableColumnType from '../Types/BaseDatabase/TableColumnType';
import AnalyticsTableColumn from '../Types/AnalyticsDatabase/TableColumn';
import BadDataException from '../Types/Exception/BadDataException';
import AnalyticsTableEngine from '../Types/AnalyticsDatabase/AnalyticsTableEngine';
import { JSONValue } from '../Types/JSON';
import ColumnBillingAccessControl from '../Types/BaseDatabase/ColumnBillingAccessControl';
import TableBillingAccessControl from '../Types/BaseDatabase/TableBillingAccessControl';
import { TableAccessControl } from '../Types/BaseDatabase/AccessControl';


export default class AnalyticsDataModel {

    public constructor(data: {
        tableName: string;
        singularName: string;
        pluralName: string;
        tableEngine?: AnalyticsTableEngine | undefined;
        tableColumns: Array<AnalyticsTableColumn>;
        allowAccessIfSubscriptionIsUnpaid?: boolean | undefined;
        tableBillingAccessControl?: TableBillingAccessControl | undefined;
        accessControl?: TableAccessControl | undefined; 
        primaryKeys: Array<string>; // this should be the subset of tableColumns
    }) {
        const columns: Array<AnalyticsTableColumn> = [...data.tableColumns];

        this.tableName = data.tableName;

        if (data.tableEngine) {
            this.tableEngine = data.tableEngine;
        }

        columns.push(
            new AnalyticsTableColumn({
                key: '_id',
                title: 'ID',
                description: 'ID of this object',
                required: true,
                type: TableColumnType.ObjectID,
            })
        );

        columns.push(
            new AnalyticsTableColumn({
                key: 'createdAt',
                title: 'Created',
                description: 'Date and Time when the object was created.',
                required: true,
                type: TableColumnType.Date,
            })
        );

        columns.push(
            new AnalyticsTableColumn({
                key: 'updatedAt',
                title: 'Updated',
                description: 'Date and Time when the object was updated.',
                required: true,
                type: TableColumnType.Date,
            })
        );

        if (!data.primaryKeys || data.primaryKeys.length === 0) {
            throw new BadDataException('Primary keys are required');
        }

        // check if primary keys are subset of tableColumns

        data.primaryKeys.forEach((primaryKey: string) => {
            if (
                !columns.find((column: AnalyticsTableColumn) => {
                    return column.key === primaryKey;
                })
            ) {
                throw new BadDataException(
                    'Primary key ' + primaryKey + ' is not part of tableColumns'
                );
            }
        });

        this.primaryKeys = data.primaryKeys;
        this.tableColumns = columns;
        this.singularName = data.singularName;
        this.pluralName = data.pluralName;
        this.tableBillingAccessControl = data.tableBillingAccessControl;
        this.allowAccessIfSubscriptionIsUnpaid = data.allowAccessIfSubscriptionIsUnpaid || false;
        this.accessControl = data.accessControl;
    }


    
    private _accessControl : TableAccessControl | undefined;
    public get accessControl() : TableAccessControl | undefined {
        return this._accessControl;
    }
    public set accessControl(v : TableAccessControl | undefined) {
        this._accessControl = v;
    }
    


    private _tableColumns: Array<AnalyticsTableColumn> = [];
    public get tableColumns(): Array<AnalyticsTableColumn> {
        return this._tableColumns;
    }
    public set tableColumns(v: Array<AnalyticsTableColumn>) {
        this._tableColumns = v;
    }

    private _tableName: string = '';
    public get tableName(): string {
        return this._tableName;
    }
    public set tableName(v: string) {
        this._tableName = v;
    }

    private _tableEngine: AnalyticsTableEngine = AnalyticsTableEngine.MergeTree;
    public get tableEngine(): AnalyticsTableEngine {
        return this._tableEngine;
    }
    public set tableEngine(v: AnalyticsTableEngine) {
        this._tableEngine = v;
    }

    private _primaryKeys: Array<string> = [];
    public get primaryKeys(): Array<string> {
        return this._primaryKeys;
    }
    public set primaryKeys(v: Array<string>) {
        this._primaryKeys = v;
    }


    
    private _singularName : string = '';
    public get singularName() : string {
        return this._singularName;
    }
    public set singularName(v : string) {
        this._singularName = v;
    }


    
    private _pluralName : string = '';
    public get pluralName() : string {
        return this._pluralName;
    }
    public set pluralName(v : string) {
        this._pluralName = v;
    }

    
    private _tableBillingAccessControl : TableBillingAccessControl | undefined;
    public get tableBillingAccessControl() : TableBillingAccessControl | undefined {
        return this._tableBillingAccessControl;
    }
    public set tableBillingAccessControl(v : TableBillingAccessControl | undefined) {
        this._tableBillingAccessControl = v;
    }

    
    private _allowAccessIfSubscriptionIsUnpaid : boolean = false;
    public get allowAccessIfSubscriptionIsUnpaid() : boolean  {
        return this._allowAccessIfSubscriptionIsUnpaid;
    }
    public set allowAccessIfSubscriptionIsUnpaid(v : boolean ) {
        this._allowAccessIfSubscriptionIsUnpaid = v;
    }
    
    
    

  
    public setColumnValue(
        columnName: string,
        value: JSONValue
    ): void {
        if (this.getTableColumn(columnName)) {
            return ((this as any)[columnName] = value as any);
        }
    }

    public getTableColumn(name: string): AnalyticsTableColumn | null {
        const column: AnalyticsTableColumn | undefined = this.tableColumns.find(
            (column: AnalyticsTableColumn) => {
                return column.key === name;
            }
        );

        if (!column) {
            return null;
        }

        return column;
    }

    public getTableColumns(): Array<AnalyticsTableColumn> { 
        return this.tableColumns;
    }
    
    public getTenantColumn(): AnalyticsTableColumn | null {
        const column: AnalyticsTableColumn | undefined = this.tableColumns.find(
            (column: AnalyticsTableColumn) => {
                return column.isTenantId;
            }
        );

        if (!column) {
            return null;
        }

        return column;
    }

    public getRequiredColumns(): Array<AnalyticsTableColumn> {
        return this.tableColumns.filter((column: AnalyticsTableColumn) => {
            return column.required;
        });
    }

    public isDefaultValueColumn(columnName: string): boolean {
        const column: AnalyticsTableColumn | null = this.getTableColumn(
            columnName
        );

        if (!column) {
            return false;
        }

        return column.isDefaultValueColumn;
    }

    public getColumnBillingAccessControl(
        columnName: string
    ): ColumnBillingAccessControl | null {
        const column: AnalyticsTableColumn | null = this.getTableColumn(
            columnName
        );

        if (!column) {
            return null;
        }

        return column.billingAccessControl || null;
    }


}
