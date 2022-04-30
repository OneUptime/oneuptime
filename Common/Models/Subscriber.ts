import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';
import StatusPage from './StatusPage';
import Monitor from './Monitor';
import AlertType from '../Types/Alerts/AlertType';
import HTTPMethod from '../Types/API/HTTPMethod';

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
    public monitor!: Monitor;

    @Column()
    public project!: Project;

    @Column()
    public statusPage!: StatusPage;

    @Column()
    public alertType!: AlertType;

    @Column()
    public contactEmail!: string;

    @Column()
    public contactPhone!: string;

    @Column()
    public countryCode!: string;

    @Column()
    public contactWebhook!: string;

    @Column()
    public webhookMethod!: HTTPMethod;

    @Column()
    public incidentNotification!: boolean;

    @Column()
    public announcementNotification!: boolean;

    @Column()
    public scheduledEventNotification!: boolean;

    @Column()
    public subscribed!: boolean;

    @Column()
    public deletedByUser!: User;
}
