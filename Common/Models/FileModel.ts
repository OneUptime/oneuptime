import { Column } from 'typeorm';
import ColumnLength from '../Types/Database/ColumnLength';
import ColumnType from '../Types/Database/ColumnType';
import SlugifyColumn from '../Types/Database/SlugifyColumn';
import TableColumn from '../Types/Database/TableColumn';
import TableColumnType from '../Types/Database/TableColumnType';
import MimeType from '../Types/File/MimeType';
import ObjectID from '../Types/ObjectID';
import BaseModel from './BaseModel';

@SlugifyColumn('name', 'slug')
export default class FileModel extends BaseModel {

    public constructor(id?: ObjectID) {
        super(id);
    }

    public override isFileModel(): boolean {
        return true;
    }

    @TableColumn({ required: true, type: TableColumnType.File })
    @Column({
        nullable: false,
        type: ColumnType.File,
    })
    public file?: Buffer = undefined;

    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public name?: string = undefined;

    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public type?: MimeType = undefined;

    @TableColumn({ required: true, unique: true, type: TableColumnType.Slug })
    @Column({
        nullable: false,
        type: ColumnType.Slug,
        length: ColumnLength.Slug,
    })
    public slug?: string = undefined;

    @TableColumn({
        required: true,
        isDefaultValueColumn: true,
        type: TableColumnType.Slug,
    })
    @Column({
        nullable: false,
        default: true,
        type: ColumnType.Slug,
        length: ColumnLength.Slug,
    })
    public isPublic?: boolean = undefined;
}
