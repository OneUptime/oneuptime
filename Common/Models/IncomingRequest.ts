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
        project: Project;
 
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
        isDefault!: boolean;
 
 @Column()
        selectAllMonitors!: boolean;
 
 @Column()
        createIncident!: boolean;
 
 @Column()
        acknowledgeIncident!: boolean;
 
 @Column()
        resolveIncident!: boolean;
 
 @Column()
        updateIncidentNote!: boolean;
 
 @Column()
        updateInternalNote!: boolean;
 
 @Column()
        noteContent!: string;
 
 @Column()
        incidentState!: string;
 
 @Column()
        url!: URL;
 
 @Column()
        enabled!: boolean;
        
 

 
 @Column()
        incidentTitle!: string;
 
 @Column()
        incidentType!: string;
 
 @Column()
        incidentPriority!: {
 
 @Column()
            type!: Schema.Types.Mixed;
 
 @Column()
            ref!: 'IncidentPriority';
 
 @Column()
            index!: true;
        };
 
 @Column()
        incidentDescription!: string;
 
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
        filterMatch!: string;
 
 @Column()
        filters!: [
            {
 
 @Column()
                filterCriteria!: string;
 
 @Column()
                filterCondition!: {
 
 @Column()
                    type!: string;
 
 @Column()
                    enum!: [
                        'equalTo';
                        'notEqualTo';
                        'lessThan';
                        'greaterThan';
                        'greaterThanOrEqualTo';
                        'lessThanOrEqualTo';
                    ];
                };
 
 @Column()
                filterText!: Schema.Types.Mixed;
            };
        ];
 
 @Column()
        createSeparateIncident!: boolean;
 
 @Column()
        post_statuspage!: boolean;
    };
 

}








