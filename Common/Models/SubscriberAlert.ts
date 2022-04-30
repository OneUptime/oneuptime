import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import Subscriber from './Subscriber';
import Incident from './Incident';
import AlertType from '../Types/Alerts/AlertType';
import OperationResult from '../Types/Operation/OperationResult';


@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   project!: Project;

   @Column()
   subscriber!: Subscriber;

   @Column()
   incident!: Incident;

   @Column()
   alertVia!: AlertType

   @Column()
   status!: OperationResult;

   @Column()
   eventType!: AlertEventType

   @Column()
   errorMessage!: string

   @Column()
   deletedByUser!: User;

}









