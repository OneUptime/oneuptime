import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

export enum IntegrationType {
   Slack = "Slack",
   Webhook = "Webhook",
   MicrosoftTeams = "MicrosoftTeams"
}

@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   webHookName!: string;

   @Column()
   project!: Project;

   @Column()
   createdByUser!: User;

   @Column()
   integrationType!: IntegrationType

   @Column()
   data!: Object


   @Column()
   incidentCreatedNotification!: boolean;

   @Column()
   incidentAcknowledgedNotification!: boolean;

   @Column()
   incidentResolvedNotification!: boolean;

   @Column()
   incidentNoteAddedNotification!: boolean;

   @Column()
   deletedByUser!: User;
}








