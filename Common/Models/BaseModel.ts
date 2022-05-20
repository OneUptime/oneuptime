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
import { getEncryptedColumns } from '../Types/Database/EncryptedColumn';
import { getUniqueColumns } from '../Types/Database/UniqueColumn';
import { getHashedColumns } from '../Types/Database/HashedColumn';
import { getRequiredColumns } from '../Types/Database/RequiredColumn';
import Columns from '../Types/Database/Columns';
import TableColumn, {
    getTableColumn,
    getAllTableColumns,
} from '../Types/Database/TableColumn';
import BadRequestException from '../Types/Exception/BadRequestException';
import { JSONArray, JSONObject } from '../Types/JSON';
import ObjectID from '../Types/ObjectID';
import AccessControl from '../Types/Database/AccessControls/AccessControl';
import Dictionary from '../Types/Dictionary';

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

    private canAdminCreateRecord = false;
    private canAdminDeleteRecord = false;
    private canAdminUpdateRecord = false;
    private canAdminReadItemRecord = false;
    private canAdminReadListRecord = false;

    private canPublicCreateRecord = false;
    private canPublicDeleteRecord = false;
    private canPublicUpdateRecord = false;
    private canPublicReadItemRecord = false;
    private canPublicReadListRecord = false;

    private canOwnerCreateRecord = false;
    private canOwnerDeleteRecord = false;
    private canOwnerUpdateRecord = false;
    private canOwnerReadItemRecord = false;
    private canOwnerReadListRecord = false;

    private canMemberCreateRecord = false;
    private canMemberDeleteRecord = false;
    private canMemberUpdateRecord = false;
    private canMemberReadItemRecord = false;
    private canMemberReadListRecord = false;

    private canViewerCreateRecord = false;
    private canViewerDeleteRecord = false;
    private canViewerUpdateRecord = false;
    private canViewerReadItemRecord = false;
    private canViewerReadListRecord = false;

    private canUserCreateRecord = false;
    private canUserDeleteRecord = false;
    private canUserUpdateRecord = false;
    private canUserReadItemRecord = false;
    private canUserReadListRecord = false;

    private slugifyColumn!: string | null;
    private saveSlugToColumn!: string | null;

    // If this resource is by projectId, which column does projectId belong to?
    private projectIdColumn!: string | null;

    public constructor(id?: ObjectID) {
        super();
        if (id) {
            this.id = id;
        }
    }

    public getHashedColumns(): Columns {
        return getHashedColumns(this);
    }

    public getDisplayColumnPlaceholderAs(columnName: string): string | null {
        return getTableColumn(this, columnName).placeholder || null;
    }

    public getDisplayColumnTitleAs(columnName: string): string | null {
        return getTableColumn(this, columnName).title || null;
    }

    public getDisplayColumnDescriptionAs(columnName: string): string | null {
        return getTableColumn(this, columnName).description || null;
    }

    public getEncryptedColumns(): Columns {
        return getEncryptedColumns(this);
    }

    public getTableColumns(): Columns {
        return new Columns(Object.keys(getAllTableColumns(this)));
    }

    public getUniqueColumns(): Columns {
        return getUniqueColumns(this);
    }

    public getUserCreateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getUserAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
            if (accessControl[key]?.update) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getPublicCreateableColumns(): Columns {
        const accessControl: Dictionary<AccessControl> =
            getPublicAccessControlForAllColumns(this);
        const columns: Array<string> = [];

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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

        for (const key in Object.keys(accessControl)) {
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
        return getRequiredColumns(this);
    }

    public getSlugifyColumn(): string | null {
        return this.slugifyColumn;
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

    private static _fromJSON<T extends BaseModel>(json: JSONObject): T {
        const baseModel: BaseModel = new BaseModel();

        for (const key of Object.keys(json)) {
            (baseModel as any)[key] = json[key];
        }

        return baseModel as T;
    }

    public static fromJSON<T extends BaseModel>(json: JSONObject): T {
        return this._fromJSON<T>(json);
    }

    private static keepColumns<T extends BaseModel>(
        data: T,
        columnsToKeep: Columns
    ): T {
        const baseModel: BaseModel = new BaseModel();

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
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canPublicCreateRecord) {
            throw new BadRequestException(
                'A user of role public cannot create this record.'
            );
        }

        return this.keepColumns(data, data.getPublicCreateableColumns());
    }

    public static asPublicUpdateable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canPublicUpdateRecord) {
            throw new BadRequestException(
                'A user of role public cannot update this record.'
            );
        }

        return this.keepColumns(data, data.getPublicUpdateableColumns());
    }

    public static asPublicReadableItem<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canPublicReadItemRecord) {
            throw new BadRequestException(
                'A user of role public cannot read this record.'
            );
        }

        return this.keepColumns(data, data.getPublicReadableAsItemColumns());
    }

    public static asPublicReadableList<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canPublicReadListRecord) {
            throw new BadRequestException(
                'A user of role public cannot read this record.'
            );
        }

        return this.keepColumns(data, data.getPublicReadableAsListColumns());
    }

    public static asPublicDeleteable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canPublicDeleteRecord) {
            throw new BadRequestException(
                'A user of role public cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getPublicDeleteableColumns());
    }

    public static asOwnerCreateable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canOwnerCreateRecord) {
            throw new BadRequestException(
                'A user of role owner cannot create this record.'
            );
        }

        return this.keepColumns(data, data.getOwnerCreateableColumns());
    }

    public static asOwnerUpdateable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canOwnerUpdateRecord) {
            throw new BadRequestException(
                'A user of role owner cannot update this record.'
            );
        }

        return this.keepColumns(data, data.getOwnerUpdateableColumns());
    }

    public static asOwnerReadableItem<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canOwnerReadItemRecord) {
            throw new BadRequestException(
                'A user of role owner cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getOwnerReadableAsItemColumns());
    }

    public static asOwnerReadableList<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canOwnerReadListRecord) {
            throw new BadRequestException(
                'A user of role owner cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getOwnerReadableAsListColumns());
    }

    public static asOwnerDeleteable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canOwnerDeleteRecord) {
            throw new BadRequestException(
                'A user of role owner cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getOwnerDeleteableColumns());
    }

    public static asUserCreateable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canUserCreateRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot create this record.'
            );
        }

        return this.keepColumns(data, data.getUserCreateableColumns());
    }

    public static asUserUpdateable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canUserUpdateRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot update this record.'
            );
        }

        return this.keepColumns(data, data.getUserUpdateableColumns());
    }

    public static asUserReadableItem<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canUserReadItemRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot read this record.'
            );
        }

        return this.keepColumns(data, data.getUserReadableAsItemColumns());
    }

    public static asUserReadableList<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canUserReadListRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot read this record.'
            );
        }

        return this.keepColumns(data, data.getUserReadableAsListColumns());
    }

    public static asUserDeleteable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canUserDeleteRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getUserDeleteableColumns());
    }

    public static asViewerCreateable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canViewerCreateRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot create this record.'
            );
        }

        return this.keepColumns(data, data.getViewerCreateableColumns());
    }

    public static asViewerUpdateable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canViewerUpdateRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot update this record.'
            );
        }

        return this.keepColumns(data, data.getViewerUpdateableColumns());
    }

    public static asViewerReadableItem<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canViewerReadItemRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot read this record.'
            );
        }

        return this.keepColumns(data, data.getViewerReadableAsItemColumns());
    }

    public static asViewerReadableList<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canViewerReadListRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot read this record.'
            );
        }

        return this.keepColumns(data, data.getViewerReadableAsListColumns());
    }

    public static asViewerDeleteable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canViewerDeleteRecord) {
            throw new BadRequestException(
                'A user of role viewer cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getViewerDeleteableColumns());
    }

    public static asMemberCreateable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canMemberCreateRecord) {
            throw new BadRequestException(
                'A user of role member cannot create this record.'
            );
        }

        return this.keepColumns(data, data.getMemberCreateableColumns());
    }

    public static asMemberUpdateable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canMemberUpdateRecord) {
            throw new BadRequestException(
                'A user of role member cannot update this record.'
            );
        }

        return this.keepColumns(data, data.getMemberUpdateableColumns());
    }

    public static asMemberReadableItem<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canMemberReadItemRecord) {
            throw new BadRequestException(
                'A user of role member cannot read this record.'
            );
        }

        return this.keepColumns(data, data.getMemberReadableAsItemColumns());
    }

    public static asMemberReadableList<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canMemberReadListRecord) {
            throw new BadRequestException(
                'A user of role member cannot read this record.'
            );
        }

        return this.keepColumns(data, data.getMemberReadableAsListColumns());
    }

    public static asMemberDeleteable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canMemberDeleteRecord) {
            throw new BadRequestException(
                'A user of role member cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getMemberDeleteableColumns());
    }

    public static asAdminCreateable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canAdminCreateRecord) {
            throw new BadRequestException(
                'A user of role admin cannot create this record.'
            );
        }

        return this.keepColumns(data, data.getAdminCreateableColumns());
    }

    public static asAdminUpdateable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canAdminUpdateRecord) {
            throw new BadRequestException(
                'A user of role admin cannot update this record.'
            );
        }

        return this.keepColumns(data, data.getAdminUpdateableColumns());
    }

    public static asAdminReadableList<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canAdminReadListRecord) {
            throw new BadRequestException(
                'A user of role admin cannot read this record.'
            );
        }

        return this.keepColumns(data, data.getAdminReadableAsListColumns());
    }

    public static asAdminReadableItem<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canAdminReadItemRecord) {
            throw new BadRequestException(
                'A user of role admin cannot read this record.'
            );
        }

        return this.keepColumns(data, data.getAdminReadableAsItemColumns());
    }

    public static asAdminDeleteable<T extends BaseModel>(
        data: JSONObject | T
    ): T {
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        if (!data.canAdminDeleteRecord) {
            throw new BadRequestException(
                'A user of role admin cannot delete this record.'
            );
        }

        return this.keepColumns(data, data.getAdminDeleteableColumns());
    }

    public isDefaultValueColumn(columnName: string): boolean{
        return !!getTableColumn(this, columnName).isDefaultValueColumn;
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
