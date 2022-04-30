import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   project!: Project;

   @Column()
   deletedByUser!: User;

   @Column()
   phoneNumber!: string;

   @Column()
   locality!: string;

   @Column()
   region!: string;

   @Column()
   mmsCapabilities!: boolean;

   @Column()
   smsCapabilities!: boolean;

   @Column()
   voiceCapabilities!: boolean;



   @Column()
   sid!: string;

   @Column()
   price!: string;

   @Column()
   priceUnit!: string;

   @Column()
   countryCode!: string;

   @Column()
   numberType!: string;

   @Column()
   stripeSubscriptionId!: string;
}








