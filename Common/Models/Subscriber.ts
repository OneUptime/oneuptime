import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    monitorId: Monitor;
 
 @Column()
    project: Project;
 
 @Column()
    statusPageId!: {
 
 @Column()
        type!: Schema.Types.ObjectId;
 
 @Column()
        ref!: 'StatusPage';
 
 @Column()
        index!: true;
    };
 
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
    contactEmail!: string;
 
 @Column()
    contactPhone!: string;
 
 @Column()
    countryCode!: string;
 
 @Column()
    contactWebhook!: string;
 
 @Column()
    webhookMethod!: {
 
 @Column()
        type!: string;
 
 @Column()
        enum!: ['get', 'post'];
 
 @Column()
        required!: true;
    };
 
 @Column()
    notificationType!: {
 
 @Column()
        incident!: boolean;
 
 @Column()
        announcement!: boolean;
 
 @Column()
        scheduledEvent!: boolean;
    };
 
 @Column()
    createdAt: { type: Date; default!: Date.now }

 
 @Column()
    subscribed!: boolean;
 
 @Column()
    deletedByUser: User;
}









