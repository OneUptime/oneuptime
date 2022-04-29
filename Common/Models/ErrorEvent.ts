import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import ErrorTrackerContainer from './ErrorTrackerContainer';
import Issue from './Issue';
@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   errorTracker!: ErrorTrackerContainer
   @Column()
   issue!: Issue

   @Column()
   content!: Object;

   @Column()
   timeline!: Object

   @Column()
   tags!: Object

   @Column()
   sdk!: Object;

   @Column()
   fingerprintHash!: string;

   @Column()
   device!: Object;
}










