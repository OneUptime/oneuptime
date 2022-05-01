import {
    DeleteDateColumn,
    UpdateDateColumn,
    CreateDateColumn,
    VersionColumn,
    PrimaryGeneratedColumn,
    BaseEntity,
    Entity,
} from 'typeorm';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import ObjectID from '../Types/ObjectID';

@Entity()
export default class BaseModel {
    private encryptedColumns!: EncryptedColumns;
    private uniqueColumns!: UniqueColumns;
    private requiredColumns!: RequiredColumns;

    private slugifyColumn: string | null = null;

    public getEncryptedColumns(): EncryptedColumns {
        return this.encryptedColumns;
    }

    public addEncryptedColumn(columnName: string): void {
        this.encryptedColumns.addColumn(columnName);
    }

    public getUniqueColumns(): UniqueColumns {
        return this.uniqueColumns;
    }

    public setSlugifyColumn(columnName: string) {
        this.slugifyColumn = columnName;
    }

    public addUniqueColumn(columnName: string): void {
        this.uniqueColumns.addColumn(columnName);
    }

    public getRequiredColumn(): RequiredColumns {
        return this.requiredColumns;
    }

    public addRequiredColumns(columnName: string): void {
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
    private _id!: string;

    @CreateDateColumn()
    public createdAt!: Date;

    @UpdateDateColumn()
    public updatedAt!: Date;

    @DeleteDateColumn()
    public deletedAt?: Date;

    @VersionColumn()
    public version!: number;
}
