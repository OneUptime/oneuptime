import {
    DeleteDateColumn,
    UpdateDateColumn,
    CreateDateColumn,
    VersionColumn,
    PrimaryGeneratedColumn,
    BaseEntity,
} from 'typeorm';
import Columns from '../Types/Database/Columns';
import ObjectID from '../Types/ObjectID';

export default class BaseModel extends BaseEntity{


    private encryptedColumns!: Columns;
    private uniqueColumns!: Columns;
    private requiredColumns!: Columns;

    private ownerAccessibleColumns!: Columns;
    private adminAccessibleColumns!: Columns;
    private memberAccessibleColumns!: Columns;
    private viewerAccessibleColumns!: Columns;
    private publicAccessibleColumns!: Columns;

    private slugifyColumn: string | null = null;

    public getEncryptedColumns(): Columns {
        return this.encryptedColumns;
    }

    public addEncryptedColumn(columnName: string): void {
        this.encryptedColumns.addColumn(columnName);
    }

    public getUniqueColumns(): Columns {
        return this.uniqueColumns;
    }

    public getOwnerAccessibleColumns(): Columns {
        return this.ownerAccessibleColumns;
    }

    public addOwnerAccessibleColumn(columnName: string): void {
        this.ownerAccessibleColumns.addColumn(columnName);
    }

    public getPublicAccessibleColumns(): Columns {
        return this.publicAccessibleColumns;
    }

    public addPublicAccessibleColumn(columnName: string): void {
        this.publicAccessibleColumns.addColumn(columnName);
    }

    public addAdminAccessibleColumn(columnName: string): void {
        this.adminAccessibleColumns.addColumn(columnName);
    }

    public getAdminAccessibleColumns(): Columns {
        return this.adminAccessibleColumns;
    }

    public addMemberAccessibleColumn(columnName: string): void {
        this.memberAccessibleColumns.addColumn(columnName);
    }

    public getMemberAccessibleColumns(): Columns {
        return this.memberAccessibleColumns;
    }

    public addViewerAccessibleColumn(columnName: string): void {
        this.viewerAccessibleColumns.addColumn(columnName);
    }

    public getViewerAccessibleColumns(): Columns {
        return this.viewerAccessibleColumns;
    }

    public setSlugifyColumn(columnName: string) {
        this.slugifyColumn = columnName;
    }

    public addUniqueColumn(columnName: string): void {
        this.uniqueColumns.addColumn(columnName);
    }

    public getRequiredColumns(): Columns {
        return this.requiredColumns;
    }

    public addRequiredColumn(columnName: string): void {
        this.requiredColumns.addColumn(columnName);
    }

    public getSlugifyColumn(): string | null {
        return this.slugifyColumn;
    }
    
    public get id() : ObjectID {
        return new ObjectID(this._id);
    }

    public set id(value: ObjectID) {
        this._id = value.toString();
    }
    
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
}
