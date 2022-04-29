import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import AutomatedScript from './AutomatedScript';
import Incident from './Incident';
import OperationStatus from '../Types/OperationStatus';

@Entity({
    name: "AutomationScriptRunInstance"
})
export default class AutomationScriptRunInstance extends BaseModel{
 
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
       errorDescription!: string;
}









