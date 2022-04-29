import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
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
    onCallDutyEscalation!: OnCallDutyEscalation;

    @Column()
    team!: Team;
}
