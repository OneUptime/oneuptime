import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';
import EmailTemplateType from '../Types/Email/EmailTemplateType';

@Entity({
    name: 'EmailTemplate',
})
export default class EmailTemplate extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
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
