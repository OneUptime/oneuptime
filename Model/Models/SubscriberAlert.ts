import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Project from './Project';
import Subscriber from './Subscriber';
import Incident from './Incident';
import AlertType from 'Common/Types/Alerts/AlertType';
import AlertEventType from 'Common/Types/Alerts/AlertEventType';
import OperationResult from 'Common/Types/Operation/OperationResult';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public project?: Project;

    @Column()
    public subscriber?: Subscriber;

    @Column()
    public incident?: Incident;

    @Column()
    public alertVia?: AlertType;

    @Column()
    public status?: OperationResult;

    @Column()
    public eventType?: AlertEventType;

    @Column()
    public errorMessage?: string = undefined;

    @Column()
    public deletedByUser?: User;
}
