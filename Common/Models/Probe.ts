import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
   name: "Probe"
})
export default class Probe extends BaseModel {

   @Column({nullable: false})
   key!: string;

   @Column({nullable: false})
   name!: string;

   @Column({nullable: false})
   slug!: string;

   @Column({nullable: false})
   probeVersion!: string;

   @Column({nullable: false, default: Date.now()})
   lastAlive!: Date;

   @Column({nullable: true})
   icon!: string;

   // If this probe is custom to the project and only monitoring reosurces in this project. 
   @Column({nullable: true})
   project?: Project; 

   @Column({nullable: true})
   deletedByUser!: User;
}








