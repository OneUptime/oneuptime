import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Project from './Project';

export enum CustomFieldType {
    Text = 'text',
    Number = 'number',
}

@Entity({
    name: 'CustomField',
})
export default class CustomField extends BaseModel {
    
    @Column()
    public fieldName!: string;

    @Column()
    public fieldType!: CustomFieldType;

    @Column()
    public project!: Project;

    @Column()
    public uniqueField!: boolean;
}
