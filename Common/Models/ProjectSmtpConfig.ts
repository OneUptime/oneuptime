import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';

@Entity({
    name: 'ProjectSmtpConfig',
})
export default class ProjectSmtpConfig extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column({
        nullable: false,
    })
    @Index()
    public project!: Project;

    @Column({
        nullable: false,
    })
    public useranme!: string;

    @Column({
        nullable: false,
    })
    public password!: string;

    @Column({
        nullable: false,
    })
    public host!: string;

    @Column({
        nullable: false,
    })
    public port!: number;

    @Column({
        nullable: false,
    })
    public fromEmail!: string;

    @Column({
        nullable: false,
    })
    public fromName!: string;

    @Column({
        nullable: false,
    })
    public iv!: Buffer;

    @Column({
        nullable: false,
        default: true,
    })
    public secure!: boolean;

    @Column({
        nullable: false,
        default: true,
    })
    public enabled!: boolean;

    @Column()
    public deletedByUser!: User;
}
