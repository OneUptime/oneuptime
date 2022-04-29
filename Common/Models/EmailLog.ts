import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
    name: 'EmailLog',
})
export default class EmailLog extends BaseModel {
    @Column()
    fromEmail!: string;

    @Column()
    fromName!: string;

    @Column()
    project!: Project;

    @Column()
    toEmail!: string;

    @Column()
    subject!: string;

    @Column()
    body!: string;

    @Column()
    templateType!: string;

    @Column()
    status!: string;

    @Column()
    errorDescription!: string;

    @Column()
    smtpHost!: string;

    @Column()
    deletedByUser!: User;
}
