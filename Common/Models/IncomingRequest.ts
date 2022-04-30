import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import IncidentPriority from './IncidentPriority';
import IncomingRequestCustomFields from '../Types/IncomingRequest/IncomingRequestCustomFields';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
        name!: string;
 
 @Column()
        project!: Project;
 
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
        incidentPriority!:IncidentPriority
 
 @Column()
        incidentDescription!: string;
 
 @Column()
        customFields!: IncomingRequestCustomFields
 
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
        postOnsStatusPage!: boolean;
    };
 

}








