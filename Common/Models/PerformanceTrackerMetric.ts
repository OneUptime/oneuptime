import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    type!: string;
 
 @Column()
    metrics!: Object;
 
 @Column()
    callIdentifier!: string;
 
 @Column()
    method!: string;
 
 @Column()
    performanceTrackerId!: {
 
 @Column()
        type!: Schema.Types.ObjectId;
 
 @Column()
        ref!: 'PerformanceTracker';
 
 @Column()
        index!: true;
    }

 
 @Column()
    createdAt!: Date;
 
 @Column()
    updatedAt!: Date;
}









