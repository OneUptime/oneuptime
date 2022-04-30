import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Project from './Project';

export enum CustomFieldType {
    Text = 'text',
    Number = 'number',
}

@Entity({
    name: 'CustomField',
})
export default class CustomField extends BaseModel {
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
