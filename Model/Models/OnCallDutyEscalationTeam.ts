import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import OnCallDutyEscalation from './OnCallDutyEscalation';
import Team from './Team';

/*
 * Resource Status like Online, Degraded, Offline.
 * Customers have requested for custom status and we'll give them those.
 */
@Entity({
    name: 'ResourceStatus',
})
export default class ResourceStatus extends BaseModel {
    @Column()
    public onCallDutyEscalation?: OnCallDutyEscalation;

    @Column()
    public team?: Team;
}
