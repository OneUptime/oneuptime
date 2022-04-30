import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import ScheduledEvent, { ScheduledEventState } from './ScheduledEvent';

export enum ScheduledEventNote {
    Investogation = 'Investigation',
    Internam = 'Internal',
}

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public scheduledEvent!: ScheduledEvent;

    @Column()
    public content!: string;

    @Column()
    public type!: ScheduledEventNote;

    @Column()
    public eventState!: ScheduledEventState;

    @Column()
    public createdByUser!: User;

    @Column()
    public updated!: boolean;

    @Column()
    public deletedByUser!: User;
}
