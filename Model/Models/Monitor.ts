import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Project from './Project';
import IncidentCommunicationSla from './IncidentCommunicationSla';
import MonitorSla from './MonitorSla';
import ResourceStatus from './ResourceStatus';
import Probe from './Probe';
import MonitorCustomFields from 'Common/Types/Monitor/MonitorCustomFields';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';
import HTTPMethod from 'Common/Types/API/HTTPMethod';
import MonitorCriteria from 'Common/Types/Monitor/MonitorCriteria';
import Component from './Component';
import MonitorType from 'Common/Types/Monitor/MonitorType';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public project?: Project; //Which project this monitor belongs to.

    @Column()
    public component?: Component;

    @Column()
    public name?: string = undefined;

    @Column()
    public slug?: string = undefined;

    @Column()
    public config?: Object;

    @Column()
    public createdByUser?: User; //user.

    @Column()
    public type?: MonitorType;

    @Column()
    public agentlessConfig?: string = undefined;

    @Column()
    public kubernetesConfig?: string = undefined;

    @Column()
    public kubernetesNamespace?: string = undefined;

    @Column()
    public lastPingTime?: Date = undefined;

    @Column()
    public updateTime?: Date = undefined;

    @Column()
    public criteria?: MonitorCriteria;

    @Column()
    public lastMatchedCriterion?: MonitorCriteriaInstance;

    @Column()
    public method?: HTTPMethod;

    @Column()
    public bodyType?: string = undefined;

    @Column()
    public formData?: FormData;

    @Column()
    public text?: string = undefined;

    @Column()
    public headers?: Headers;

    @Column()
    public disabled?: boolean = undefined;

    @Column()
    public deletedByUser?: User;

    @Column()
    public scriptRunStatus?: string = undefined;

    @Column()
    public scriptRunBy?: Probe;

    @Column()
    public lighthouseScannedAt?: Date = undefined;

    @Column()
    public lighthouseScanStatus?: string = undefined;

    @Column()
    public siteUrls?: Array<string>;

    @Column()
    public incidentCommunicationSla?: IncidentCommunicationSla;

    @Column()
    public monitorSla?: MonitorSla;

    @Column()
    public customFields?: MonitorCustomFields;

    @Column()
    public disableMonitoring?: boolean = undefined;

    @Column()
    public monitorStatus?: ResourceStatus;
}
