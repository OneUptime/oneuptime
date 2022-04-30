import {
    DeleteDateColumn,
    UpdateDateColumn,
    CreateDateColumn,
    VersionColumn,
    PrimaryGeneratedColumn,
    BaseEntity,
} from 'typeorm';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import ObjectID from '../Types/ObjectID';

export default class BaseModel extends BaseEntity {
    private encryptedColumns!: EncryptedColumns;
    private uniqueColumns!: UniqueColumns;
    private slugifyColumn: string | null;
    private requiredColumns!: RequiredColumns;

    public constructor(
        encryptedColumns: EncryptedColumns,
        requiredColumns: RequiredColumns,
        uniqueColumns: UniqueColumns,
        slugifyColumn: string | null
    ) {
        super();
        this.encryptedColumns = encryptedColumns;
        this.slugifyColumn = slugifyColumn;
        this.requiredColumns = requiredColumns;
        this.uniqueColumns = uniqueColumns;
    }

    public getEncryptedColumns(): EncryptedColumns {
        return this.encryptedColumns;
    }

    public getUniqueColumns(): UniqueColumns {
        return this.uniqueColumns;
    }

    public getRequiredColumns(): RequiredColumns {
        return this.requiredColumns;
    }

    public getSlugifyColumn(): string | null {
        return this.slugifyColumn;
    }

    @PrimaryGeneratedColumn('uuid')
    public id!: ObjectID;

    @CreateDateColumn()
    public createdAt!: Date;

    @UpdateDateColumn()
    public updatedAt!: Date;

    @DeleteDateColumn()
    public deletedAt?: Date;

    @VersionColumn()
    public version!: number;
}
