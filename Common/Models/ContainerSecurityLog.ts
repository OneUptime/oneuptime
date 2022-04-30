import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import ContainerSecurity from './ContainerSecurity';
import Component from './Component';

@Entity({
    name: 'ContainerSecurityLog',
})
export default class ContainerSecurityLog extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public security!: ContainerSecurity;

    @Column()
    public component!: Component;

    @Column()
    public data!: Object;

    @Column()
    public deleteAt!: Date;
}
