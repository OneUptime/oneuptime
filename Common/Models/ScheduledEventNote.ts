import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import ScheduledEvent from './ScheduledEvent';
import ScheduledEventState from '../Types/ScheduledEvent/ScheduledEventState';

export enum ScheduledEventNote {
    Investogation = 'Investigation',
    Internam = 'Internal',
}

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public scheduledEvent?: ScheduledEvent;

    @Column()
    public content? : string = undefined;

    @Column()
    public type?: ScheduledEventNote;

    @Column()
    public eventState?: ScheduledEventState;

    @Column()
    public createdByUser?: User;

    @Column()
    public updated?: boolean = undefined;

    @Column()
    public deletedByUser?: User;
}
