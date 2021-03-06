import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

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
    @Column()
    public issue?: Issue;

    @Column()
    public createdByUser?: User;

    @Column()
    public status?: IssueStatus;

    @Column()
    public deletedByUser?: User;
}
