import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Project from './Project';
import OperationStatus from 'Common/Types/Operation/OperationStatus';

@Entity({
    name: 'CallLog',
})
export default class CallLog extends BaseModel {
    @Column()
    public fromNumber?: string = undefined;

    @Column()
    public toNumber?: string = undefined;

    @Column()
    public project?: Project;

    @Column()
    public deletedByUser?: User;

    @Column()
    public content?: string = undefined;

    @Column()
    public status?: OperationStatus;

    @Column()
    public errorDescription?: string = undefined;
}
