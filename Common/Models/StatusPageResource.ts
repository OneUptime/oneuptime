import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import StatusPage from './StatusPage';
import StatusPageCategory from './StatusPageCategory';
import Monitor from './Monitor';

@Entity({
    name: 'StatusPageChartType',
})
export default class StatusPageChartType extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
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
