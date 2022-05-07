import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

export enum ScriptType {
    JavaScript = 'JavaScript',
    Bash = 'Bash',
}

@Entity({
    name: 'AutomatedScripts',
})
export default class AutomatedScript extends BaseModel {
    @Column()
    public name!: string;

    @Column()
    public script!: string;

    @Column()
    public scriptType!: ScriptType;

    @Column()
    public slug!: string;

    @Column()
    public project!: Project;

    @Column()
    public deletedByUser!: User;
}
