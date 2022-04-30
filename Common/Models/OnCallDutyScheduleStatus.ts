import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import Incident from './Incident';
import OnCallDutySchedule from './OnCallDutySchedule';


@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {


   @Column()
   project!: Project;

   @Column()
   onCallDutySchedule!: OnCallDutySchedule;

   @Column()
   incident!: Incident

   @Column()
   incidentAcknowledged!: boolean;


   @Column()
   deletedByUser!: User;

   @Column()
   isOnDuty!: boolean;


   @Column()
   alertedEveryone!: boolean;
}








