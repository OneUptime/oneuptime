import {
    DeleteDateColumn,
    UpdateDateColumn,
    CreateDateColumn,
    VersionColumn,
    PrimaryGeneratedColumn,
    BaseEntity,
} from 'typeorm';
import Columns from '../Types/Database/Columns';
import { JSONObject } from '../Types/JSON';
import ObjectID from '../Types/ObjectID';

export default class BaseModel extends BaseEntity {


    @PrimaryGeneratedColumn('uuid')
    public _id!: string;

    @CreateDateColumn()
    public createdAt!: Date;

    @UpdateDateColumn()
    public updatedAt!: Date;

    @DeleteDateColumn()
    public deletedAt?: Date;

    @VersionColumn()
    public version!: number;

    
    private encryptedColumns: Columns = new Columns([]);
    private uniqueColumns: Columns = new Columns([]);
    private requiredColumns: Columns = new Columns([]);
    private hashedColumns: Columns = new Columns([]);

    private ownerReadableColumns: Columns = new Columns([]);
    private adminReadableColumns: Columns = new Columns([]);
    private memberReadableColumns: Columns = new Columns([]);
    private viewerReadableColumns: Columns = new Columns([]);
    private publicReadableColumns: Columns = new Columns([]);

    private ownerUpdateableColumns: Columns = new Columns([]);
    private adminUpdateableColumns: Columns = new Columns([]);
    private memberUpdateableColumns: Columns = new Columns([]);
    private viewerUpdateableColumns: Columns = new Columns([]);
    private publicUpdateableColumns: Columns = new Columns([]);

    private ownerCreateableColumns: Columns = new Columns([]);
    private adminCreateableColumns: Columns = new Columns([]);
    private memberCreateableColumns: Columns = new Columns([]);
    private viewerCreateableColumns: Columns = new Columns([]);
    private publicCreateableColumns: Columns = new Columns([]);

    private ownerDeleteableColumns: Columns = new Columns([]);
    private adminDeleteableColumns: Columns = new Columns([]);
    private memberDeleteableColumns: Columns = new Columns([]);
    private viewerDeleteableColumns: Columns = new Columns([]);
    private publicDeleteableColumns: Columns = new Columns([]);

    private slugifyColumn!: string | null;
    private saveSlugToColumn!: string | null;

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

    public getUniqueColumns(): Columns {
        return this.uniqueColumns;
    }

    public getOwnerReadableColumns(): Columns {
        return this.ownerReadableColumns;
    }

    public addOwnerReadableColumn(columnName: string): void {
        if (!this.ownerReadableColumns) {
            this.ownerReadableColumns = new Columns([]);
        }
        this.ownerReadableColumns.addColumn(columnName);
    }

    public getOwnerCreateableColumns(): Columns {
        return this.ownerCreateableColumns;
    }

    public getOwnerDeleteableColumns(): Columns {
        return this.ownerDeleteableColumns;
    }

    public getPublicReadableColumns(): Columns {
        return this.publicReadableColumns;
    }

    public addPublicReadableColumn(columnName: string): void {
        if (!this.publicReadableColumns) {
            this.publicReadableColumns = new Columns([]);
        }
        this.publicReadableColumns.addColumn(columnName);
    }

    public addAdminReadableColumn(columnName: string): void {
        if (!this.adminReadableColumns) {
            this.adminReadableColumns = new Columns([]);
        }
        this.adminReadableColumns.addColumn(columnName);
    }

    public getAdminReadableColumns(): Columns {
        return this.adminReadableColumns;
    }

    public addMemberReadableColumn(columnName: string): void {
        if (!this.memberReadableColumns) {
            this.memberReadableColumns = new Columns([]);
        }
        this.memberReadableColumns.addColumn(columnName);
    }

    public getMemberReadableColumns(): Columns {
        return this.memberReadableColumns;
    }

    public addViewerReadableColumn(columnName: string): void {
        if (!this.viewerReadableColumns) {
            this.viewerReadableColumns = new Columns([]);
        }
        this.viewerReadableColumns.addColumn(columnName);
    }

    public getViewerReadableColumns(): Columns {
        return this.viewerReadableColumns;
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

    public get id(): ObjectID {
        return new ObjectID(this._id);
    }

    public set id(value: ObjectID) {
        this._id = value.toString();
    }

    private static _fromJSON<T extends BaseModel>(json: JSONObject): T {
        const baseModel = new BaseModel();

        for (let key of Object.keys(json)) {

            (baseModel as any)[key] = json[key];
           
        }

        return baseModel as T;
    }



    public static fromJSON<T extends BaseModel>(json: JSONObject): T {
        return this._fromJSON<T>(json);
    }

    private static keepColumns<T extends BaseModel>(data: T, columnsToKeep: Columns): T {
        const baseModel = new BaseModel();

        for (let key of Object.keys(data)) {

            if (!columnsToKeep) {
                (baseModel as any)[key] = (data as any)[key];
            }

            if (columnsToKeep && columnsToKeep.columns.length > 0 && columnsToKeep.columns.includes(key)) {
                (baseModel as any)[key] = (data as any)[key];
            }
           
        }

        return baseModel as T;
    }

    public static asPublicCreateable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getPublicCreateableColumns()); 
    }

    public static asPublicUpdateable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getPublicUpdateableColumns()); 
    }

    public static asPublicReadable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getPublicReadableColumns()); 
    }

    public static asPublicDeleteable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getPublicDeleteableColumns()); 
    }

    public static asOwnerCreateable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getOwnerCreateableColumns()); 
    }

    public static asOwnerUpdateable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getOwnerUpdateableColumns()); 
    }

    public static asOwnerReadable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getOwnerReadableColumns()); 
    }

    public static asOwnerDeleteable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getOwnerDeleteableColumns()); 
    }



    public static asViewerCreateable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getViewerCreateableColumns()); 
    }

    public static asViewerUpdateable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getViewerUpdateableColumns()); 
    }

    public static asViewerReadable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getViewerReadableColumns()); 
    }

    public static asViewerDeleteable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getViewerDeleteableColumns()); 
    }


    public static asMemberCreateable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getMemberCreateableColumns()); 
    }

    public static asMemberUpdateable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getMemberUpdateableColumns()); 
    }

    public static asMemberReadable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getMemberReadableColumns()); 
    }

    public static asMemberDeleteable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getMemberDeleteableColumns()); 
    }


    public static asAdminCreateable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getAdminCreateableColumns()); 
    }

    public static asAdminUpdateable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getAdminUpdateableColumns()); 
    }

    public static asAdminReadable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getAdminReadableColumns()); 
    }

    public static asAdminDeleteable<T extends BaseModel>(data: JSONObject | T) {
        
        if (!(data instanceof BaseModel)) {
            data = this._fromJSON<T>(data);
        }

        return this.keepColumns(data, data.getAdminDeleteableColumns()); 
    }
}
