import { Entity } from 'typeorm';
import FileModel from 'Common/Models/FileModel';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import IconProp from 'Common/Types/Icon/IconProp';
import Route from 'Common/Types/API/Route';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import Permission from 'Common/Types/Permission';

@TableMetadata({
    tableName: 'File',
    singularName: 'File',
    pluralName: 'Files',
    icon: IconProp.File,
    tableDescription: "BLOB or File storage"
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
