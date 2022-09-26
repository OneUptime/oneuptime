import { Entity } from 'typeorm';
import FileModel from 'Common/Models/FileModel';
import SingularPluralName from 'Common/Types/Database/SingularPluralName';
import Route from 'Common/Types/API/Route';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import Permission from 'Common/Types/Permission';

@SingularPluralName('File', 'Files')
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
