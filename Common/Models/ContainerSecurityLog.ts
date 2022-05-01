import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import ContainerSecurity from './ContainerSecurity';
import Component from './Component';

@Entity({
    name: 'ContainerSecurityLog',
})
export default class ContainerSecurityLog extends BaseModel {
    
    @Column()
    public security!: ContainerSecurity;

    @Column()
    public component!: Component;

    @Column()
    public data!: Object;

    @Column()
    public deleteAt!: Date;
}
