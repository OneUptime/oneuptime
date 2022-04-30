import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import OperationStatus from '../Types/OperationStatus';

@Entity({
    name: 'CallLog',
})
export default class CallLog extends BaseModel {
    @Column()
    public fromNumber!: string;

    @Column()
    public toNumber!: string;

    @Column()
    public project!: Project;

    @Column()
    public deletedByUser!: User;

    @Column()
    public content!: string;

    @Column()
    public status!: OperationStatus;

    @Column()
    public errorDescription!: string;
}
