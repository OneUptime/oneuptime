import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
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
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public idNumber!: number;

    @Column()
    public project!: Project;

    @Column()
    public title!: string;

    @Column()
    public description!: string;

    @Column()
    public reason!: string;

    @Column()
    public response!: Object;

    @Column()
    public notifications!: Notification;

    @Column()
    public incidentPriority!: IncidentPriority;

    @Column()
    public acknowledged!: boolean;

    @Column()
    public acknowledgedBy!: User;

    @Column()
    public acknowledgedAt!: Date;

    @Column()
    public acknowledgedByZapier!: boolean;

    @Column()
    public resolved!: boolean;

    @Column()
    public resourceStatus!: ResourceStatus;

    @Column()
    public resolvedBy!: User;

    @Column()
    public resolvedAt!: Date;

    @Column()
    public resolvedByZapier!: boolean;

    @Column()
    public internalNote!: string;

    @Column()
    public investigationNote!: string;

    @Column()
    public createdByUser!: User;

    @Column()
    public createdByApi!: boolean;

    @Column()
    public createdByZapier!: boolean;

    @Column()
    public acknowledgedByApi!: boolean;

    @Column()
    public resolvedByApi!: boolean;

    @Column()
    public manuallyCreated!: boolean;

    @Column()
    public criterionCause!: Object;

    @Column()
    public deletedByUser!: User;

    @Column()
    public breachedCommunicationSla!: boolean;

    @Column()
    public customFields!: IncidentCustomFields;

    @Column()
    public acknowledgedByIncomingHttpRequest!: IncomingRequest;

    @Column()
    public resolvedByIncomingHttpRequest!: IncomingRequest;

    @Column()
    public createdByIncomingHttpRequest!: IncomingRequest;

    @Column()
    public hideIncident!: boolean;

    @Column()
    public slug!: string;
}
