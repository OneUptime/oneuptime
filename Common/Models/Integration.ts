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
    public webHookName!: string;

    @Column()
    public project!: Project;

    @Column()
    public createdByUser!: User;

    @Column()
    public integrationType!: IntegrationType;

    @Column()
    public data!: Object;

    @Column()
    public incidentCreatedNotification!: boolean;

    @Column()
    public incidentAcknowledgedNotification!: boolean;

    @Column()
    public incidentResolvedNotification!: boolean;

    @Column()
    public incidentNoteAddedNotification!: boolean;

    @Column()
    public deletedByUser!: User;
}
