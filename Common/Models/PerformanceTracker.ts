import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import Component from './Component';

@Entity({
       name: "UserAlerts"
})
export default class Model extends BaseModel {

       @Column()
       component!: Component

       @Column()
       name!: string;

       @Column()
       slug!: string;

       @Column()
       key!: string;

       @Column()
       showQuickStart!: boolean;

       @Column()
       createdByUser!: User;

       @Column()
       deletedByUser!: User;
}








