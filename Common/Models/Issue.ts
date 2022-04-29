import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import ErrorTrackerContainer from './ErrorTrackerContainer';

export enum IssueType {
   Exception = "Exception",
   Message = "Message",
   Error = "Error"
}

@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   name!: string;

   @Column()
   description!: string;

   @Column()
   errorTracker!: ErrorTrackerContainer

   @Column()
   type!: IssueType

   @Column()
   fingerprintHash!: string;

   @Column()
   deletedByUser!: User;

   @Column()
   resolved!: boolean;

   @Column()
   resolvedAt!: Date

   @Column()
   resolvedBy!: User;

   @Column()
   ignored!: boolean;

   @Column()
   ignoredAt!: Date

   @Column()
   ignoredBy!: User;
}









