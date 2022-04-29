import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import IncidentCommunicationSla from './IncidentCommunicationSla';
import MonitorSla from './MonitorSla';
import ResourceStatus from './ResourceStatus';
import Probe from './Probe';

@Column({
   type
})
const criteriaItem!: Schema = new Schema({
 
 @Column()
criteriaType!: string;

@Column()
filter!: 
}

// A schema definition for a criterion event, i.e up, down; or degraded

@Column()
const criteriaSchema!: Schema = new Schema({
 
 @Column()
condition!: string;

@Column()
criteria!: []
}

// A schema definition for a criterion event, i.e up, down; or degraded

@Column()
const criterionEventSchema!: Schema = new Schema({
 
 @Column()
schedules!: [String];

@Column()
createAlert!: boolean;

@Column()
autoAcknowledge!: boolean;

@Column()
autoResolve!: boolean;

@Column()
title: { type: string, default !: '' };

@Column()
description: { type: string, default !: '' };

@Column()
    default !: boolean;

@Column()
name!: string;

@Column()
criteria!: {

   @Column()
   condition!: string;

   @Column()
   criteria!: [Schema.Types.Mixed];
};

@Column()
scripts!: [
   {
 
 @Column()
script!: {

   @Column()
      type!: Schema.Types.Object;

   @Column()
   ref!: 'AutomationSript';

   @Column()
   index!: true;
};
        };
    ];
}


/**
 * SAMPLE STRUCTURE OF HOW CRITERIA WILL BE STRUCTURED IN THE DB
 * Depending of on the level, criteria will house all the conditions;
 * in addition to nested condition if present (the nested condition will follow the same structural pattern)
 *
 
 @Column()
 * criteria!: {
 
 @Column()
 *  condition!: 'and';
 
 @Column()
 *  criteria!: [
 *      {
 
 @Column()
 *         condition!: 'or';
 
 @Column()
 *         criteria!: [
 *            {
 
 @Column()
 *               "responseType"!: "requestBody";
 
 @Column()
 *               "filter"!: "equalTo";
 
 @Column()
 *                "field1"!: "ok"
 *            };
 *            {
 
 @Column()
 *               "responseType"!: "requestBody";
 
 @Column()
 *               "filter"!: "equalTo";
 
 @Column()
 *                "field1"!: "healthy"
 *            };
 *            {
 
 @Column()
 *               condition!: 'and';
 
 @Column()
 *               criteria!: [{}, {}; ...]
 *            }
 *         ]
 *      };
 *      {
 
 @Column()
 *          "responseType"!: "statusCode";
 
 @Column()
 *           "filter"!: "equalTo";
 
 @Column()
 *           "field1"!: "200"
 *      };
 *      {
 
 @Column()
 *           "responseType"!: "requestTime";
 
 @Column()
 *           "filter"!: "lessthan";
 
 @Column()
 *           "field1"!: "1000"
 *      };
 *      ...
 *   ]
 * }
 */

@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   project!: Project; //Which project this monitor belongs to.

   @Column()
   component!: {
 
 @Column()
   type!: Schema.Types.Object;

   @Column()
   ref!: 'Component';

   @Column()
   index!: true;
};

@Column()
name!: string;

@Column()
slug!: string;

@Column()
config!: { }, //Can be URL, IP address; or anything that depends on the type.

@Column()
createdByUser!: User; //user.

@Column()
   type!: MonitorType

@Column()
index!: true;
    }, //Type can be 'url', 'process', 'machine'. We can monitor URL; a process in a machine or a server itself.

@Column()
agentlessConfig!: Object;

@Column()
kubernetesConfig!: Schema.Types.Mixed;

@Column()
kubernetesNamespace: { type: string, default !: 'default' };
;

@Column()
lastPingTime!: {

   @Column()
      type!: Date;

   @Column()
        default !: Date.now;

   @Column()
   index!: true;
};

@Column()
updateTime!: {

   @Column()
      type!: Date;

   @Column()
        default !: Date.now;

   @Column()
   index!: true;
};

@Column()
criteria!: {

   @Column()
   up: { type: [criterionEventSchema], default !: [] };

   @Column()
   degraded: { type: [criterionEventSchema], default !: [] };

   @Column()
   down: { type: [criterionEventSchema], default !: [] };
};

@Column()
lastMatchedCriterion: { type: criterionEventSchema, default !: { } };

@Column()
method!: string;

@Column()
bodyType!: string;

@Column()
formData!: [Object];

@Column()
text!: string;

@Column()
headers!: [Object];

@Column()
disabled!: boolean

@Column()
deletedByUser!: User;

@Column()
scriptRunStatus!: string;

@Column()
scriptRunBy: Probe};

@Column()
lighthouseScannedAt: Date;

@Column()
lighthouseScanStatus!: string;


@Column()
siteUrls!: Array<string>;

@Column()
incidentCommunicationSla!: IncidentCommunicationSla

@Column()
monitorSla!: MonitorSla

@Column()
breachedMonitorSla!: boolean;

@Column()
breachClosedBy: User;

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
shouldNotMonitor!: boolean;

@Column()
scanning!: boolean;

@Column()
probeScanning!: [String];

@Column()
monitorStatus!: ResourceStatus;
}







