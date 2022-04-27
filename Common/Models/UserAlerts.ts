import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import { IncidentState }, Incident from './Incident';
import Escalation from './Escalation';
import Schedule from './Schedule';

@Entity({
    name: "UserAlerts"
})
export default class UserAlerts extends BaseModel {

    @Column({
        nullable: false, 
    })
    project!: Project;

    @Column({
        nullable: false, 
    })
    user!: User;

    @Column()
    alertType!: string;

    @Column()
    alertStatus!: string;

    @Column()
    eventType!: IncidentState

    @Column()
    incident!: Incident;

    @Column()
    onCallScheduleStatus!: OnCallSchedule;

    @Column()
    schedule!: Schedule;

    @Column()
    escalation!: Escalation;

    @Column()
    error!: boolean;

    @Column()
    errorMessage!: string;

    @Column()
    alertProgress!: string

    @Column()
    deletedByUser!: User;
}









