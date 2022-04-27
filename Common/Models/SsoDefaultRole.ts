import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import Role from '../Types/Role';

@Entity({
       name: "SsoDefaultRole"
})
export default class SsoDefaultRole extends BaseModel {

       @Column()
       domain!: string

       @Column()
       project!: Project

       @Column()
       role!: Role

       @Column()
       deletedByUser!: User
}








