import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import PerformanceTracker from './PerformanceTracker';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    type!: string;

    @Column()
    metrics!: Object;

    @Column()
    callentifier!: string;

    @Column()
    method!: string;

    @Column()
    performanceTracker!: PerformanceTracker;
}
