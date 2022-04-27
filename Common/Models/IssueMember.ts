import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    issueId!: {
 
 @Column()
        type!: Schema.Types.ObjectId;
 
 @Column()
        ref!: 'Issue';
 
 @Column()
        alias!: 'issue';
 
 @Column()
        index!: true;
    }; // Which issue does this belongs to.
 
 @Column()
    user!: {
 
 @Column()
        type!: Schema.Types.ObjectId;
 
 @Column()
        ref!: 'User';
 
 @Column()
        alias!: 'user';
 
 @Column()
        index!: true;
    }; // Which team member is this.
    ;
 
 @Column()
    createdByUser!: User;
 
 @Column()
    removed!: boolean; // This removed is the flag to be used to know if the member has been unassigned from the issue

 
 @Column()
    removedAt!: {
 
 @Column()
        type!: Date;
    };
 
 @Column()
    removedById!: User;
}
schema.virtual('issue'; {
 
 @Column()
    localField!: '_id';
 
 @Column()
    foreignField!: 'issueId';
 
 @Column()
    ref!: 'Issue';
 
 @Column()
    justOne!: true;
}








