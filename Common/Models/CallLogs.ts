import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import OperationStatus from '../Types/OperationStatus';

@Entity({
   name: "CallLog"
})
export default class CallLog extends BaseModel {

   @Column()
   fromNumber!: string;

   @Column()
   toNumber!: string;

   @Column()
   project!: Project;

   @Column()
   deletedByUser!: User;

   @Column()
   content!: string;

   @Column()
   status!: OperationStatus;

   @Column()
   errorDescription!: string;
}









