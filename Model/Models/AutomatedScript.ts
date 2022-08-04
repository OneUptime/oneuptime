import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

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
    public name?: string = undefined;

    @Column()
    public script?: string = undefined;

    @Column()
    public scriptType?: ScriptType;

    @Column()
    public slug?: string = undefined;

    @Column()
    public project?: Project;

    @Column()
    public deletedByUser?: User;
}
