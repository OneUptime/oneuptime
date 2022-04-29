import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import IncidentCommunicationSla from './IncidentCommunicationSla';
import MonitorSla from './MonitorSla';
import ResourceStatus from './ResourceStatus';
import Probe from './Probe';
import MonitorCustomFields from '../Types/Monitor/MonitorCustomFields';
import MonitorCriteriaInstance from '../Types/Monitor/MonitorCriteriaInstance';
import HTTPMethod from '../Types/API/HTTPMethod';
import MonitorCriteria from '../Types/Monitor/MonitorCriteria';
import Component from './Component';


@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   project!: Project; //Which project this monitor belongs to.

   @Column()
   component!: Component

   @Column()
   name!: string;

   @Column()
   slug!: string;

   @Column()
   config!: Object

   @Column()
   createdByUser!: User; //user.

   @Column()
   type!: MonitorType

   @Column()
   agentlessConfig!: string;

   @Column()
   kubernetesConfig!: string;

   @Column()
   kubernetesNamespace!: string

   @Column()
   lastPingTime!: Date

   @Column()
   updateTime!: Date

   @Column()
   criteria!: MonitorCriteria

   @Column()
   lastMatchedCriterion!: MonitorCriteriaInstance


   @Column()
   method!: HTTPMethod;

   @Column()
   bodyType!: string;

   @Column()
   formData!: FormData;

   @Column()
   text!: string;

   @Column()
   headers!: Headers;

   @Column()
   disabled!: boolean

   @Column()
   deletedByUser!: User;

   @Column()
   scriptRunStatus!: string;

   @Column()
   scriptRunBy!: Probe

   @Column()
   lighthouseScannedAt!: Date;

   @Column()
   lighthouseScanStatus!: string;

   @Column()
   siteUrls!: Array<string>;

   @Column()
   incidentCommunicationSla!: IncidentCommunicationSla

   @Column()
   monitorSla!: MonitorSla

   @Column()
   customFields!: MonitorCustomFields

   @Column()
   disableMonitoring!: boolean;

   @Column()
   monitorStatus!: ResourceStatus;
}







