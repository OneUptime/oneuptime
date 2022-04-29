import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import ContainerSecurity from './ContainerSecurity';
import Component from './Component';

@Entity({
       name: "ContainerSecurityLog"
})
export default class ContainerSecurityLog extends BaseModel {

       @Column()
       security!: ContainerSecurity

       @Column()
       component!: Component

       @Column()
       data!: Object;

       @Column()
       deleteAt!: Date;

}









