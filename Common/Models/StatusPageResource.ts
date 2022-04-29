

import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import StatusPage from './StatusPage';
import StatusPageCategory from './StatusPageCategory';
import Monitor from './Monitor';

@Entity({
    name: "StatusPageChartType"
})
export default class StatusPageChartType extends BaseModel {

    @Column()
    statusPage!: StatusPage

    @Column()
    monitor!: Monitor;

    @Column()
    statusPageCategory!: StatusPageCategory

    @Column()
    resourceDescription!: string;

    @Column()
    chartTypes!: Array<StatusPageChartType>

}








