import { Column, Entity, Index} from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableColumn from 'Common/Types/Database/TableColumn';
import ColumnType from 'Common/Types/Database/ColumnType';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import SingularPluralName from 'Common/Types/Database/SingularPluralName';

@TableAccessControl({
    create: [],
    read: [],
    delete: [],
    update: [],
})
@SingularPluralName('Greenlock Challenge', 'Greenlock Challenges')
@Entity({
    name: 'GreenlockChallenge',
})
export default class GreenlockChallenge extends BaseModel {

    @Index()
    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({ type: TableColumnType.LongText })
    @Column({
        type: ColumnType.LongText,
        length: ColumnLength.LongText,
        nullable: false,
        unique: false,
    })
    public key?: string = undefined;


    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({ type: TableColumnType.LongText })
    @Column({
        type: ColumnType.LongText,
        nullable: false,
        unique: false,
    })
    public challenge?: string = undefined;
}
