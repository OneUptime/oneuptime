import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import StatusPage from './StatusPage';
import StatusPageCategory from './StatusPageCategory';
import Monitor from './Monitor';

@Entity({
    name: 'StatusPageChartType',
})
export default class StatusPageChartType extends BaseModel {
    @Column()
    public statusPage!: StatusPage;

    @Column()
    public monitor!: Monitor;

    @Column()
    public statusPageCategory!: StatusPageCategory;

    @Column()
    public resourceDescription!: string;

    @Column()
    public chartTypes!: Array<StatusPageChartType>;
}
