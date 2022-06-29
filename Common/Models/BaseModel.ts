import {
    DeleteDateColumn,
    UpdateDateColumn,
    CreateDateColumn,
    VersionColumn,
    PrimaryGeneratedColumn,
    BaseEntity,
} from 'typeorm';
import { getPublicAccessControlForAllColumns } from '../Types/Database/AccessControls/Public/PublicColumnPermissions';
import { getMemberAccessControlForAllColumns } from '../Types/Database/AccessControls/Member/MemberColumnPermissions';
import { getOwnerAccessControlForAllColumns } from '../Types/Database/AccessControls/Owner/OwnerColumnPermissions';
import { getViewerAccessControlForAllColumns } from '../Types/Database/AccessControls/Viewer/ViewerColumnPermissions';
import { getAdminAccessControlForAllColumns } from '../Types/Database/AccessControls/Admin/AdminColumnPermissions';
import { getUserAccessControlForAllColumns } from '../Types/Database/AccessControls/User/UserColumnPermissions';
import Columns from '../Types/Database/Columns';
import TableColumn, {
    getTableColumn,
    getTableColumns,
    TableColumnMetadata,
} from '../Types/Database/TableColumn';
import BadRequestException from '../Types/Exception/BadRequestException';
import { JSONArray, JSONObject } from '../Types/JSON';
import ObjectID from '../Types/ObjectID';
import AccessControl from '../Types/Database/AccessControls/AccessControl';
import Dictionary from '../Types/Dictionary';
import HashedString from '../Types/HashedString';
import Email from '../Types/Email';
import Phone from '../Types/Phone';
import PositiveNumber from '../Types/PositiveNumber';
import Route from '../Types/API/Route';

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
    @TableColumn({ title: 'ID' })
    @PrimaryGeneratedColumn('uuid')
    public _id?: string = undefined;

    @TableColumn({ title: 'Created' })
    @CreateDateColumn()
    public createdAt?: Date = undefined;

    @TableColumn({ title: 'Updated' })
    @UpdateDateColumn()
    public updatedAt?: Date = undefined;

    @TableColumn({ title: 'Deleted' })
    @DeleteDateColumn()
    public deletedAt?: Date = undefined;

    @TableColumn({ title: 'Version' })
    @VersionColumn()
    public version?: number = undefined;

    public canAdminCreateRecord!: boolean;
    public canAdminDeleteRecord!: boolean;
    public canAdminUpdateRecord!: boolean;
    public canAdminReadItemRecord!: boolean;
    public canAdminReadListRecord!: boolean;

    public canPublicCreateRecord!: boolean;
    public canPublicDeleteRecord!: boolean;
    public canPublicUpdateRecord!: boolean;
    public canPublicReadItemRecord!: boolean;
    public canPublicReadListRecord!: boolean;

    public canOwnerCreateRecord!: boolean;
    public canOwnerDeleteRecord!: boolean;
    public canOwnerUpdateRecord!: boolean;
    public canOwnerReadItemRecord!: boolean;
    public canOwnerReadListRecord!: boolean;

    public canMemberCreateRecord!: boolean;
    public canMemberDeleteRecord!: boolean;
    public canMemberUpdateRecord!: boolean;
    public canMemberReadItemRecord!: boolean;
    public canMemberReadListRecord!: boolean;

    public canViewerCreateRecord!: boolean;
    public canViewerDeleteRecord!: boolean;
    public canViewerUpdateRecord!: boolean;
    public canViewerReadItemRecord!: boolean;
    public canViewerReadListRecord!: boolean;

    public canUserCreateRecord!: boolean;
    public canUserDeleteRecord!: boolean;
    public canUserUpdateRecord!: boolean;
    public canUserReadItemRecord!: boolean;
    public canUserReadListRecord!: boolean;

    public slugifyColumn!: string | null;
    public saveSlugToColumn!: string | null;

    public crudApiPath!: Route | null;
    // If this resource is by projectId, which column does projectId belong to?
    public projectIdColumn!: string | null;

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

    public hasValue(columnName: string): boolean {
        return Boolean((this as any)[columnName]);
    }

    public getValue<T extends DbTypes>(columnName: string): T {
        return (this as any)[columnName] as T;
    }

    public setValue<T extends DbTypes>(columnName: string, value: T): void {
        (this as any)[columnName] = value;
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

    public getUserCreateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getUserAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.create) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getUserDeleteableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getUserAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.delete) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getUserUpdateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getUserAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.update) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getUserReadableAsItemColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getUserAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.readAsItem) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getUserReadableAsListColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getUserAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.readAsList) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getOwnerCreateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getOwnerAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.create) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getOwnerDeleteableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getOwnerAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.delete) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getOwnerReadableAsItemColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getOwnerAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.readAsItem) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getOwnerReadableAsListColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getOwnerAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.readAsList) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getOwnerUpdateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getOwnerAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.update) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getAdminDeleteableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getAdminAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.delete) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getAdminCreateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getAdminAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.create) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getAdminReadableAsItemColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getAdminAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.readAsItem) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getAdminReadableAsListColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getAdminAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.readAsList) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getAdminUpdateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getAdminAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.update) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getPublicReadableAsItemColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getPublicAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.readAsItem) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getPublicReadableAsListColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getPublicAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.readAsList) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getPublicUpdateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getPublicAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.update) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getPublicCreateableColumns<T extends BaseModel>(type: {
        new (): T;
    }): Columns {
        const obj: T = new type();
        const accessControl: Dictionary<AccessControl> =
            getPublicAccessControlForAllColumns(obj);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.create) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getPublicDeleteableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getPublicAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.delete) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getMemberReadableAsItemColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getMemberAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.readAsItem) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getMemberReadableAsListColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getMemberAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.readAsList) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getMemberUpdateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getMemberAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.update) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getMemberCreateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getMemberAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.create) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getMemberDeleteableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getMemberAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.delete) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getViewerReadableAsItemColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getViewerAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.readAsItem) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getViewerReadableAsListColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getViewerAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.readAsList) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getViewerUpdateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getViewerAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.update) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getViewerCreateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getViewerAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.create) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getViewerDeleteableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getViewerAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (accessControl[key]?.delete) {
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

    public getProjectIdColumn(): string | null {
        return this.projectIdColumn;
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
        const hashedColumns: Columns = baseModel.getHashedColumns();

        for (const key of Object.keys(json)) {
            if (hashedColumns.hasColumn(key)) {
                (baseModel as any)[key] = new HashedString(json[key] as string);
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

    private static keepColumns<T extends BaseModel>(
        data: T,
        columnsToKeep: Columns,
        type: { new (): T }
    ): T {
        const baseModel: T = new type();

        for (const key of Object.keys(data)) {
            if (!columnsToKeep) {
                (baseModel as any)[key] = (data as any)[key];
            }

            if (
                columnsToKeep &&
                columnsToKeep.columns.length > 0 &&
                columnsToKeep.columns.includes(key)
            ) {
                (baseModel as any)[key] = (data as any)[key];
            }
        }

        return baseModel as T;
    }

    public static asPublicCreateable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canPublicCreateRecord) {
            throw new BadRequestException(
                'A user of role public cannot create this record.'
            );
        }

        data = this.keepColumns<T>(
            data as T,
            data.getPublicCreateableColumns(type),
            type
        );
        return data;
    }

    public static asPublicUpdateable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canPublicUpdateRecord) {
            throw new BadRequestException(
                'A user of role public cannot update this record.'
            );
        }

        return this.keepColumns(data, data.getPublicUpdateableColumns(), type);
    }

    public static asPublicReadableItem<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canPublicReadItemRecord) {
            throw new BadRequestException(
                'A user of role public cannot read this record.'
            );
        }

        return this.keepColumns(
            data,
            data.getPublicReadableAsItemColumns(),
            type
        );
    }

    public static asPublicReadableList<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canPublicReadListRecord) {
            throw new BadRequestException(
                'A user of role public cannot read this record.'
            );
        }

        return this.keepColumns(
            data,
            data.getPublicReadableAsListColumns(),
            type
        );
    }

    public static asPublicDeleteable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canPublicDeleteRecord) {
            throw new BadRequestException(
                'A user of role public cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getPublicDeleteableColumns(), type);
    }

    public static asOwnerCreateable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canOwnerCreateRecord) {
            throw new BadRequestException(
                'A user of role owner cannot create this record.'
            );
        }

        return this.keepColumns(data, data.getOwnerCreateableColumns(), type);
    }

    public static asOwnerUpdateable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canOwnerUpdateRecord) {
            throw new BadRequestException(
                'A user of role owner cannot update this record.'
            );
        }

        return this.keepColumns(data, data.getOwnerUpdateableColumns(), type);
    }

    public static asOwnerReadableItem<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canOwnerReadItemRecord) {
            throw new BadRequestException(
                'A user of role owner cannot delete this record.'
            );
        }

        return this.keepColumns(
            data,
            data.getOwnerReadableAsItemColumns(),
            type
        );
    }

    public static asOwnerReadableList<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canOwnerReadListRecord) {
            throw new BadRequestException(
                'A user of role owner cannot delete this record.'
            );
        }

        return this.keepColumns(
            data,
            data.getOwnerReadableAsListColumns(),
            type
        );
    }

    public static asOwnerDeleteable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canOwnerDeleteRecord) {
            throw new BadRequestException(
                'A user of role owner cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getOwnerDeleteableColumns(), type);
    }

    public static asUserCreateable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canUserCreateRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot create this record.'
            );
        }

        return this.keepColumns(data, data.getUserCreateableColumns(), type);
    }

    public static asUserUpdateable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canUserUpdateRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot update this record.'
            );
        }

        return this.keepColumns(data, data.getUserUpdateableColumns(), type);
    }

    public static asUserReadableItem<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canUserReadItemRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot read this record.'
            );
        }

        return this.keepColumns(
            data,
            data.getUserReadableAsItemColumns(),
            type
        );
    }

    public static asUserReadableList<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canUserReadListRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot read this record.'
            );
        }

        return this.keepColumns(
            data,
            data.getUserReadableAsListColumns(),
            type
        );
    }

    public static asUserDeleteable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canUserDeleteRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getUserDeleteableColumns(), type);
    }

    public static asViewerCreateable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canViewerCreateRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot create this record.'
            );
        }

        return this.keepColumns(data, data.getViewerCreateableColumns(), type);
    }

    public static asViewerUpdateable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canViewerUpdateRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot update this record.'
            );
        }

        return this.keepColumns(data, data.getViewerUpdateableColumns(), type);
    }

    public static asViewerReadableItem<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canViewerReadItemRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot read this record.'
            );
        }

        return this.keepColumns(
            data,
            data.getViewerReadableAsItemColumns(),
            type
        );
    }

    public static asViewerReadableList<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canViewerReadListRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot read this record.'
            );
        }

        return this.keepColumns(
            data,
            data.getViewerReadableAsListColumns(),
            type
        );
    }

    public static asViewerDeleteable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canViewerDeleteRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getViewerDeleteableColumns(), type);
    }

    public static asMemberCreateable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canMemberCreateRecord) {
            throw new BadRequestException(
                'A user of role member cannot create this record.'
            );
        }

        return this.keepColumns(data, data.getMemberCreateableColumns(), type);
    }

    public static asMemberUpdateable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canMemberUpdateRecord) {
            throw new BadRequestException(
                'A user of role member cannot update this record.'
            );
        }

        return this.keepColumns(data, data.getMemberUpdateableColumns(), type);
    }

    public static asMemberReadableItem<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canMemberReadItemRecord) {
            throw new BadRequestException(
                'A user of role member cannot read this record.'
            );
        }

        return this.keepColumns(
            data,
            data.getMemberReadableAsItemColumns(),
            type
        );
    }

    public static asMemberReadableList<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canMemberReadListRecord) {
            throw new BadRequestException(
                'A user of role member cannot read this record.'
            );
        }

        return this.keepColumns(
            data,
            data.getMemberReadableAsListColumns(),
            type
        );
    }

    public static asMemberDeleteable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canMemberDeleteRecord) {
            throw new BadRequestException(
                'A user of role member cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getMemberDeleteableColumns(), type);
    }

    public static asAdminCreateable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canAdminCreateRecord) {
            throw new BadRequestException(
                'A user of role admin cannot create this record.'
            );
        }

        return this.keepColumns(data, data.getAdminCreateableColumns(), type);
    }

    public static asAdminUpdateable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canAdminUpdateRecord) {
            throw new BadRequestException(
                'A user of role admin cannot update this record.'
            );
        }

        return this.keepColumns(data, data.getAdminUpdateableColumns(), type);
    }

    public static asAdminReadableList<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canAdminReadListRecord) {
            throw new BadRequestException(
                'A user of role admin cannot read this record.'
            );
        }

        return this.keepColumns(
            data,
            data.getAdminReadableAsListColumns(),
            type
        );
    }

    public static asAdminReadableItem<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canAdminReadItemRecord) {
            throw new BadRequestException(
                'A user of role admin cannot read this record.'
            );
        }

        return this.keepColumns(
            data,
            data.getAdminReadableAsItemColumns(),
            type
        );
    }

    public static asAdminDeleteable<T extends BaseModel>(
        data: JSONObject | T,
        type: { new (): T }
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data, type);
        }

        if (!data.canAdminDeleteRecord) {
            throw new BadRequestException(
                'A user of role admin cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getAdminDeleteableColumns(), type);
    }

    public isDefaultValueColumn(columnName: string): boolean {
        return Boolean(getTableColumn(this, columnName).isDefaultValueColumn);
    }

    public toJSON(): JSONObject {
        const json: JSONObject = {};
        for (const column of this.getTableColumns().columns) {
            if ((this as any)[column]) {
                json[column] = (this as any)[column];
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
}
