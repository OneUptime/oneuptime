import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import Incident from './Incident';
import SubscriberAlert from './SubscriberAlert';
import Monitor from './Monitor';
import Alert from './Alert';
import Project from './Project';

@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   project!: Project;

   @Column()
   chargeAmount!: number;

   @Column()
   closingAccountBalance!: number;

   @Column()
   alertId!: Alert;

   @Column()
   subscriberAlertId!: SubscriberAlert;

   @Column()
   monitorId!: Monitor;

   @Column()
   incidentId!: Incident

   @Column()
   sentTo!: string;
}








