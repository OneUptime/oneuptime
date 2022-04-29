import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import Incident from './Incident';
import Probe from './Probe';
import User from './User';


@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   incident!: Incident;

   @Column()
   createdByUser!: User; // user

   @Column()
   probe!: Probe;

   @Column()
   createdByZapier!: boolean; // Is true when zapier creates incident

   @Column()
   createdByApi!: boolean;

   @Column()
   status!: string;

   @Column()
   incident_state!: string;

   @Column()
   deletedByUser!: User;
}









