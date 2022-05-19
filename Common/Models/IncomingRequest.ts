import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Project from './Project';
import IncidentPriority from './IncidentPriority';
import IncomingRequestCustomFields from '../Types/IncomingRequest/IncomingRequestCustomFields';
import Filter from '../Types/Filter/Filter';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public name?: string = undefined;

    @Column()
    public project?: Project;

    @Column()
    public isDefault?: boolean = undefined;

    @Column()
    public selectAllMonitors?: boolean = undefined;

    @Column()
    public createIncident?: boolean = undefined;

    @Column()
    public acknowledgeIncident?: boolean = undefined;

    @Column()
    public resolveIncident?: boolean = undefined;

    @Column()
    public updateIncidentNote?: boolean = undefined;

    @Column()
    public updateInternalNote?: boolean = undefined;

    @Column()
    public noteContent?: string = undefined;

    @Column()
    public incidentState?: string = undefined;

    @Column()
    public url?: URL;

    @Column()
    public enabled?: boolean = undefined;

    @Column()
    public incidentTitle?: string = undefined;

    @Column()
    public incidentType?: string = undefined;

    @Column()
    public incidentPriority?: IncidentPriority;

    @Column()
    public incidentDescription?: string = undefined;

    @Column()
    public customFields?: IncomingRequestCustomFields;

    @Column()
    public createSeparateIncident?: boolean = undefined;

    @Column()
    public postOnsStatusPage?: boolean = undefined;

    @Column()
    public filter?: Filter;
}
