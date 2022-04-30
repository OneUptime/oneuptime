import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import StatusPage from './StatusPage';
import Monitor from './Monitor';
import AlertType from '../Types/Alerts/AlertType';
import HTTPMethod from '../Types/API/HTTPMethod';


@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   monitor!: Monitor;

   @Column()
   project!: Project;

   @Column()
   statusPage!: StatusPage

   @Column()
   alertType!: AlertType

   @Column()
   contactEmail!: string;

   @Column()
   contactPhone!: string;

   @Column()
   countryCode!: string;

   @Column()
   contactWebhook!: string;

   @Column()
   webhookMethod!: HTTPMethod


   @Column()
   incidentNotification!: boolean;

   @Column()
   announcementNotification!: boolean;

   @Column()
   scheduledEventNotification!: boolean;


   @Column()
   subscribed!: boolean;

   @Column()
   deletedByUser!: User;
}









