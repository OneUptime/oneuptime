import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
import IncomingRequest from './IncomingRequest';
import IncidentCustomFields from '../Types/Incident/IncidentCustomFields';
import ResourceStatus from './ResourceStatus';
import IncidentPriority from './IncidentPriority';

export enum IncidentState {
    Identified = 'Identified',
    Acknowledged = 'Acknowledged',
    Resolved = 'Resolved',
}

@Entity({
    name: 'Incident',
})
export default class Incident extends BaseModel {
    @Column()
    public idNumber?: number;

    @Column()
    public project?: Project;

    @Column()
    public title?: string = undefined;

    @Column()
    public description?: string = undefined;

    @Column()
    public reason?: string = undefined;

    @Column()
    public response?: Object;

    @Column()
    public notifications?: Notification;

    @Column()
    public incidentPriority?: IncidentPriority;

    @Column()
    public acknowledged?: boolean = undefined;

    @Column()
    public acknowledgedBy?: User;

    @Column()
    public acknowledgedAt?: Date = undefined;

    @Column()
    public acknowledgedByZapier?: boolean = undefined;

    @Column()
    public resolved?: boolean = undefined;

    @Column()
    public resourceStatus?: ResourceStatus;

    @Column()
    public resolvedBy?: User;

    @Column()
    public resolvedAt?: Date = undefined;

    @Column()
    public resolvedByZapier?: boolean = undefined;

    @Column()
    public internalNote?: string = undefined;

    @Column()
    public investigationNote?: string = undefined;

    @Column()
    public createdByUser?: User;

    @Column()
    public createdByApi?: boolean = undefined;

    @Column()
    public createdByZapier?: boolean = undefined;

    @Column()
    public acknowledgedByApi?: boolean = undefined;

    @Column()
    public resolvedByApi?: boolean = undefined;

    @Column()
    public manuallyCreated?: boolean = undefined;

    @Column()
    public criterionCause?: Object;

    @Column()
    public deletedByUser?: User;

    @Column()
    public breachedCommunicationSla?: boolean = undefined;

    @Column()
    public customFields?: IncidentCustomFields;

    @Column()
    public acknowledgedByIncomingHttpRequest?: IncomingRequest;

    @Column()
    public resolvedByIncomingHttpRequest?: IncomingRequest;

    @Column()
    public createdByIncomingHttpRequest?: IncomingRequest;

    @Column()
    public hideIncident?: boolean = undefined;

    @Column()
    public slug?: string = undefined;
}
