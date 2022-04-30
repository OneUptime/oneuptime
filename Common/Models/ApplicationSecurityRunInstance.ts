import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Component from './Component';
import ApplicationSecurity from './ApplicationSecurity';

@Entity({
    name: 'ApplicationSecurityRunInstance',
})
export default class ApplicationSecurityRunInstance extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public security!: ApplicationSecurity;

    @Column()
    public component!: Component;
}
