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
import { JSONArray, JSONFunctions, JSONObject, JSONValue } from '../Types/JSON';
import ObjectID from '../Types/ObjectID';
import Dictionary from '../Types/Dictionary';
import HashedString from '../Types/HashedString';
import Email from '../Types/Email';
import Phone from '../Types/Phone';
import PositiveNumber from '../Types/PositiveNumber';
import Route from '../Types/API/Route';
import TableColumnType from '../Types/Database/TableColumnType';
import Permission, {
    instaceOfUserProjectAccessPermission,
    PermissionHelper,
    UserPermission,
    UserProjectAccessPermission,
} from '../Types/Permission';
import { ColumnAccessControl } from '../Types/Database/AccessControl/AccessControl';
import { getColumnAccessControlForAllColumns } from '../Types/Database/AccessControl/ColumnAccessControl';
export type DbTypes =
    | string
    | number
    | PositiveNumber
    | Email
    | HashedString
    | URL
    | Phone
    | JSONObject
    | JSONArray
    | Buffer;

export default class BaseModel extends BaseEntity {
    @TableColumn({ title: 'ID', type: TableColumnType.ObjectID })
    @PrimaryGeneratedColumn('uuid')
    public _id?: string = undefined;

    @TableColumn({ title: 'Created', type: TableColumnType.Date })
    @CreateDateColumn()
    public createdAt?: Date = undefined;

    @TableColumn({ title: 'Updated', type: TableColumnType.Date })
    @UpdateDateColumn()
    public updatedAt?: Date = undefined;

    @TableColumn({ title: 'Deleted', type: TableColumnType.Date })
    @DeleteDateColumn()
    public deletedAt?: Date = undefined;

    @TableColumn({ title: 'Version', type: TableColumnType.Version })
    @VersionColumn()
    public version?: number = undefined;

    public createRecordPermissions!: Array<Permission>;
    public readRecordPermissions!: Array<Permission>;
    public deleteRecordPermissions!: Array<Permission>;
    public updateRecordPermissions!: Array<Permission>;

    public userColumn!: string | null;
    public labelsColumn!: string | null;
    public slugifyColumn!: string | null;
    public saveSlugToColumn!: string | null;
    public singularName!: string | null;
    public pluralName!: string | null;

    public isPermissionIf: Dictionary<JSONObject> = {};

    public isMultiTenantRequestAllowed!: boolean | null;

    public crudApiPath!: Route | null;
    // If this resource is by projectId, which column does projectId belong to?
    public tenantColumn!: string | null;

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

    public getTableColumnMetadata(columnName: string): TableColumnMetadata {
        const dictionary: Dictionary<TableColumnMetadata> =
            getTableColumns(this);
        return dictionary[columnName] as TableColumnMetadata;
    }

    public getColumnAccessControlFor(columnName: string): ColumnAccessControl {
        return (
            this.getColumnAccessControlForAllColumns()[columnName] || {
                read: [],
                create: [],
                update: [],
            }
        );
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

    public doesPermissionHasConfitions(
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

    public getuserColumn(): string | null {
        return this.userColumn;
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

    private static _fromJSON<T extends BaseModel>(
        json: JSONObject,
        type: { new (): T }
    ): T {
        json = JSONFunctions.deserialize(json);
        const baseModel: T = new type();

        for (const key of Object.keys(json)) {
            if (baseModel.getTableColumnMetadata(key)) {
                (baseModel as any)[key] = json[key];
            }
        }

        return baseModel as T;
    }

    public static fromJSON<T extends BaseModel>(
        json: JSONObject | JSONArray,
        type: { new (): T }
    ): T | Array<T> {
        if (Array.isArray(json)) {
            const arr: Array<T> = [];

            for (const item of json) {
                arr.push(this._fromJSON<T>(item, type));
            }

            return arr;
        }

        return this._fromJSON<T>(json, type);
    }

    public static fromJSONObject<T extends BaseModel>(
        json: JSONObject,
        type: { new (): T }
    ): T {
        return this.fromJSON<T>(json, type) as T;
    }

    public fromJSON<T extends BaseModel>(
        json: JSONObject,
        type: { new (): T }
    ): T {
        return BaseModel._fromJSON<T>(json, type);
    }

    public fromJSONArray<T extends BaseModel>(
        json: Array<JSONObject>,
        type: { new (): T }
    ): Array<T> {
        const arr: Array<T> = [];

        for (const item of json) {
            arr.push(BaseModel._fromJSON<T>(item, type));
        }

        return arr;
    }

    public isDefaultValueColumn(columnName: string): boolean {
        return Boolean(getTableColumn(this, columnName).isDefaultValueColumn);
    }

    public getColumnValue(columnName: string): JSONValue | null {
        if (getTableColumn(this, columnName) && (this as any)[columnName]) {
            return (this as any)[columnName] as JSONValue;
        }

        return null;
    }

    public setColumnValue(columnName: string, value: JSONValue): void {
        if (getTableColumn(this, columnName)) {
            return ((this as any)[columnName] = value as any);
        }
    }

    public isEntityColumn(columnName: string): boolean {
        const tableColumnType: TableColumnMetadata = getTableColumn(
            this,
            columnName
        );
        return Boolean(
            tableColumnType.type === TableColumnType.Entity ||
                tableColumnType.type === TableColumnType.EntityArray
        );
    }

    public toJSON(): JSONObject {
        const json: JSONObject = this.toJSONObject();
        return JSONFunctions.serialize(json);
    }

    public toJSONObject(): JSONObject {
        const json: JSONObject = {};

        for (const key of this.getTableColumns().columns) {
            if (typeof (this as any)[key] === 'boolean') {
                json[key] = (this as any)[key];
            }
            else if ((this as any)[key]) {
                json[key] = (this as any)[key];
            }
        }

        return json;
    }

    public static toJSONObjectArray(list: Array<BaseModel>): JSONArray {
        const array: JSONArray = [];

        for (const item of list) {
            array.push(item.toJSONObject());
        }

        return array;
    }

    public static toJSONArray(list: Array<BaseModel>): JSONArray {
        const array: JSONArray = [];

        for (const item of list) {
            array.push(item.toJSON());
        }

        return array;
    }

    public hasPermission(_permissions: Array<Permission>): boolean {
        return false;
    }

    public isTenantModel(): boolean {
        return false;
    }

    public isUserModel(): boolean {
        return false;
    }

    public hasCreatePermissions(
        userProjectPermissions: UserProjectAccessPermission | Array<Permission>,
        columnName?: string
    ): boolean {
        let modelPermission: Array<Permission> = this.createRecordPermissions;

        if (columnName) {
            const columnAccessControl: ColumnAccessControl =
                this.getColumnAccessControlFor(columnName);
            modelPermission = columnAccessControl.create;
        }

        return this.hasPermissions(userProjectPermissions, modelPermission);
    }

    public hasReadPermissions(
        userProjectPermissions: UserProjectAccessPermission | Array<Permission>,
        columnName?: string
    ): boolean {
        let modelPermission: Array<Permission> = this.readRecordPermissions;

        if (columnName) {
            const columnAccessControl: ColumnAccessControl =
                this.getColumnAccessControlFor(columnName);
            modelPermission = columnAccessControl.read;
        }

        return this.hasPermissions(userProjectPermissions, modelPermission);
    }

    public hasDeletePermissions(
        userProjectPermissions: UserProjectAccessPermission | Array<Permission>
    ): boolean {
        const modelPermission: Array<Permission> = this.deleteRecordPermissions;
        return this.hasPermissions(userProjectPermissions, modelPermission);
    }

    public hasUpdatePermissions(
        userProjectPermissions: UserProjectAccessPermission | Array<Permission>,
        columnName?: string
    ): boolean {
        let modelPermission: Array<Permission> = this.updateRecordPermissions;

        if (columnName) {
            const columnAccessControl: ColumnAccessControl =
                this.getColumnAccessControlFor(columnName);
            modelPermission = columnAccessControl.update;
        }

        return this.hasPermissions(userProjectPermissions, modelPermission);
    }

    private hasPermissions(
        userProjectPermissions: UserProjectAccessPermission | Array<Permission>,
        modelPermissions: Array<Permission>
    ): boolean {
        let userPermissions: Array<Permission> = [];

        if (instaceOfUserProjectAccessPermission(userProjectPermissions)) {
            userPermissions = userProjectPermissions.permissions.map(
                (item: UserPermission) => {
                    return item.permission;
                }
            );
        } else {
            userPermissions = userProjectPermissions;
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
