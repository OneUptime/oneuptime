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
    public name!: string;

    @Column()
    public project!: Project;

    @Column()
    public isDefault!: boolean;

    @Column()
    public selectAllMonitors!: boolean;

    @Column()
    public createIncident!: boolean;

    @Column()
    public acknowledgeIncident!: boolean;

    @Column()
    public resolveIncident!: boolean;

    @Column()
    public updateIncidentNote!: boolean;

    @Column()
    public updateInternalNote!: boolean;

    @Column()
    public noteContent!: string;

    @Column()
    public incidentState!: string;

    @Column()
    public url!: URL;

    @Column()
    public enabled!: boolean;

    @Column()
    public incidentTitle!: string;

    @Column()
    public incidentType!: string;

    @Column()
    public incidentPriority!: IncidentPriority;

    @Column()
    public incidentDescription!: string;

    @Column()
    public customFields!: IncomingRequestCustomFields;

    @Column()
    public createSeparateIncident!: boolean;

    @Column()
    public postOnsStatusPage!: boolean;

    @Column()
    public filter!: Filter;
}
