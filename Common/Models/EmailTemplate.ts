import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
import EmailTemplateType from '../Types/Email/EmailTemplateType';

@Entity({
    name: 'EmailTemplate',
})
export default class EmailTemplate extends BaseModel {
    @Column()
    public project!: Project;

    @Column()
    public subject!: string;

    @Column()
    public body!: string;

    @Column()
    public emailType!: EmailTemplateType;

    @Column()
    public allowedVariables!: Array<string>;

    @Column()
    public deletedByUser!: User;
}
