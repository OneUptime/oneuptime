import { Column, Entity, Index } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import Route from 'Common/Types/API/Route';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableColumn from 'Common/Types/Database/TableColumn';
import ColumnType from 'Common/Types/Database/ColumnType';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import IconProp from 'Common/Types/Icon/IconProp';
import URL from 'Common/Types/API/URL';

@TableAccessControl({
    create: [],
    read: [
     
    ],
    delete: [],
    update: [],
})
@CrudApiEndpoint(new Route('/short-link'))
@Entity({
    name: 'ShortLink',
})
@TableMetadata({
    tableName: 'ShortLink',
    singularName: 'Short Link',
    pluralName: 'Short Links',
    icon: IconProp.Link,
    tableDescription:
        'Short links are used to redirect users to a specific long link in OneUptime.',
})
export default class SmsLog extends BaseModel {
   

    @ColumnAccessControl({
        create: [],
        read: [
            
        ],
        update: [],
    })
    @Index()
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        title: 'Short Link ID',
        description: 'Random ID for the short link',
        canReadOnRelationQuery: false,
    })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public shortId?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            
        ],
        update: [],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.LongURL,
        title: 'Long URL',
        description: 'Long URL to redirect to',
        canReadOnRelationQuery: false,
    })
    @Column({
        nullable: false,
        type: ColumnType.LongURL,
        transformer: URL.getDatabaseTransformer(),
    })
    public link?: URL = undefined;
}
