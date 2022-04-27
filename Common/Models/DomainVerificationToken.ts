import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import Project from './Project';

@Entity({
   name: "DomainVerificationToken"
})
export default class Model extends BaseModel {

   @Index()
   @Column()
   domain!: string; // The main or base domain eg oneuptime.com

   @Column()
   verificationToken!: string;

   @Column()
   verified!: boolean;

   @Column()
   verifiedAt!: Date;

   @Column()
   project!: Project

}









