import { Entity } from 'typeorm';
import FileModel from 'Common/Models/FileModel';
import SingularPluralName from 'Common/Types/Database/SingularPluralName';

@SingularPluralName('File', 'Files')
@Entity({
    name: 'File',
})
export default class Label extends FileModel {
    
}
