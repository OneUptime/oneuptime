import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Monitor from './Monitor';
import IncomingRequest from './IncomingRequest';

@Entity({
    name: 'StatusPageChartType',
})
export default class StatusPageChartType extends BaseModel {
    @Column()
    public incomingRequest?: IncomingRequest;

    @Column()
    public monitor?: Monitor;
}
