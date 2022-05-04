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

export default class BaseModel extends BaseEntity {
    private encryptedColumns: Columns = new Columns([]);
    private uniqueColumns: Columns = new Columns([]);
    private requiredColumns: Columns = new Columns([]);

    private ownerAccessibleColumns: Columns = new Columns([]);
    private adminAccessibleColumns: Columns = new Columns([]);
    private memberAccessibleColumns: Columns = new Columns([]);
    private viewerAccessibleColumns: Columns = new Columns([]);
    private publicAccessibleColumns: Columns = new Columns([]);

    private slugifyColumn!: string | null;
    private saveSlugToColumn!: string | null;

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

    public getOwnerAccessibleColumns(): Columns {
        return this.ownerAccessibleColumns;
    }

    public addOwnerAccessibleColumn(columnName: string): void {
        if (!this.ownerAccessibleColumns) {
            this.ownerAccessibleColumns = new Columns([]);
        }
        this.ownerAccessibleColumns.addColumn(columnName);
    }

    public getPublicAccessibleColumns(): Columns {
        return this.publicAccessibleColumns;
    }

    public addPublicAccessibleColumn(columnName: string): void {
        if (!this.publicAccessibleColumns) {
            this.publicAccessibleColumns = new Columns([]);
        }
        this.publicAccessibleColumns.addColumn(columnName);
    }

    public addAdminAccessibleColumn(columnName: string): void {
        if (!this.adminAccessibleColumns) {
            this.adminAccessibleColumns = new Columns([]);
        }
        this.adminAccessibleColumns.addColumn(columnName);
    }

    public getAdminAccessibleColumns(): Columns {
        return this.adminAccessibleColumns;
    }

    public addMemberAccessibleColumn(columnName: string): void {
        if (!this.memberAccessibleColumns) {
            this.memberAccessibleColumns = new Columns([]);
        }
        this.memberAccessibleColumns.addColumn(columnName);
    }

    public getMemberAccessibleColumns(): Columns {
        return this.memberAccessibleColumns;
    }

    public addViewerAccessibleColumn(columnName: string): void {
        if (!this.viewerAccessibleColumns) {
            this.viewerAccessibleColumns = new Columns([]);
        }
        this.viewerAccessibleColumns.addColumn(columnName);
    }

    public getViewerAccessibleColumns(): Columns {
        return this.viewerAccessibleColumns;
    }

    public setSlugifyColumn(columnName: string) {
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
