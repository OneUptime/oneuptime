import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';

@Entity({
    name: 'EmailLog',
})
export default class EmailLog extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
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
