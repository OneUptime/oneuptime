import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import Email from '../Types/Email';
import EmailTemplateType from '../Types/Email/EmailTemplateType';
import OperationResult from '../Types/Operation/OperationResult';
import Hostname from '../Types/API/Hostname';

@Entity({
    name: 'EmailLog',
})
export default class EmailLog extends BaseModel {
    @Column()
    public fromEmail?: Email;

    @Column()
    public fromName?: string;

    @Column()
    public project!: Project;

    @Column()
    public toEmail!: Email;

    @Column()
    public subject!: string;

    @Column()
    public body!: string;

    @Column()
    public templateType!: EmailTemplateType;

    @Column()
    public status!: OperationResult;

    @Column()
    public errorDescription!: string;

    @Column()
    public smtpHost!: Hostname;

    @Column()
    public deletedByUser!: User;
}
