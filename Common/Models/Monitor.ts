import { Column, Entity } from 'typeorm';
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
import MonitorType from '../Types/Monitor/MonitorType';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public project!: Project; //Which project this monitor belongs to.

    @Column()
    public component!: Component;

    @Column()
    public name!: string;

    @Column()
    public slug!: string;

    @Column()
    public config!: Object;

    @Column()
    public createdByUser!: User; //user.

    @Column()
    public type!: MonitorType;

    @Column()
    public agentlessConfig!: string;

    @Column()
    public kubernetesConfig!: string;

    @Column()
    public kubernetesNamespace!: string;

    @Column()
    public lastPingTime!: Date;

    @Column()
    public updateTime!: Date;

    @Column()
    public criteria!: MonitorCriteria;

    @Column()
    public lastMatchedCriterion!: MonitorCriteriaInstance;

    @Column()
    public method!: HTTPMethod;

    @Column()
    public bodyType!: string;

    @Column()
    public formData!: FormData;

    @Column()
    public text!: string;

    @Column()
    public headers!: Headers;

    @Column()
    public disabled!: boolean;

    @Column()
    public deletedByUser!: User;

    @Column()
    public scriptRunStatus!: string;

    @Column()
    public scriptRunBy!: Probe;

    @Column()
    public lighthouseScannedAt!: Date;

    @Column()
    public lighthouseScanStatus!: string;

    @Column()
    public siteUrls!: Array<string>;

    @Column()
    public incidentCommunicationSla!: IncidentCommunicationSla;

    @Column()
    public monitorSla!: MonitorSla;

    @Column()
    public customFields!: MonitorCustomFields;

    @Column()
    public disableMonitoring!: boolean;

    @Column()
    public monitorStatus!: ResourceStatus;
}
