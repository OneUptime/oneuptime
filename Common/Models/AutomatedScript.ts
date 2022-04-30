import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
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
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
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
