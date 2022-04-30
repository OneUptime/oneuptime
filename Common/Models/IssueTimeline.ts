import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Issue from './Issue';

export enum IssueStatus {
    New = 'New',
    Ignore = 'Ignore',
    Unresolve = 'Unreoslve',
    Resolve = 'Resolve',
}

@Entity({
    name: 'IssueTimeline',
})
export default class IssueTimeline extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public issue!: Issue;

    @Column()
    public createdByUser!: User;

    @Column()
    public status!: IssueStatus;

    @Column()
    public deletedByUser!: User;
}
