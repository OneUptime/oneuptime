import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
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
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
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
