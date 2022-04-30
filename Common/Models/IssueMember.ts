import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import Issue from './Issue';


@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   issue!: Issue

   @Column()
   user!: User

   @Column()
   createdByUser!: User;

   @Column()
   removed!: boolean; 

   @Column()
   removedAt!: Date

   @Column()
   removedBy!: User;
}


