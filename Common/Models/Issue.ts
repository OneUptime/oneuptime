import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
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
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public name!: string;

    @Column()
    public description!: string;

    @Column()
    public errorTracker!: ErrorTrackerContainer;

    @Column()
    public type!: IssueType;

    @Column()
    public fingerprintHash!: string;

    @Column()
    public deletedByUser!: User;

    @Column()
    public resolved!: boolean;

    @Column()
    public resolvedAt!: Date;

    @Column()
    public resolvedBy!: User;

    @Column()
    public ignored!: boolean;

    @Column()
    public ignoredAt!: Date;

    @Column()
    public ignoredBy!: User;
}
