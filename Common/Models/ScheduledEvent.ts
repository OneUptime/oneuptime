import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
        project!: {
 
 @Column()
            type!: string;
 
 @Column()
            ref!: 'Project';
 
 @Column()
            alias!: 'project';
 
 @Column()
            index!: true;
        };
 
 @Column()
        monitors!: [
            {
 
 @Column()
                monitorId!: {
 
 @Column()
                    type!: Schema.Types.ObjectId;
 
 @Column()
                    ref!: 'Monitor';
 
 @Column()
                    index!: true;
                };
            };
        ];
 
 @Column()
        name!: string;
 
 @Column()
        cancelled!: boolean;
 
 @Column()
        cancelledAt!: Date;

 
 @Column()
        cancelledById!: {
 
 @Column()
            type!: string;
 
 @Column()
            ref!: 'User';
 
 @Column()
            index!: true;
        };
 
 @Column()
        slug!: string;
 
 @Column()
        createdByUser!: {
 
 @Column()
            type!: string;
 
 @Column()
            ref!: 'User';
 
 @Column()
            index!: true;
        };

        
 
 
 
 @Column()
        deletedByUser!: {
 
 @Column()
            type!: string;
 
 @Column()
            ref!: 'User';
 
 @Column()
            index!: true;
        };
 
 @Column()
        startDate!: {
 
 @Column()
            type!: Date;
        };
 
 @Column()
        endDate!: {
 
 @Column()
            type!: Date;
        };
 
 @Column()
        description!: {
 
 @Column()
            type!: string;
        };
 
 @Column()
        showEventOnStatusPage!: boolean;
 
 @Column()
        callScheduleOnEvent!: boolean;
 
 @Column()
        monitorDuringEvent!: boolean;
 
 @Column()
        recurring!: boolean;
 
 @Column()
        interval!: {
 
 @Column()
            type!: string;
 
 @Column()
            default!: null;
        };
 
 @Column()
        alertSubscriber!: boolean;
 
 @Column()
        resolved!: boolean;
 
 @Column()
        resolvedBy: User;
 
 @Column()
        resolvedAt!: Date;
    };
 

}








