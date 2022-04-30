import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import PerformanceTracker from './PerformanceTracker';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public type!: string;

    @Column()
    public metrics!: Object;

    @Column()
    public callentifier!: string;

    @Column()
    public method!: string;

    @Column()
    public performanceTracker!: PerformanceTracker;
}
