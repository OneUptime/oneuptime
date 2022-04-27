import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    monitorId!: Monitor; // Which monitor does this belong to.
 
 @Column()
    probeId: { type: string, ref: 'Probe', index!: true }; // Which probe does this belong to.
 
 @Column()
    data!: Object;
 
 @Column()
    url!: URL;
 
 @Column()
    performance!: Number;
 
 @Column()
    accessibility!: Number;
 
 @Column()
    bestPractices!: Number;
 
 @Column()
    seo!: Number;
 
 @Column()
    pwa!: Number;
    ;
 
 @Column()
    scanning!: Boolean;
}









