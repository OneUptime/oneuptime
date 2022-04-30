import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Monitor from './Monitor';
import Incident from './Incident';

@Entity({
    name: 'IncidentResource',
})
export default class IncidentResource extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public incident!: Incident;

    @Column()
    public monitor!: Monitor;
}
