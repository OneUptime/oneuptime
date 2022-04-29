import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import StatusPage from './StatusPage';
import StatusPageCategory from './StatusPageCategory';
import Monitor from './Monitor';
import Incident from './Incident';

@Entity({
    name: 'IncidentResource',
})
export default class IncidentResource extends BaseModel {
    @Column()
    incident!: Incident;

    @Column()
    monitor!: Monitor;
}
