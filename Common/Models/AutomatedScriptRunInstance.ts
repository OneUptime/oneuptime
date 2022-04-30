import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import AutomatedScript from './AutomatedScript';
import Incident from './Incident';
import OperationStatus from '../Types/OperationStatus';

@Entity({
    name: 'AutomationScriptRunInstance',
})
export default class AutomationScriptRunInstance extends BaseModel {
    @Column()
    public automationScript!: AutomatedScript;

    @Column()
    public project!: Project;

    @Column()
    public triggerByUser!: User;

    @Column()
    public triggerByScript!: AutomatedScript;

    @Column()
    public triggerByIncident!: Incident;

    @Column()
    public scriptStatus!: OperationStatus;

    @Column()
    public deletedByUser!: User;

    @Column()
    public executionTime!: Number;

    @Column()
    public errorDescription!: string;
}
