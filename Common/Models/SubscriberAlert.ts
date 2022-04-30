import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';
import Subscriber from './Subscriber';
import Incident from './Incident';
import AlertType from '../Types/Alerts/AlertType';
import AlertEventType from '../Types/Alerts/AlertEventType';
import OperationResult from '../Types/Operation/OperationResult';

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
