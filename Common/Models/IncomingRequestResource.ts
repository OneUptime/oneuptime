import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Monitor from './Monitor';
import IncomingRequest from './IncomingRequest';

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
    public incomingRequest!: IncomingRequest;

    @Column()
    public monitor!: Monitor;
}
