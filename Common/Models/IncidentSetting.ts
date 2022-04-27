import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import IncidentPriority from './IncidentPriority';

@Entity({
   name: "IncidentSetting"
})
export default class IncidentSetting extends BaseModel {

   @Column()
   project!: Project;

   @Column()
   title!: string

   @Column()
   description!: string

   @Column()
   incidentPriority!: IncidentPriority

   @Column()
   isDefault!: boolean;

   @Column()
   name!: string

   @Column()
   deletedByUser!: User;
}








