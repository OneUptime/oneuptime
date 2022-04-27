import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';


@Entity({
   name: "Feedback"
})
export default class Feedback extends BaseModel {

   @Column()
   project!: Project;

   @Column()
   createdByUser!: User;

   @Column()
   message!: string;

   @Column()
   pageUrl!: string

   @Column()
   deletedByUser!: User;
}









