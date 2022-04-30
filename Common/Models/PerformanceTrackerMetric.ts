import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import PerformanceTracker from './PerformanceTracker';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
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
