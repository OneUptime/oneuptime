import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import Component from './Component';
import ApplicationSecurity from './ApplicationSecurity';


@Entity({
       name: "ApplicationSecurityRunInstance"
})
export default class ApplicationSecurityRunInstance extends BaseModel {

       @Column()
       security!: ApplicationSecurity

       @Column()
       component!: Component
}









