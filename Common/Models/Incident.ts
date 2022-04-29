import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import IncomingRequest from './IncomingRequest';
import IncidentCustomFields from '../Types/Incident/IncidentCustomFields';
import ResourceStatus from './ResourceStatus';
import IncidentPriority from './IncidentPriority';

export enum IncidentState {
   Identified = "Identified",
   Acknowledged = "Acknowledged",
   Resolved = "Resolved"
}

@Entity({
   name: "Incident"
})
export default class Incident extends BaseModel {

   @Column()
   idNumber!: number

   @Column()
   project!: Project; 

   @Column()
   title!: string

   @Column()
   description!: string

   @Column()
   reason!: string

   @Column()
   response!: Object;

   @Column()
   notifications!: Notification

   @Column()
   incidentPriority!: IncidentPriority

   @Column()
   acknowledged!: boolean;

   @Column()
   acknowledgedBy!: User; 

   @Column()
   acknowledgedAt!: Date

   @Column()
   acknowledgedByZapier!: boolean; 

   @Column()
   resolved!: boolean;

   @Column()
   resourceStatus!: ResourceStatus

   @Column()
   resolvedBy!: User; 

   @Column()
   resolvedAt!: Date;

   @Column()
   resolvedByZapier!: boolean; 


   @Column()
   internalNote!: string;

   @Column()
   investigationNote!: string;

   @Column()
   createdByUser!: User; 

   @Column()
   createdByApi!: boolean;


   @Column()
   createdByZapier!: boolean; 

   @Column()
   acknowledgedByApi!: boolean;

   @Column()
   resolvedByApi!: boolean;

   @Column()
   manuallyCreated!: boolean;

   @Column()
   criterionCause!: Object;


   @Column()
   deletedByUser!: User;

   @Column()
   breachedCommunicationSla!: boolean;

   @Column()
   customFields!: IncidentCustomFields

   @Column()
   acknowledgedByIncomingHttpRequest!: IncomingRequest;

   @Column()
   resolvedByIncomingHttpRequest!: IncomingRequest;

   @Column()
   createdByIncomingHttpRequest!: IncomingRequest;

   @Column()
   hideIncident!: boolean;


   @Column()
   slug!: string;
}









