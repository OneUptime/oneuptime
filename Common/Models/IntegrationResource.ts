import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Monitor from './Monitor';
import Integration from './Integration';

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
    public integration!: Integration;

    @Column()
    public monitor!: Monitor;
}
