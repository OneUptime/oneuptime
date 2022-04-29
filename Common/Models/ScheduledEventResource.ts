

import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import Monitor from './Monitor';
import ScheduledEvent from './ScheduledEvent';

@Entity({
    name: "StatusPageChartType"
})
export default class StatusPageChartType extends BaseModel {

    @Column()
    scheduledEvent!: ScheduledEvent

    @Column()
    monitor!: Monitor;

}








