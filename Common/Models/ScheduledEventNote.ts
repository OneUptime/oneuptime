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
    scheduledEvent!: ScheduledEvent;

    @Column()
    content!: string;

    @Column()
    type!: ScheduledEventNote;

    @Column()
    eventState!: ScheduledEventState;

    @Column()
    createdByUser!: User;

    @Column()
    updated!: boolean;

    @Column()
    deletedByUser!: User;
}
