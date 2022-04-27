import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import EmailTemplateType from '../Types/Email/EmailTemplateType';


@Entity({
   name: "EmailTemplate"
})
export default class EmailTemplate extends BaseModel {

   @Column()
   project!: Project;

   @Column()
   subject!: string;

   @Column()
   body!: string;

   @Column()
   emailType!: EmailTemplateType

   @Column()
   allowedVariables!: Array<string>

   @Column()
   deletedByUser!: User;
}








