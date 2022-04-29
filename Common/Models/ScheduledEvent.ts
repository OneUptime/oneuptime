import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    project!: Project;

    @Column()
    name!: string;

    @Column()
    cancelled!: boolean;

    @Column()
    cancelledAt!: Date;

    @Column()
    cancelledBy!: User;

    @Column()
    slug!: string;

    @Column()
    createdByUser!: User;

    @Column()
    deletedByUser!: User;

    @Column()
    startDate!: Date;

    @Column()
    endDate!: Date;

    @Column()
    description!: string;

    @Column()
    showEventOnStatusPage!: boolean;

    @Column()
    callScheduleOnEvent!: boolean;

    @Column()
    monitorDuringEvent!: boolean;

    @Column()
    recurring!: boolean;

    @Column()
    interval!: string;

    @Column()
    alertSubscriber!: boolean;

    @Column()
    resolved!: boolean;

    @Column()
    resolvedBy!: User;

    @Column()
    resolvedAt!: Date;
}
