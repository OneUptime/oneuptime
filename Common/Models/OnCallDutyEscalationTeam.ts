import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
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
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public onCallDutyEscalation!: OnCallDutyEscalation;

    @Column()
    public team!: Team;
}
