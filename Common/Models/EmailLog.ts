import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'EmailLog',
})
export default class EmailLog extends BaseModel {
    
    @Column()
    public fromEmail!: string;

    @Column()
    public fromName!: string;

    @Column()
    public project!: Project;

    @Column()
    public toEmail!: string;

    @Column()
    public subject!: string;

    @Column()
    public body!: string;

    @Column()
    public templateType!: string;

    @Column()
    public status!: string;

    @Column()
    public errorDescription!: string;

    @Column()
    public smtpHost!: string;

    @Column()
    public deletedByUser!: User;
}
