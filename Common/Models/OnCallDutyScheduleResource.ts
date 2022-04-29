

import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import StatusPage from './StatusPage';
import StatusPageCategory from './StatusPageCategory';
import Monitor from './Monitor';
import OnCallDutySchedule from './OnCallDutySchedule';

@Entity({
    name: "OnCallDutyScheduleResource"
})
export default class OnCallDutyScheduleResource extends BaseModel {

    @Column()
    onCallDutySchedule!: OnCallDutySchedule

    @Column()
    monitor!: Monitor;

}








