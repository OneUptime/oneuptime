import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';


@Entity({
   name: "ProjectSmtpConfig"
})
export default class SMTP extends BaseModel {

   @Column({
      nullable: false
   })
   @Index()
   project!: Project;

   @Column({
      nullable: false
   })
   useranme!: string;

   @Column({
      nullable: false
   })
   password!: string;

   @Column({
      nullable: false
   })
   host!: string;

   @Column({
      nullable: false
   })
   port!: number;

   @Column({
      nullable: false
   })
   fromEmail!: string;

   @Column({
      nullable: false
   })
   fromName!: string;

   @Column({
      nullable: false
   })
   iv!: Buffer;

   @Column({
      nullable: false,
      default: true
   })
   secure!: boolean;

   @Column({
      nullable: false,
      default: true
   })
   enabled!: boolean;

   @Column()
   deletedByUser!: User;
}



