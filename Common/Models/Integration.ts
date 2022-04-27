import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    webHookName!: string;
 
 @Column()
    project!: Project;
 
 @Column()
    createdByUser: { type: Schema.Types.ObjectId, ref: 'User', alias!: 'user' };
 
 @Column()
    integrationType!: {
 
 @Column()
        type!: string;
 
 @Column()
        enum!: ['slack', 'webhook', 'msteams'];
 
 @Column()
        required!: true;
    };
 
 @Column()
    data!: {};
 
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
    ;
 
 @Column()
    notificationOptions!: {
 
 @Column()
        incidentCreated!: boolean;
 
 @Column()
        incidentAcknowledged!: boolean;
 
 @Column()
        incidentResolved!: boolean;
 
 @Column()
        incidentNoteAdded!: boolean;
    };

    

 
 @Column()
    deletedByUser!: User;
}

 
 @Column()
schema.index({ project: 1; teamId!: -1 }









