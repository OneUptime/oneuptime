import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import Incident from './Incident';
@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   incident: Incident

   @Column()
   user!: User; // Which User will perfom this action.

   @Column()
   number!: string;

   @Column()
   name!: string;


   @Column()
   resolved!: boolean;

   @Column()
   acknowledged!: boolean;


   @Column()
   deletedByUser!: User;
}








