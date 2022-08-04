import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import Monitor from './Monitor';
import Incident from './Incident';

@Entity({
    name: 'IncidentResource',
})
export default class IncidentResource extends BaseModel {
    @Column()
    public incident?: Incident;

    @Column()
    public monitor?: Monitor;
}
