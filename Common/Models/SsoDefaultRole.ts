import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import Role from '../Types/Role';

@Entity({
    name: 'SsoDefaultRole',
})
export default class SsoDefaultRole extends BaseModel {
    @Column()
    public domain!: string;

    @Column()
    public project!: Project;

    @Column()
    public role!: Role;

    @Column()
    public deletedByUser!: User;
}
