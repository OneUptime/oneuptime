import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Project from './Project';
import { IncidentState } from './Incident';
@Entity({
    name: 'IncidentNoteTemplate',
})
export default class IncidentNoteTemplate extends BaseModel {
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
    public incidentState!: IncidentState;

    @Column()
    public incidentNote!: string;
}
