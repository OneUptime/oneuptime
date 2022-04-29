import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    applicationLog!: {
 
 @Column()
        type!: Schema.Types.Object;
 
 @Column()
        ref!: 'ApplicationLog';
 
 @Column()
        alias!: 'applicationLog';
 
 @Column()
        index!: true;
    }; //Which application log this content log belongs to.
 
 @Column()
    content!: Object;
 
 @Column()
    stringifiedContent!: string;
 
 @Column()
    type!: {
 
 @Column()
        type!: string;
 
 @Column()
        enum!: ['info', 'warning', 'error'];
 
 @Column()
        required!: true;
    };
 
 @Column()
    tags!: [
        {
 
 @Column()
            type!: string;
        };
    ];
 
 @Column()
    createdByUser!: User; 
    



 
 @Column()
    deletedByUser!: User;
}

schema.virtual('applicationLog'; {
 
 @Column()
    localField!: '_id';
 
 @Column()
    foreignField!: 'applicationLog';
 
 @Column()
    ref!: 'ApplicationLog';
 
 @Column()
    justOne!: true;
}








