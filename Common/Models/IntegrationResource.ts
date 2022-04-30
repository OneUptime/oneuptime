import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import Monitor from './Monitor';
import Integration from './Integration';

@Entity({
    name: 'StatusPageChartType',
})
export default class StatusPageChartType extends BaseModel {
    @Column()
    integration!: Integration;

    @Column()
    monitor!: Monitor;
}
