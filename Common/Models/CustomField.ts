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
    fieldName!: string;

    @Column()
    fieldType!: CustomFieldType;

    @Column()
    project!: Project;

    @Column()
    uniqueField!: boolean;
}
