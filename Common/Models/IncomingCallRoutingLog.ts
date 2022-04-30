import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import IncomingCallRouting from './IncomingCallRouting';
import OnCallDutySchedule from './OnCallDutySchedule';
import OperationStatus from '../Types/Operation/OperationStatus';
@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   project!: Project;

   @Column()
   callRouting!: IncomingCallRouting;

   @Column()
   deletedByUser!: User;

   @Column()
   callSid!: string;

   @Column()
   price!: string;

   @Column()
   calledFrom!: string;

   @Column()
   calledTo!: string;

   @Column()
   duration!: string;

   @Column()
   user!: User; // User that call was forwarded to

   @Column()
   schedule!: OnCallDutySchedule

   @Column()
   phoneNumber!: string; // Phone number that call was forwarded to

   @Column()
   status!: OperationStatus

}








