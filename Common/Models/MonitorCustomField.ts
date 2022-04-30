import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Project from './Project';
import { CustomFieldType } from './CustomField';

@Entity({
    name: 'MonitorCustomField',
})
export default class MonitorCustomField extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public fieldName!: string;

    @Column()
    public fieldType!: CustomFieldType;

    @Column()
    public project!: Project;

    @Column()
    public uniqueField!: boolean;
}
