import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import Monitor from './Monitor';
import OnCallDutySchedule from './OnCallDutySchedule';

@Entity({
    name: 'OnCallDutyScheduleResource',
})
export default class OnCallDutyScheduleResource extends BaseModel {
    @Column()
    public onCallDutySchedule?: OnCallDutySchedule;

    @Column()
    public monitor?: Monitor;
}
