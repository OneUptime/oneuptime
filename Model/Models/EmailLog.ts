import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';
import type User from './User';
import type Project from './Project';
import type Email from 'Common/Types/Email';
import type EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import type OperationResult from 'Common/Types/Operation/OperationResult';
import type Hostname from 'Common/Types/API/Hostname';

@Entity({
    name: 'EmailLog',
})
export default class EmailLog extends BaseModel {
    @Column()
    public fromEmail?: Email = undefined;

    @Column()
    public fromName?: string = undefined;

    @Column()
    public project?: Project;

    @Column()
    public toEmail?: Email = undefined;

    @Column()
    public subject?: string = undefined;

    @Column()
    public body?: string = undefined;

    @Column()
    public templateType?: EmailTemplateType;

    @Column()
    public status?: OperationResult;

    @Column()
    public errorDescription?: string = undefined;

    @Column()
    public smtpHost?: Hostname;

    @Column()
    public deletedByUser?: User;
}
