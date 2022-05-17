import {
    DeleteDateColumn,
    UpdateDateColumn,
    CreateDateColumn,
    VersionColumn,
    PrimaryGeneratedColumn,
    BaseEntity,
} from 'typeorm';
import Columns from '../Types/Database/Columns';
import TableColumn from '../Types/Database/TableColumn';
import BadRequestException from '../Types/Exception/BadRequestException';
import { JSONArray, JSONObject } from '../Types/JSON';
import ObjectID from '../Types/ObjectID';
import { $TSFixMe } from '../../Types/tsfixme';

export default class BaseModel extends BaseEntity {
    @TableColumn()
    @PrimaryGeneratedColumn('uuid')
    public _id!: string;

    @TableColumn()
    @CreateDateColumn()
    public createdAt!: Date;

    @TableColumn()
    @UpdateDateColumn()
    public updatedAt!: Date;

    @TableColumn()
    @DeleteDateColumn()
    public deletedAt?: Date;

    @TableColumn()
    @VersionColumn()
    public version!: number;

    private encryptedColumns: Columns = new Columns([]);
    private uniqueColumns: Columns = new Columns([]);
    private requiredColumns: Columns = new Columns([]);
    private hashedColumns: Columns = new Columns([]);
    private tableColumns: Columns = new Columns([]);

    private ownerReadableAsItemColumns: Columns = new Columns([]);
    private userReadableAsItemColumns: Columns = new Columns([]);
    private adminReadableAsItemColumns: Columns = new Columns([]);
    private memberReadableAsItemColumns: Columns = new Columns([]);
    private viewerReadableAsItemColumns: Columns = new Columns([]);
    private publicReadableAsItemColumns: Columns = new Columns([]);

    private ownerReadableAsListColumns: Columns = new Columns([]);
    private userReadableAsListColumns: Columns = new Columns([]);
    private adminReadableAsListColumns: Columns = new Columns([]);
    private memberReadableAsListColumns: Columns = new Columns([]);
    private viewerReadableAsListColumns: Columns = new Columns([]);
    private publicReadableAsListColumns: Columns = new Columns([]);

    private ownerUpdateableColumns: Columns = new Columns([]);
    private userUpdateableColumns: Columns = new Columns([]);
    private adminUpdateableColumns: Columns = new Columns([]);
    private memberUpdateableColumns: Columns = new Columns([]);
    private viewerUpdateableColumns: Columns = new Columns([]);
    private publicUpdateableColumns: Columns = new Columns([]);

    private ownerCreateableColumns: Columns = new Columns([]);
    private userCreateableColumns: Columns = new Columns([]);
    private adminCreateableColumns: Columns = new Columns([]);
    private memberCreateableColumns: Columns = new Columns([]);
    private viewerCreateableColumns: Columns = new Columns([]);
    private publicCreateableColumns: Columns = new Columns([]);

    private ownerDeleteableColumns: Columns = new Columns([]);
    private userDeleteableColumns: Columns = new Columns([]);
    private adminDeleteableColumns: Columns = new Columns([]);
    private memberDeleteableColumns: Columns = new Columns([]);
    private viewerDeleteableColumns: Columns = new Columns([]);
    private publicDeleteableColumns: Columns = new Columns([]);

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
        return this.hashedColumns;
    }

    public addHashedColumn(columnName: string): void {
        if (!this.hashedColumns) {
            this.hashedColumns = new Columns([]);
        }
        this.hashedColumns.addColumn(columnName);
    }

    public getEncryptedColumns(): Columns {
        return this.encryptedColumns;
    }

    public addEncryptedColumn(columnName: string): void {
        if (!this.encryptedColumns) {
            this.encryptedColumns = new Columns([]);
        }
        this.encryptedColumns.addColumn(columnName);
    }

    public getTableColumns(): Columns {
        return this.tableColumns;
    }

    public addTableColumn(columnName: string): void {
        if (!this.tableColumns) {
            this.tableColumns = new Columns([]);
        }
        this.tableColumns.addColumn(columnName);
    }

    public getUniqueColumns(): Columns {
        return this.uniqueColumns;
    }

    public getUserCreateableColumns(): Columns {
        return this.userCreateableColumns;
    }

    public addUserCreateableColumn(columnName: string): void {
        if (!this.userCreateableColumns) {
            this.userCreateableColumns = new Columns([]);
        }
        this.userCreateableColumns.addColumn(columnName);
    }

    public getUserDeleteableColumns(): Columns {
        return this.userDeleteableColumns;
    }

    public addUserDeleteableColumn(columnName: string): void {
        if (!this.userDeleteableColumns) {
            this.userDeleteableColumns = new Columns([]);
        }
        this.userDeleteableColumns.addColumn(columnName);
    }

    public getUserUpdateableColumns(): Columns {
        return this.userUpdateableColumns;
    }

    public addUserUpdateableColumn(columnName: string): void {
        if (!this.userUpdateableColumns) {
            this.userUpdateableColumns = new Columns([]);
        }
        this.userUpdateableColumns.addColumn(columnName);
    }

    public getOwnerCreateableColumns(): Columns {
        return this.ownerCreateableColumns;
    }

    public getOwnerDeleteableColumns(): Columns {
        return this.ownerDeleteableColumns;
    }

    public getOwnerReadableAsItemColumns(): Columns {
        return this.ownerReadableAsItemColumns;
    }

    public addOwnerReadableAsItemColumn(columnName: string): void {
        if (!this.ownerReadableAsItemColumns) {
            this.ownerReadableAsItemColumns = new Columns([]);
        }
        this.ownerReadableAsItemColumns.addColumn(columnName);
    }

    public getUserReadableAsItemColumns(): Columns {
        return this.userReadableAsItemColumns;
    }

    public addUserReadableAsItemColumn(columnName: string): void {
        if (!this.userReadableAsItemColumns) {
            this.userReadableAsItemColumns = new Columns([]);
        }
        this.userReadableAsItemColumns.addColumn(columnName);
    }

    public getPublicReadableAsItemColumns(): Columns {
        return this.publicReadableAsItemColumns;
    }

    public addPublicReadableAsItemColumn(columnName: string): void {
        if (!this.publicReadableAsItemColumns) {
            this.publicReadableAsItemColumns = new Columns([]);
        }
        this.publicReadableAsItemColumns.addColumn(columnName);
    }

    public addAdminReadableAsItemColumn(columnName: string): void {
        if (!this.adminReadableAsItemColumns) {
            this.adminReadableAsItemColumns = new Columns([]);
        }
        this.adminReadableAsItemColumns.addColumn(columnName);
    }

    public getAdminReadableAsItemColumns(): Columns {
        return this.adminReadableAsItemColumns;
    }

    public addMemberReadableAsItemColumn(columnName: string): void {
        if (!this.memberReadableAsItemColumns) {
            this.memberReadableAsItemColumns = new Columns([]);
        }
        this.memberReadableAsItemColumns.addColumn(columnName);
    }

    public getMemberReadableAsItemColumns(): Columns {
        return this.memberReadableAsItemColumns;
    }

    public addViewerReadableAsItemColumn(columnName: string): void {
        if (!this.viewerReadableAsItemColumns) {
            this.viewerReadableAsItemColumns = new Columns([]);
        }
        this.viewerReadableAsItemColumns.addColumn(columnName);
    }

    public getViewerReadableAsItemColumns(): Columns {
        return this.viewerReadableAsItemColumns;
    }

    public getOwnerReadableAsListColumns(): Columns {
        return this.ownerReadableAsListColumns;
    }

    public addOwnerReadableAsListColumn(columnName: string): void {
        if (!this.ownerReadableAsListColumns) {
            this.ownerReadableAsListColumns = new Columns([]);
        }
        this.ownerReadableAsListColumns.addColumn(columnName);
    }

    public getUserReadableAsListColumns(): Columns {
        return this.userReadableAsListColumns;
    }

    public addUserReadableAsListColumn(columnName: string): void {
        if (!this.userReadableAsListColumns) {
            this.userReadableAsListColumns = new Columns([]);
        }
        this.userReadableAsListColumns.addColumn(columnName);
    }

    public getPublicReadableAsListColumns(): Columns {
        return this.publicReadableAsListColumns;
    }

    public addPublicReadableAsListColumn(columnName: string): void {
        if (!this.publicReadableAsListColumns) {
            this.publicReadableAsListColumns = new Columns([]);
        }
        this.publicReadableAsListColumns.addColumn(columnName);
    }

    public addAdminReadableAsListColumn(columnName: string): void {
        if (!this.adminReadableAsListColumns) {
            this.adminReadableAsListColumns = new Columns([]);
        }
        this.adminReadableAsListColumns.addColumn(columnName);
    }

    public getAdminReadableAsListColumns(): Columns {
        return this.adminReadableAsListColumns;
    }

    public addMemberReadableAsListColumn(columnName: string): void {
        if (!this.memberReadableAsListColumns) {
            this.memberReadableAsListColumns = new Columns([]);
        }
        this.memberReadableAsListColumns.addColumn(columnName);
    }

    public getMemberReadableAsListColumns(): Columns {
        return this.memberReadableAsListColumns;
    }

    public addViewerReadableAsListColumn(columnName: string): void {
        if (!this.viewerReadableAsListColumns) {
            this.viewerReadableAsListColumns = new Columns([]);
        }
        this.viewerReadableAsListColumns.addColumn(columnName);
    }

    public getViewerReadableAsListColumns(): Columns {
        return this.viewerReadableAsListColumns;
    }

    public getOwnerUpdateableColumns(): Columns {
        return this.ownerUpdateableColumns;
    }

    public addOwnerUpdateableColumn(columnName: string): void {
        if (!this.ownerUpdateableColumns) {
            this.ownerUpdateableColumns = new Columns([]);
        }
        this.ownerUpdateableColumns.addColumn(columnName);
    }

    public getPublicUpdateableColumns(): Columns {
        return this.publicUpdateableColumns;
    }

    public addPublicUpdateableColumn(columnName: string): void {
        if (!this.publicUpdateableColumns) {
            this.publicUpdateableColumns = new Columns([]);
        }
        this.publicUpdateableColumns.addColumn(columnName);
    }

    public addAdminUpdateableColumn(columnName: string): void {
        if (!this.adminUpdateableColumns) {
            this.adminUpdateableColumns = new Columns([]);
        }
        this.adminUpdateableColumns.addColumn(columnName);
    }

    public getAdminUpdateableColumns(): Columns {
        return this.adminUpdateableColumns;
    }

    public addMemberUpdateableColumn(columnName: string): void {
        if (!this.memberUpdateableColumns) {
            this.memberUpdateableColumns = new Columns([]);
        }
        this.memberUpdateableColumns.addColumn(columnName);
    }

    public getMemberUpdateableColumns(): Columns {
        return this.memberUpdateableColumns;
    }

    public addViewerUpdateableColumn(columnName: string): void {
        if (!this.viewerUpdateableColumns) {
            this.viewerUpdateableColumns = new Columns([]);
        }
        this.viewerUpdateableColumns.addColumn(columnName);
    }

    public getViewerUpdateableColumns(): Columns {
        return this.viewerUpdateableColumns;
    }

    public addOwnerCreateableColumn(columnName: string): void {
        if (!this.ownerCreateableColumns) {
            this.ownerCreateableColumns = new Columns([]);
        }
        this.ownerCreateableColumns.addColumn(columnName);
    }

    public getPublicCreateableColumns(): Columns {
        return this.publicCreateableColumns;
    }

    public addPublicCreateableColumn(columnName: string): void {
        if (!this.publicCreateableColumns) {
            this.publicCreateableColumns = new Columns([]);
        }
        this.publicCreateableColumns.addColumn(columnName);
    }

    public addAdminCreateableColumn(columnName: string): void {
        if (!this.adminCreateableColumns) {
            this.adminCreateableColumns = new Columns([]);
        }
        this.adminCreateableColumns.addColumn(columnName);
    }

    public getAdminCreateableColumns(): Columns {
        return this.adminCreateableColumns;
    }

    public addMemberCreateableColumn(columnName: string): void {
        if (!this.memberCreateableColumns) {
            this.memberCreateableColumns = new Columns([]);
        }
        this.memberCreateableColumns.addColumn(columnName);
    }

    public getMemberCreateableColumns(): Columns {
        return this.memberCreateableColumns;
    }

    public addViewerCreateableColumn(columnName: string): void {
        if (!this.viewerCreateableColumns) {
            this.viewerCreateableColumns = new Columns([]);
        }
        this.viewerCreateableColumns.addColumn(columnName);
    }

    public getViewerCreateableColumns(): Columns {
        return this.viewerCreateableColumns;
    }

    public addOwnerDeleteableColumn(columnName: string): void {
        if (!this.ownerDeleteableColumns) {
            this.ownerDeleteableColumns = new Columns([]);
        }
        this.ownerDeleteableColumns.addColumn(columnName);
    }

    public getPublicDeleteableColumns(): Columns {
        return this.publicDeleteableColumns;
    }

    public addPublicDeleteableColumn(columnName: string): void {
        if (!this.publicDeleteableColumns) {
            this.publicDeleteableColumns = new Columns([]);
        }
        this.publicDeleteableColumns.addColumn(columnName);
    }

    public addAdminDeleteableColumn(columnName: string): void {
        if (!this.adminDeleteableColumns) {
            this.adminDeleteableColumns = new Columns([]);
        }
        this.adminDeleteableColumns.addColumn(columnName);
    }

    public getAdminDeleteableColumns(): Columns {
        return this.adminDeleteableColumns;
    }

    public addMemberDeleteableColumn(columnName: string): void {
        if (!this.memberDeleteableColumns) {
            this.memberDeleteableColumns = new Columns([]);
        }
        this.memberDeleteableColumns.addColumn(columnName);
    }

    public getMemberDeleteableColumns(): Columns {
        return this.memberDeleteableColumns;
    }

    public addViewerDeleteableColumn(columnName: string): void {
        if (!this.viewerDeleteableColumns) {
            this.viewerDeleteableColumns = new Columns([]);
        }
        this.viewerDeleteableColumns.addColumn(columnName);
    }

    public getViewerDeleteableColumns(): Columns {
        return this.viewerDeleteableColumns;
    }

    public setSlugifyColumn(columnName: string): void {
        this.slugifyColumn = columnName;
    }

    public addUniqueColumn(columnName: string): void {
        if (!this.uniqueColumns) {
            this.uniqueColumns = new Columns([]);
        }
        this.uniqueColumns.addColumn(columnName);
    }

    public getRequiredColumns(): Columns {
        return this.requiredColumns;
    }

    public addRequiredColumn(columnName: string): void {
        if (!this.requiredColumns) {
            this.requiredColumns = new Columns([]);
        }
        this.requiredColumns.addColumn(columnName);
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

    public get id(): ObjectID {
        return new ObjectID(this._id);
    }

    public set id(value: ObjectID) {
        this._id = value.toString();
    }

    private static _fromJSON<T extends BaseModel>(json: JSONObject): T {
        const baseModel: BaseModel = new BaseModel();

        for (const key of Object.keys(json)) {
            (baseModel as $TSFixMe)[key] = json[key];
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
                (baseModel as $TSFixMe)[key] = (data as $TSFixMe)[key];
            }

            if (
                columnsToKeep &&
                columnsToKeep.columns.length > 0 &&
                columnsToKeep.columns.includes(key)
            ) {
                (baseModel as $TSFixMe)[key] = (data as $TSFixMe)[key];
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

    public toJSON(): JSONObject {
        const json: JSONObject = {};
        for (const column of this.tableColumns.columns) {
            if ((this as $TSFixMe)[column]) {
                json[column] = (this as $TSFixMe)[column];
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
