import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Project from './Project';
import { CustomFieldType } from './CustomField';

@Entity({
    name: 'MonitorCustomField',
})
export default class MonitorCustomField extends BaseModel {
    
    @Column()
    public fieldName!: string;

    @Column()
    public fieldType!: CustomFieldType;

    @Column()
    public project!: Project;

    @Column()
    public uniqueField!: boolean;
}
