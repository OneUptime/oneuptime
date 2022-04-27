import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';


@Entity({
   name: "Lead"
})
export default class Lead extends BaseModel {
 
   @Column()
   name!: string;
 
   @Column()
   email!: string;
 
   @Column()
   website!: string;
 
   @Column()
   phone!: string;
 
   @Column()
   nameOfInterestedResource!: string;
 
   @Column()
   country!: string;
 
   @Column()
   companySize!: string;
 
   @Column()
   message!: string;

   @Column()
   source!: string;

}