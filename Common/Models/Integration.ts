import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

export enum IntegrationType {
    Slack = 'Slack',
    Webhook = 'Webhook',
    MicrosoftTeams = 'MicrosoftTeams',
}

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public webHookName? : string = undefined;

    @Column()
    public project?: Project;

    @Column()
    public createdByUser?: User;

    @Column()
    public integrationType?: IntegrationType;

    @Column()
    public data?: Object;

    @Column()
    public incidentCreatedNotification?: boolean = undefined;

    @Column()
    public incidentAcknowledgedNotification?: boolean = undefined;

    @Column()
    public incidentResolvedNotification?: boolean = undefined;

    @Column()
    public incidentNoteAddedNotification?: boolean = undefined;

    @Column()
    public deletedByUser?: User;
}
