import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    
    @Column()
    public project!: Project;

    @Column()
    public name!: string;

    @Column()
    public cancelled!: boolean;

    @Column()
    public cancelledAt!: Date;

    @Column()
    public cancelledBy!: User;

    @Column()
    public slug!: string;

    @Column()
    public createdByUser!: User;

    @Column()
    public deletedByUser!: User;

    @Column()
    public startDate!: Date;

    @Column()
    public endDate!: Date;

    @Column()
    public description!: string;

    @Column()
    public showEventOnStatusPage!: boolean;

    @Column()
    public callScheduleOnEvent!: boolean;

    @Column()
    public monitorDuringEvent!: boolean;

    @Column()
    public recurring!: boolean;

    @Column()
    public interval!: string;

    @Column()
    public alertSubscriber!: boolean;

    @Column()
    public resolved!: boolean;

    @Column()
    public resolvedBy!: User;

    @Column()
    public resolvedAt!: Date;
}
