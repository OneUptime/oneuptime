import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

export enum ScriptType {
       JavaScript = "JavaScript",
       Bash = "Bash"
}

@Entity({
       name: "AutomatedScripts"
})
export default class AutomatedScript extends BaseModel {

       @Column()
       name!: string;

       @Column()
       script!: string;

       @Column()
       scriptType!: ScriptType;

       @Column()
       slug!: string;

       @Column()
       project!: Project

       @Column()
       deletedByUser!: User

}








