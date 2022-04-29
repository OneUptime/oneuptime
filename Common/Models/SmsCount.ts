import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';


@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   user!: User;

   @Column()
   sentTo!: string;

   @Column()
   project!: Project;

   @Column()
   content!: string;

   @Column()
   deletedByUser!: User;

   @Column()
   status!: string;

   @Column()
   error!: string;
}









