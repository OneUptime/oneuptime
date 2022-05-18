import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import ErrorTrackerContainer from './ErrorTrackerContainer';

export enum IssueType {
    Exception = 'Exception',
    Message = 'Message',
    Error = 'Error',
}

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public name? : string = undefined;

    @Column()
    public description? : string = undefined;

    @Column()
    public errorTracker?: ErrorTrackerContainer;

    @Column()
    public type?: IssueType;

    @Column()
    public fingerprintHash? : string = undefined;

    @Column()
    public deletedByUser?: User;

    @Column()
    public resolved?: boolean = undefined;

    @Column()
    public resolvedAt?: Date = undefined;

    @Column()
    public resolvedBy?: User;

    @Column()
    public ignored?: boolean = undefined;

    @Column()
    public ignoredAt?: Date = undefined;

    @Column()
    public ignoredBy?: User;
}
