import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import Project from './Project';
import { IncidentState } from './Incident';
@Entity({
    name: 'IncidentNoteTemplate',
})
export default class IncidentNoteTemplate extends BaseModel {
    @Column()
    project!: Project;

    @Column()
    incidentState!: IncidentState;

    @Column()
    incidentNote!: string;
}
