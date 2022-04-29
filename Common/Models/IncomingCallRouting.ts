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
   capabilities!: {
 
 @Column()
   MMS!: boolean;

   @Column()
   SMS!: boolean;

   @Column()
   voice!: boolean;
};

@Column()
routingSchema!: {

   @Column()
      type!: Object;

   @Column()
} /*RoutingSchema!: {
 
 @Column()
        type!: ‘team-member’ || ‘schedule’
 
 @Column()
        id!: 'schedule' || 'teamMember'
 
 @Column()
        introtext!: 'string';
 
 @Column()
        introAudio!: 'tone mongo storage name';
 
 @Column()
        introAudioName!: 'original audio name';

   } */;

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








