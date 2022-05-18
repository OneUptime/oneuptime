import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
import Hostname from '../Types/API/Hostname';
import Email from '../Types/Email';
import Port from '../Types/Port';

@Entity({
    name: 'ProjectSmtpConfig',
})
export default class ProjectSmtpConfig extends BaseModel {
    @Column({
        nullable: false,
    })
    @Index()
    public project?: Project;

    @Column({
        nullable: false,
    })
    public useranme? : string = undefined;

    @Column({
        nullable: false,
    })
    public password? : string = undefined;

    @Column({
        nullable: false,
    })
    public host?: Hostname;

    @Column({
        nullable: false,
    })
    public port?: Port;

    @Column({
        nullable: false,
    })
    public fromEmail?:Email = undefined;

    @Column({
        nullable: false,
    })
    public fromName? : string = undefined;

    @Column({
        nullable: false,
    })
    public iv?: Buffer;

    @Column({
        nullable: false,
        default: true,
    })
    public secure?: boolean = undefined;

    @Column({
        nullable: false,
        default: true,
    })
    public enabled?: boolean = undefined;

    @Column()
    public deletedByUser?: User;
}
