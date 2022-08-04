import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import PerformanceTracker from './PerformanceTracker';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public type?: string = undefined;

    @Column()
    public metrics?: Object;

    @Column()
    public callentifier?: string = undefined;

    @Column()
    public method?: string = undefined;

    @Column()
    public performanceTracker?: PerformanceTracker;
}
