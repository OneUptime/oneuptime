import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
        scheduledEventId!: {
 
 @Column()
            type!: Schema.Types.ObjectId;
 
 @Column()
            ref!: 'ScheduledEvent';
 
 @Column()
            index!: true;
        };
 
 @Column()
        content!: string;
 
 @Column()
        type!: {
 
 @Column()
            type!: string;
 
 @Column()
            enum!: ['investigation', 'internal'];
 
 @Column()
            required!: true;
        };
 
 @Column()
        event_state!: string;
 
 @Column()
        createdByUser: User;
 
 @Column()
        updated!: boolean;
        
 

 
 @Column()
        deletedByUser: User;
    };
 

}








