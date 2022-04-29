import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    errorTracker!: {
 
 @Column()
        type!: Schema.Types.Object;
 
 @Column()
        ref!: 'ErrorTracker';
 
 @Column()
        alias!: 'errorTracker';
 
 @Column()
        index!: true;
    }; //Which error tracker this error event belongs to.
 
 @Column()
    issue!: {
 
 @Column()
        type!: Schema.Types.Object;
 
 @Column()
        ref!: 'Issue';
 
 @Column()
        alias!: 'issue';
 
 @Column()
        index!: true;
    }; //Which issue this error event belongs to.
 
 @Column()
    content!: Object;
 
 @Column()
    type!: {
 
 @Column()
        type!: string;
 
 @Column()
        enum!: ['exception', 'message', 'error'];
 
 @Column()
        required!: true;
    };
 
 @Column()
    timeline!: [
        {
 
 @Column()
            type!: Object;
        };
    ];
 
 @Column()
    tags!: [
        {
 
 @Column()
            type!: Object;
        };
    ];
 
 @Column()
    sdk!: Object;
 
 @Column()
    fingerprint!: [
        {
 
 @Column()
            type!: string;
        };
    ];
 
 @Column()
    fingerprintHash!: string;
 
 @Column()
    device!: Object;
    ;
}

schema.virtual('errorTracker'; {
 
 @Column()
    localField!: '_id';
 
 @Column()
    foreignField!: 'errorTracker';
 
 @Column()
    ref!: 'ErrorTracker';
 
 @Column()
    justOne!: true;
}








