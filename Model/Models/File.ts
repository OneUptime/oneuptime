import FileModel from 'Common/Models/FileModel';
import Route from 'Common/Types/API/Route';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import IconProp from 'Common/Types/Icon/IconProp';
import Permission from 'Common/Types/Permission';
import { Entity } from 'typeorm';

@TableMetadata({
    tableName: 'File',
    singularName: 'File',
    pluralName: 'Files',
    icon: IconProp.File,
    tableDescription: 'BLOB or File storage',
})
@Entity({
    name: 'File',
})
@CrudApiEndpoint(new Route('/file'))
@TableAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    delete: [],
    update: [],
})
export default class File extends FileModel {}
