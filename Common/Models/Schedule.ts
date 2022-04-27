import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    name!: string;
 
 @Column()
    slug!: string;
 
 @Column()
    project!: Project; //Which project this schedule belongs to.
 
 @Column()
    createdByUser!: User;
 
 @Column()
    monitorIds!: [
        {
 
 @Column()
            type!: Schema.Types.ObjectId;
 
 @Column()
            ref!: 'Monitor';
 
 @Column()
            default!: [];
 
 @Column()
            alias!: 'monitors';
        };
    ];
 
 @Column()
    escalationIds!: [
        {
 
 @Column()
            type!: string;
 
 @Column()
            ref!: 'Escalation';
 
 @Column()
            default!: [];
 
 @Column()
            alias!: 'escalations';
 
 @Column()
            index!: true;
        };
    ];
 
 @Column()
    createdAt: { type: Date; default!: Date.now }



 
 @Column()
    deletedByUser!: User;
 
 @Column()
    isDefault!: boolean;
}









