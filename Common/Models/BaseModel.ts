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
import { JSONArray, JSONObject } from '../Types/JSON';
import ObjectID from '../Types/ObjectID';
import Dictionary from '../Types/Dictionary';
import HashedString from '../Types/HashedString';
import Email from '../Types/Email';
import Phone from '../Types/Phone';
import PositiveNumber from '../Types/PositiveNumber';
import Route from '../Types/API/Route';
import Name from '../Types/Name';
import TableColumnType from '../Types/Database/TableColumnType';
import Permission from '../Types/Permission';

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

    public isPermissionIf: Dictionary<JSONObject> = {};

    public crudApiPath!: Route | null;
    // If this resource is by projectId, which column does projectId belong to?
    public projectColumn!: string | null;

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

    public getTableColumnMetadata(columnName: string): TableColumnMetadata {
        const dictionary: Dictionary<TableColumnMetadata> =
            getTableColumns(this);
        return dictionary[columnName] as TableColumnMetadata;
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

    public getprojectColumn(): string | null {
        return this.projectColumn;
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
        const baseModel: T = new type();

        for (const key of Object.keys(json)) {
            if (
                baseModel.getTableColumnMetadata(key) &&
                baseModel.getTableColumnMetadata(key).type ===
                    TableColumnType.HashedString
            ) {
                (baseModel as any)[key] = new HashedString(json[key] as string);
            } else if (
                baseModel.getTableColumnMetadata(key) &&
                baseModel.getTableColumnMetadata(key).type ===
                    TableColumnType.Name
            ) {
                (baseModel as any)[key] = new Name(json[key] as string);
            } else if (
                baseModel.getTableColumnMetadata(key) &&
                baseModel.getTableColumnMetadata(key).type ===
                    TableColumnType.Email
            ) {
                (baseModel as any)[key] = new Email(json[key] as string);
            } else if (
                baseModel.getTableColumnMetadata(key) &&
                baseModel.getTableColumnMetadata(key).type ===
                    TableColumnType.ObjectID
            ) {
                (baseModel as any)[key] = new ObjectID(json[key] as string);
            } else {
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

    public isDefaultValueColumn(columnName: string): boolean {
        return Boolean(getTableColumn(this, columnName).isDefaultValueColumn);
    }

    public toJSON(): JSONObject {
        const json: JSONObject = {};
        for (const key of this.getTableColumns().columns) {
            if ((this as any)[key]) {
                if (
                    this.getTableColumnMetadata(key) &&
                    this.getTableColumnMetadata(key).type ===
                        TableColumnType.HashedString
                ) {
                    json[key] = ((this as any)[key] as HashedString).toString();
                } else if (
                    this.getTableColumnMetadata(key) &&
                    this.getTableColumnMetadata(key).type ===
                        TableColumnType.Name
                ) {
                    json[key] = ((this as any)[key] as Name).toString();
                } else if (
                    this.getTableColumnMetadata(key) &&
                    this.getTableColumnMetadata(key).type ===
                        TableColumnType.Email
                ) {
                    json[key] = ((this as any)[key] as Email).toString();
                } else if (
                    this.getTableColumnMetadata(key) &&
                    this.getTableColumnMetadata(key).type ===
                        TableColumnType.ObjectID
                ) {
                    json[key] = ((this as any)[key] as ObjectID).toString();
                } else {
                    json[key] = (this as any)[key];
                }
            }
        }

        return json;
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
}
