import { Column, Entity } from 'typeorm';
import GlobalConfigModel from 'Common/Models/GlobalConfig';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import IconProp from 'Common/Types/Icon/IconProp';
import Route from 'Common/Types/API/Route';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TableColumn from 'Common/Types/Database/TableColumn';
import TableColumnType from 'Common/Types/BaseDatabase/TableColumnType';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import ColumnType from 'Common/Types/Database/ColumnType';

@TableMetadata({
    tableName: 'GlobalConfig',
    singularName: 'Global Config',
    pluralName: 'Global Configs',
    icon: IconProp.Settings,
    tableDescription: 'Settings for OneUptime Server',
})
@Entity({
    name: 'GlobalConfig',
})
@CrudApiEndpoint(new Route('/global-config'))
@TableAccessControl({
    create: [],
    read: [],
    delete: [],
    update: [],
})
export default class GlobalConfig extends GlobalConfigModel {

    @ColumnAccessControl({
        create: [
           
        ],
        read: [
            
        ],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Domain Verification Text',
        description:
            'Verification text that you need to add to your domains TXT record to veify the domain.',
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: false,
        unique: true,
    })
    public domainVerificationText?: string = undefined;
}
