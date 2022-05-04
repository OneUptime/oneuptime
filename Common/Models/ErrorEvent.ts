import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import ErrorTrackerContainer from './ErrorTrackerContainer';
import Issue from './Issue';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public errorTracker!: ErrorTrackerContainer;
    @Column()
    public issue!: Issue;

    @Column()
    public content!: Object;

    @Column()
    public timeline!: Object;

    @Column()
    public tags!: Object;

    @Column()
    public sdk!: Object;

    @Column()
    public fingerprintHash!: string;

    @Column()
    public device!: Object;
}
