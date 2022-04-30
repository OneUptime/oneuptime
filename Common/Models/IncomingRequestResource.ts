import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import StatusPage from './StatusPage';
import StatusPageCategory from './StatusPageCategory';
import Monitor from './Monitor';
import IncomingRequest from './IncomingRequest';

@Entity({
    name: 'StatusPageChartType',
})
export default class StatusPageChartType extends BaseModel {
    @Column()
    incomingRequest!: IncomingRequest;

    @Column()
    monitor!: Monitor;
}
