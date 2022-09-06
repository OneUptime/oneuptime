import { Entity } from 'typeorm';
import FileModel from 'Common/Models/FileModel';
import SingularPluralName from 'Common/Types/Database/SingularPluralName';
import Route from 'Common/Types/API/Route';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';

@SingularPluralName('File', 'Files')
@Entity({
    name: 'File',
})
@CrudApiEndpoint(new Route('/file'))
export default class Label extends FileModel {
    
}
