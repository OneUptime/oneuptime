import {
    DeleteDateColumn,
    UpdateDateColumn,
    CreateDateColumn,
    VersionColumn,
    PrimaryGeneratedColumn,
    BaseEntity,
} from 'typeorm';

import Columns from '../Types/Database/Columns';
import TableColumn, {
    getTableColumn,
    getTableColumns,
    TableColumnMetadata,
} from '../Types/Database/TableColumn';
import { JSONArray, JSONObject, JSONValue } from '../Types/JSON';
import ObjectID from '../Types/ObjectID';
import Dictionary from '../Types/Dictionary';
import HashedString from '../Types/HashedString';
import Email from '../Types/Email';
import Phone from '../Types/Phone';
import PositiveNumber from '../Types/PositiveNumber';
import Route from '../Types/API/Route';
import TableColumnType from '../Types/Database/TableColumnType';
import Permission, {
    instanceOfUserTenantAccessPermission,
    PermissionHelper,
    UserPermission,
    UserTenantAccessPermission,
} from '../Types/Permission';
import {
    ColumnAccessControl,
    ColumnBillingAccessControl,
} from '../Types/Database/AccessControl/AccessControl';
import { getColumnAccessControlForAllColumns } from '../Types/Database/AccessControl/ColumnAccessControl';
import BadDataException from '../Types/Exception/BadDataException';
import { PlanSelect } from '../Types/Billing/SubscriptionPlan';
import { EnableWorkflowOn } from '../Types/Model/EnableWorkflow';
import IconProp from '../Types/Icon/IconProp';
import Text from '../Types/Text';
import { getColumnBillingAccessControlForAllColumns } from '../Types/Database/AccessControl/ColumnBillingAccessControl';

export type DbTypes =
    | string
    | number
    | PositiveNumber
    | Email
    | HashedString
    | URL
    | Phone
    | JSONObject
    | ObjectID
    | JSONArray
    | Buffer;

export default class BaseModel extends BaseEntity {
    @TableColumn({
        title: 'ID',
        type: TableColumnType.ObjectID,
        description: 'ID of this object',
    })
    @PrimaryGeneratedColumn('uuid')
    public _id?: string = undefined;

    @TableColumn({
        title: 'Created',
        type: TableColumnType.Date,
        description: 'Date and Time when the object was created.',
    })
    @CreateDateColumn()
    public createdAt?: Date = undefined;

    @TableColumn({
        title: 'Updated',
        type: TableColumnType.Date,
        description: 'Date and Time when the object was updated.',
    })
    @UpdateDateColumn()
    public updatedAt?: Date = undefined;

    @TableColumn({
        title: 'Deleted',
        type: TableColumnType.Date,
        description: 'Date and Time when the object was deleted.',
    })
    @DeleteDateColumn()
    public deletedAt?: Date = undefined;

    @TableColumn({
        title: 'Version',
        type: TableColumnType.Version,
        description: 'Object version',
    })
    @VersionColumn()
    public version?: number = undefined;

    public createRecordPermissions!: Array<Permission>;
    public readRecordPermissions!: Array<Permission>;
    public deleteRecordPermissions!: Array<Permission>;
    public updateRecordPermissions!: Array<Permission>;

    // Billing Plans.
    public createBillingPlan!: PlanSelect | null;
    public readBillingPlan!: PlanSelect | null;
    public updateBillingPlan!: PlanSelect | null;
    public deleteBillingPlan!: PlanSelect | null;

    public allowAccessIfSubscriptionIsUnpaid!: boolean;

    public enableWorkflowOn!: EnableWorkflowOn;

    public enableDocumentation!: boolean;

    public currentUserCanAccessColumnBy!: string | null;
    public labelsColumn!: string | null;
    public slugifyColumn!: string | null;
    public saveSlugToColumn!: string | null;
    public singularName!: string | null;
    public pluralName!: string | null;

    // total items  by
    public totalItemsByColumnnName!: string | null;
    public totalItemsNumber!: number | null;
    public totalItemsErrorMessage!: string | null;

    public isPermissionIf: Dictionary<JSONObject> = {};

    public isMultiTenantRequestAllowed!: boolean | null;
    public allowUserQueryWithoutTenant!: boolean | null;

    public crudApiPath!: Route | null;

    // If this resource is by projectId, which column does projectId belong to?
    public tenantColumn!: string | null;

    public accessControlColumn!: string | null;

    public icon!: IconProp | null;

    public tableDescription!: string | null;

    public tableName!: string | null;

    public canAccessIfCanReadOn!: string | null;

    public constructor(id?: ObjectID) {
        super();
        if (id) {
            this.id = id;
        }
    }

    public getHashedColumns(): Columns {
        const dictionary: Dictionary<TableColumnMetadata> =
            getTableColumns(this);
        const columns: Array<string> = [];
        for (const key in dictionary) {
            if (dictionary[key]?.hashed) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getDisplayColumnPlaceholderAs(columnName: string): string | null {
        return getTableColumn(this, columnName)?.placeholder || null;
    }

    public getDisplayColumnTitleAs(columnName: string): string | null {
        return getTableColumn(this, columnName)?.title || null;
    }

    public getDisplayColumnDescriptionAs(columnName: string): string | null {
        return getTableColumn(this, columnName)?.description || null;
    }

    public getEncryptedColumns(): Columns {
        const dictionary: Dictionary<TableColumnMetadata> =
            getTableColumns(this);
        const columns: Array<string> = [];
        for (const key in dictionary) {
            if (dictionary[key]?.encrypted) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getTableColumns(): Columns {
        return new Columns(Object.keys(getTableColumns(this)));
    }

    public canQueryMultiTenant(): boolean {
        return Boolean(this.isMultiTenantRequestAllowed);
    }

    public isUserQueryWithoutTenantAllowed(): boolean {
        return Boolean(this.allowUserQueryWithoutTenant);
    }

    public getTableColumnMetadata(columnName: string): TableColumnMetadata {
        const dictionary: Dictionary<TableColumnMetadata> =
            getTableColumns(this);
        return dictionary[columnName] as TableColumnMetadata;
    }

    public getColumnBillingAccessControl(
        columnName: string
    ): ColumnBillingAccessControl {
        const dictionary: Dictionary<ColumnBillingAccessControl> =
            getColumnBillingAccessControlForAllColumns(this);
        return dictionary[columnName] as ColumnBillingAccessControl;
    }

    public getColumnAccessControlFor(
        columnName: string
    ): ColumnAccessControl | null {
        return this.getColumnAccessControlForAllColumns()[columnName] || null;
    }

    public getColumnAccessControlForAllColumns(): Dictionary<ColumnAccessControl> {
        const dictionary: Dictionary<ColumnAccessControl> =
            getColumnAccessControlForAllColumns(this);

        const defaultColumns: Array<string> = [
            '_id',
            'createdAt',
            'deletedAt',
            'updatedAt',
        ];

        for (const key of defaultColumns) {
            dictionary[key] = {
                read: this.readRecordPermissions,
                create: this.createRecordPermissions,
                update: this.updateRecordPermissions,
            };
        }

        return dictionary;
    }

    public hasValue(columnName: string): boolean {
        return Boolean((this as any)[columnName]);
    }

    public getValue<T extends DbTypes>(columnName: string): T {
        return (this as any)[columnName] as T;
    }

    public setValue<T extends DbTypes>(columnName: string, value: T): void {
        (this as any)[columnName] = value;
    }

    public doesPermissionHasConditions(
        permission: Permission
    ): JSONObject | null {
        return this.isPermissionIf[permission]
            ? (this.isPermissionIf[permission] as JSONObject)
            : null;
    }

    public getUniqueColumns(): Columns {
        const dictionary: Dictionary<TableColumnMetadata> =
            getTableColumns(this);
        const columns: Array<string> = [];
        for (const key in dictionary) {
            if (dictionary[key]?.unique) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public setSlugifyColumn(columnName: string): void {
        this.slugifyColumn = columnName;
    }

    public getTotalItemsByColumnName(): string | null {
        return this.totalItemsByColumnnName;
    }

    public getTotalItemsByErrorMessage(): string | null {
        return this.totalItemsErrorMessage;
    }

    public getTotalItemsNumber(): number | null {
        return this.totalItemsNumber;
    }

    public getRequiredColumns(): Columns {
        const dictionary: Dictionary<TableColumnMetadata> =
            getTableColumns(this);
        const columns: Array<string> = [];
        for (const key in dictionary) {
            if (dictionary[key]?.required) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getSlugifyColumn(): string | null {
        return this.slugifyColumn;
    }

    public getCrudApiPath(): Route | null {
        return this.crudApiPath;
    }

    public getSaveSlugToColumn(): string | null {
        return this.saveSlugToColumn;
    }

    public getTenantColumn(): string | null {
        return this.tenantColumn;
    }

    public getAccessControlColumn(): string | null {
        return this.accessControlColumn;
    }

    public getUserColumn(): string | null {
        return this.currentUserCanAccessColumnBy;
    }

    public getLabelsColumn(): string | null {
        return this.labelsColumn;
    }

    public get id(): ObjectID | null {
        return this._id ? new ObjectID(this._id) : null;
    }

    public set id(value: ObjectID | null) {
        if (value) {
            this._id = value.toString();
        }
    }

    public isDefaultValueColumn(columnName: string): boolean {
        return Boolean(getTableColumn(this, columnName).isDefaultValueColumn);
    }

    public getColumnValue(
        columnName: string
    ): JSONValue | BaseModel | Array<BaseModel> | null {
        if (getTableColumn(this, columnName) && (this as any)[columnName]) {
            return (this as any)[columnName] as JSONValue;
        }

        return null;
    }

    public setColumnValue(
        columnName: string,
        value: JSONValue | BaseModel | Array<BaseModel>
    ): void {
        if (getTableColumn(this, columnName)) {
            return ((this as any)[columnName] = value as any);
        }
    }

    public isEntityColumn(columnName: string): boolean {
        const tableColumnType: TableColumnMetadata = getTableColumn(
            this,
            columnName
        );

        if (!tableColumnType) {
            throw new BadDataException(
                'TableColumnMetadata not found for ' + columnName + ' column'
            );
        }

        return Boolean(
            tableColumnType.type === TableColumnType.Entity ||
                tableColumnType.type === TableColumnType.EntityArray
        );
    }

    public isHashedStringColumn(columnName: string): boolean {
        const tableColumnType: TableColumnMetadata = getTableColumn(
            this,
            columnName
        );

        if (!tableColumnType) {
            throw new BadDataException(
                'TableColumnMetadata not found for ' + columnName + ' column'
            );
        }

        return Boolean(tableColumnType.type === TableColumnType.HashedString);
    }

    public isFileColumn(columnName: string): boolean {
        const tableColumnType: TableColumnMetadata = getTableColumn(
            this,
            columnName
        );

        if (!tableColumnType || !tableColumnType.modelType) {
            return false;
        }

        const fileModel: BaseModel = new tableColumnType.modelType();

        if (fileModel.isFileModel()) {
            return true;
        }

        return false;
    }

    public hasPermission(_permissions: Array<Permission>): boolean {
        return false;
    }

    public isTenantModel(): boolean {
        return false;
    }

    public isFileModel(): boolean {
        return false;
    }

    public isAccessControlModel(): boolean {
        return false;
    }

    public isUserModel(): boolean {
        return false;
    }

    public hasCreatePermissions(
        userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
        columnName?: string
    ): boolean {
        let modelPermission: Array<Permission> = this.createRecordPermissions;

        if (columnName) {
            const columnAccessControl: ColumnAccessControl | null =
                this.getColumnAccessControlFor(columnName);
            if (columnAccessControl) {
                modelPermission = columnAccessControl.create;
            }
        }

        return this.hasPermissions(userProjectPermissions, modelPermission);
    }

    public hasReadPermissions(
        userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
        columnName?: string
    ): boolean {
        let modelPermission: Array<Permission> = this.readRecordPermissions;

        if (columnName) {
            const columnAccessControl: ColumnAccessControl | null =
                this.getColumnAccessControlFor(columnName);
            if (columnAccessControl) {
                modelPermission = columnAccessControl.read;
            }
        }

        return this.hasPermissions(userProjectPermissions, modelPermission);
    }

    public hasDeletePermissions(
        userProjectPermissions: UserTenantAccessPermission | Array<Permission>
    ): boolean {
        const modelPermission: Array<Permission> = this.deleteRecordPermissions;
        return this.hasPermissions(userProjectPermissions, modelPermission);
    }

    public hasUpdatePermissions(
        userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
        columnName?: string
    ): boolean {
        let modelPermission: Array<Permission> = this.updateRecordPermissions;

        if (columnName) {
            const columnAccessControl: ColumnAccessControl | null =
                this.getColumnAccessControlFor(columnName);
            if (columnAccessControl) {
                modelPermission = columnAccessControl.update;
            }
        }

        return this.hasPermissions(userProjectPermissions, modelPermission);
    }

    public getAPIDocumentationPath(): string {
        return Text.pascalCaseToDashes(this.tableName as string);
    }

    private hasPermissions(
        userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
        modelPermissions: Array<Permission>
    ): boolean {
        let userPermissions: Array<Permission> = [];

        if (
            instanceOfUserTenantAccessPermission(userProjectPermissions) &&
            userProjectPermissions.permissions &&
            Array.isArray(userProjectPermissions.permissions)
        ) {
            userPermissions = userProjectPermissions.permissions.map(
                (item: UserPermission) => {
                    return item.permission;
                }
            );
        } else {
            userPermissions = userProjectPermissions as Array<Permission>;
        }

        return Boolean(
            userPermissions &&
                PermissionHelper.doesPermissionsIntersect(
                    modelPermissions,
                    userPermissions
                )
        );
    }
}
