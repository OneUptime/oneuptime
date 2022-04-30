import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import ApplicationLogContainer from './ApplicationLogContainer';
import ApplicationLogType from '../Types/ApplicationLog/ApplicationLogType';
import Tags from '../Types/Tags';
@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   applicationLogContainer!: ApplicationLogContainer

   @Column()
   content!: string;


   @Column()
   type!: ApplicationLogType

   @Column()
   tags!: Tags

   @Column()
   createdByUser!: User;

   @Column()
   deletedByUser!: User;
}









