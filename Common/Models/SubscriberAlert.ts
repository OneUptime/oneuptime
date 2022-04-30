import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import Subscriber from './Subscriber';
import Incident from './Incident';
import AlertType from '../Types/Alerts/AlertType';
import OperationResult from '../Types/Operation/OperationResult';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public project!: Project;

    @Column()
    public subscriber!: Subscriber;

    @Column()
    public incident!: Incident;

    @Column()
    public alertVia!: AlertType;

    @Column()
    public status!: OperationResult;

    @Column()
    public eventType!: AlertEventType;

    @Column()
    public errorMessage!: string;

    @Column()
    public deletedByUser!: User;
}
