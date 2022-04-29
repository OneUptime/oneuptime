import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

export enum IncidentState {
   Identified = "Identified",
   Acknowledged = "Acknowledged",
   Resolved = "Resolved"
}

@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    idNumber!: {
 
 @Column()
        type!: Schema.Types.Number;
 
 @Column()
        index!: true;
    };
 
 @Column()
    project!: Project; //Which project this incident belongs to.
 
 @Column()
    title!: {
 
 @Column()
        type!: Schema.Types.String;
    };
 
 @Column()
    description!: {
 
 @Column()
        type!: Schema.Types.String;
    };
 
 @Column()
    reason!: {
 
 @Column()
        type!: Schema.Types.String;
    };
 
 @Column()
    response!: Object;
 
 @Column()
    monitors!: [
        {
 
 @Column()
            monitor!: {
 
 @Column()
                type!: Schema.Types.Object;
 
 @Column()
                ref!: 'Monitor';
 
 @Column()
                index!: true;
            };
        };
    ];
 
 @Column()
    notifications!: [
        {
 
 @Column()
            notification!: {
 
 @Column()
                type!: string;
 
 @Column()
                ref!: 'Notification';
 
 @Column()
                index!: true;
            };
        };
    ];
 
 @Column()
    incidentPriority!: {
 
 @Column()
        type!: string;
 
 @Column()
        ref!: 'IncidentPriority';
 
 @Column()
        index!: true;
    };
 
 @Column()
    acknowledged!: boolean;
 
 @Column()
    acknowledgedBy!: User; // user
 
 @Column()
    acknowledgedAt!: {
 
 @Column()
        type!: Date;
    };
 
 @Column()
    acknowledgedByZapier!: boolean; // Is true when zapier acknowledges incident

 
 @Column()
    resolved!: boolean;
 
 @Column()
    incidentType!: {
 
 @Column()
        type!: string;
 
 @Column()
        enum!: ['online', 'offline', 'degraded'];
 
 @Column()
        required!: false;
    };
 
 @Column()
    probes!: [
        {
 
 @Column()
            probe: { type: string, ref!: 'Probe' };
 
 @Column()
            updatedAt!: Date;
 
 @Column()
            status!: boolean;
 
 @Column()
            reportedStatus!: {
 
 @Column()
                type!: string;
 
 @Column()
                enum!: ['online', 'offline', 'degraded'];
 
 @Column()
                required!: false;
            };
        };
    ];
 
 @Column()
    resolvedBy!: User; // user
 
 @Column()
    resolvedAt!: Date;
 
 @Column()
    resolvedByZapier!: boolean; // Is true when zapier resolves incident

 
 @Column()
    internalNote: { type: string, default!: '' };
 
 @Column()
    investigationNote: { type: string, default!: '' };

 
 @Column()
    createdByUser!: User; // user
 
 @Column()
    createdByApi!: boolean;
    ;

 
 @Column()
    createdByZapier!: boolean; // Is true when zapier creates incident

 
 @Column()
    acknowledgedByApi!: boolean;
 
 @Column()
    resolvedByApi!: boolean;

 
 @Column()
    notClosedBy!: [User];
 
 @Column()
    manuallyCreated!: boolean;
 
 @Column()
    criterionCause!: Object;

    



 
 @Column()
    deletedByUser!: User;
    // Has this incident breached communication sla
 
 @Column()
    breachedCommunicationSla!: boolean;
 
 @Column()
    customFields!: [
        {
 
 @Column()
            fieldName!: string;
 
 @Column()
            fieldValue!: Schema.Types.Mixed;
 
 @Column()
            uniqueField!: boolean;
 
 @Column()
            fieldType!: string;
        };
    ];
 
 @Column()
    acknowledgedByIncomingHttpRequest: { type: string, ref!: 'IncomingRequest' };
 
 @Column()
    resolvedByIncomingHttpRequest: { type: string, ref!: 'IncomingRequest' };
 
 @Column()
    createdByIncomingHttpRequest: { type: string, ref!: 'IncomingRequest' };
 
 @Column()
    hideIncident!: boolean;

 
 @Column()
    slug!: string;
}









