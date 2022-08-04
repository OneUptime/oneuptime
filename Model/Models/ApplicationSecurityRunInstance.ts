import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import Component from './Component';
import ApplicationSecurity from './ApplicationSecurity';

@Entity({
    name: 'ApplicationSecurityRunInstance',
})
export default class ApplicationSecurityRunInstance extends BaseModel {
    @Column()
    public security?: ApplicationSecurity;

    @Column()
    public component?: Component;
}
