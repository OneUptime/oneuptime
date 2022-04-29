import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import Project from './Project';
import { CustomFieldType } from './CustomField';

@Entity({
    name: 'MonitorCustomField',
})
export default class MonitorCustomField extends BaseModel {
    @Column()
    fieldName!: string;

    @Column()
    fieldType!: CustomFieldType;

    @Column()
    project!: Project;

    @Column()
    uniqueField!: boolean;
}
