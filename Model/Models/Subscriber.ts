import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Project from './Project';
import StatusPage from './StatusPage';
import Monitor from './Monitor';
import AlertType from 'Common/Types/Alerts/AlertType';
import HTTPMethod from 'Common/Types/API/HTTPMethod';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public monitor?: Monitor;

    @Column()
    public project?: Project;

    @Column()
    public statusPage?: StatusPage;

    @Column()
    public alertType?: AlertType;

    @Column()
    public contactEmail?: string = undefined;

    @Column()
    public contactPhone?: string = undefined;

    @Column()
    public countryCode?: string = undefined;

    @Column()
    public contactWebhook?: string = undefined;

    @Column()
    public webhookMethod?: HTTPMethod;

    @Column()
    public incidentNotification?: boolean = undefined;

    @Column()
    public announcementNotification?: boolean = undefined;

    @Column()
    public scheduledEventNotification?: boolean = undefined;

    @Column()
    public subscribed?: boolean = undefined;

    @Column()
    public deletedByUser?: User;
}
