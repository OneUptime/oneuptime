import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public project?: Project;

    @Column()
    public name? : string = undefined;

    @Column()
    public cancelled?: boolean = undefined;

    @Column()
    public cancelledAt?: Date = undefined;

    @Column()
    public cancelledBy?: User;

    @Column()
    public slug? : string = undefined;

    @Column()
    public createdByUser?: User;

    @Column()
    public deletedByUser?: User;

    @Column()
    public startDate?: Date = undefined;

    @Column()
    public endDate?: Date = undefined;

    @Column()
    public description? : string = undefined;

    @Column()
    public showEventOnStatusPage?: boolean = undefined;

    @Column()
    public callScheduleOnEvent?: boolean = undefined;

    @Column()
    public monitorDuringEvent?: boolean = undefined;

    @Column()
    public recurring?: boolean = undefined;

    @Column()
    public interval? : string = undefined;

    @Column()
    public alertSubscriber?: boolean = undefined;

    @Column()
    public resolved?: boolean = undefined;

    @Column()
    public resolvedBy?: User;

    @Column()
    public resolvedAt?: Date = undefined;
}
