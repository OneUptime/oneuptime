import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Monitor from './Monitor';
import OnCallDutySchedule from './OnCallDutySchedule';

@Entity({
    name: 'OnCallDutyScheduleResource',
})
export default class OnCallDutyScheduleResource extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public onCallDutySchedule!: OnCallDutySchedule;

    @Column()
    public monitor!: Monitor;
}
