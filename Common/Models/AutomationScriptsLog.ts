import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import AutomatedScript from './AutomationScript';
import Incident from './Incident';
import OperationStatus from '../Types/OperationStatus';

@Entity({
    name: "AutomationScriptLog"
})
export default class Model extends BaseModel{
 
       @Column()
       automationScript!: AutomatedScript

       @Column()
       project!: Project
 
       @Column()
       triggerByUser!: User
 
       @Column()
       triggerByScript!: AutomatedScript
 
       @Column()
       triggerByIncident!: Incident
 
       @Column()
       scriptStatus!: OperationStatus
 
       @Column()
       deletedByUser!: User
 
       @Column()
       executionTime!: Number;
 
       @Column()
       scriptConsoleLogs!: Array<string>;
 
       @Column()
       errorDescription!: string;
}









