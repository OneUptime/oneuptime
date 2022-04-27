import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Incident, { IncidentState } from './Incident';

export enum IncidentMessageType{
   Investogation = "Investigation", 
   Internam = "Internal"
}

@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {
 
   @Column()
   incident!: Incident
 
   @Column()
   content!: string;
 
   @Column()
   type!: IncidentMessageType
 
   @Column()
   incidentState!: IncidentState;
 
   @Column()
   createdByUser!: User;
 
   @Column()
   deletedByUser!: User;
 
   @Column()
   postOnStatusPage!: boolean;
}







