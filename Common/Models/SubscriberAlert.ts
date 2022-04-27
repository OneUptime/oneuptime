import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    project!: Project;
 
 @Column()
    subscriberId: { type: string, ref: 'Subscriber', index!: true };
 
 @Column()
    incidentId: { type: string, ref: 'Incident', index!: true };
 
 @Column()
    alertVia!: {
 
 @Column()
        type!: string;
 
 @Column()
        enum!: ['sms', 'email', 'webhook'];
 
 @Column()
        required!: true;
    };
 
 @Column()
    alertStatus!: string;
 
 @Column()
    eventType!: {
 
 @Column()
        type!: string;
 
 @Column()
        enum!: [
            'identified';
            'acknowledged';
            'resolved';
            'Investigation note created';
            'Investigation note updated';
            'Scheduled maintenance created';
            'Scheduled maintenance note created';
            'Scheduled maintenance resolved';
            'Scheduled maintenance cancelled';
            'Announcement notification created';
        ];
 
 @Column()
        required!: true;
    };
 

 
 @Column()
    error!: boolean;
 
 @Column()
    errorMessage!: string



 
 @Column()
    deletedByUser: { type: string, ref!: 'User' };
 
 @Column()
    totalSubscribers: { type!: Number };
 
 @Column()
    identification: { type!: Number };
}









