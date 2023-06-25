import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import { JSONObject, ObjectType } from '../JSON';
import ObjectID from '../ObjectID';
import { CriteriaIncident } from './CriteriaIncident';
import {
    CheckOn,
    CriteriaFilter,
    FilterCondition,
    FilterType,
} from './CriteriaFilter';
import BadDataException from '../Exception/BadDataException';
import MonitorType from './MonitorType';
import Typeof from '../Typeof';
import JSONFunctions from '../JSONFunctions';

export interface MonitorCriteriaInstanceType {
    monitorStatusId: ObjectID | undefined;
    filterCondition: FilterCondition;
    filters: Array<CriteriaFilter>;
    incidents: Array<CriteriaIncident>;
    name: string;
    description: string;
    changeMonitorStatus?: boolean | undefined;
    createIncidents?: boolean | undefined;
    id: string;
}

export default class MonitorCriteriaInstance extends DatabaseProperty {
    public data: MonitorCriteriaInstanceType | undefined = undefined;

    public constructor() {
        super();
        this.data = {
            id: ObjectID.generate().toString(),
            monitorStatusId: undefined,
            filterCondition: FilterCondition.All,
            filters: [
                {
                    checkOn: CheckOn.IsOnline,
                    filterType: undefined,
                    value: undefined,
                },
            ],
            createIncidents: false,
            changeMonitorStatus: false,
            incidents: [],
            name: '',
            description: '',
        };
    }

    public static getDefaultOnlineMonitorCriteriaInstance(arg: {
        monitorType: MonitorType;
        monitorStatusId: ObjectID;
    }): MonitorCriteriaInstance {
        const monitorCriteriaInstance: MonitorCriteriaInstance =
            new MonitorCriteriaInstance();

        monitorCriteriaInstance.data = {
            id: ObjectID.generate().toString(),
            monitorStatusId: arg.monitorStatusId,
            filterCondition: FilterCondition.All,
            filters: [
                {
                    checkOn: CheckOn.IsOnline,
                    filterType: FilterType.True,
                    value: undefined,
                },
            ],
            incidents: [],
            changeMonitorStatus: true,
            createIncidents: false,
            name: 'Check if online',
            description: 'This criteria cheks if the monitor is online',
        };

        if (
            arg.monitorType === MonitorType.Website ||
            arg.monitorType === MonitorType.API
        ) {
            monitorCriteriaInstance.data.filters.push({
                checkOn: CheckOn.ResponseStatusCode,
                filterType: FilterType.EqualTo,
                value: 200,
            });
        }

        return monitorCriteriaInstance;
    }

    public static getDefaultOfflineMonitorCriteriaInstance(arg: {
        monitorType: MonitorType;
        monitorStatusId: ObjectID;
        incidentSeverityId: ObjectID;
    }): MonitorCriteriaInstance {
        const monitorCriteriaInstance: MonitorCriteriaInstance =
            new MonitorCriteriaInstance();

        if (
            arg.monitorType === MonitorType.Ping ||
            arg.monitorType === MonitorType.IP
        ) {
            monitorCriteriaInstance.data = {
                id: ObjectID.generate().toString(),
                monitorStatusId: arg.monitorStatusId,
                filterCondition: FilterCondition.All,
                filters: [
                    {
                        checkOn: CheckOn.IsOnline,
                        filterType: FilterType.False,
                        value: undefined,
                    },
                ],
                incidents: [
                    {
                        title: `${arg.monitorType} monitor is offline`,
                        description: `${arg.monitorType} monitor is currently offline.`,
                        incidentSeverityId: arg.incidentSeverityId,
                        autoResolveIncident: true,
                    },
                ],
                changeMonitorStatus: true,
                createIncidents: true,
                name: 'Check if offline',
                description: 'This criteria cheks if the monitor is offline',
            };
        }

        if (
            arg.monitorType === MonitorType.API ||
            arg.monitorType === MonitorType.Website
        ) {
            monitorCriteriaInstance.data = {
                id: ObjectID.generate().toString(),
                monitorStatusId: arg.monitorStatusId,
                filterCondition: FilterCondition.Any,
                filters: [
                    {
                        checkOn: CheckOn.IsOnline,
                        filterType: FilterType.False,
                        value: undefined,
                    },
                    {
                        checkOn: CheckOn.ResponseStatusCode,
                        filterType: FilterType.NotEqualTo,
                        value: 200,
                    },
                ],
                incidents: [
                    {
                        title: `${arg.monitorType} monitor is offline`,
                        description: `${arg.monitorType} monitor is currently offline.`,
                        incidentSeverityId: arg.incidentSeverityId,
                        autoResolveIncident: true,
                    },
                ],
                changeMonitorStatus: true,
                createIncidents: true,
                name: 'Check if offline',
                description: 'This criteria cheks if the monitor is offline',
            };
        }

        return monitorCriteriaInstance;
    }

    public static getNewMonitorCriteriaInstanceAsJSON(): JSONObject {
        return {
            id: ObjectID.generate().toString(),
            monitorStatusId: undefined,
            filterCondition: FilterCondition.All,
            filters: [
                {
                    checkOn: CheckOn.IsOnline,
                    filterType: FilterType.True,
                    value: undefined,
                },
            ],
            incidents: [],
            name: '',
            description: '',
            createIncidents: false,
            changeMonitorStatus: false,
        };
    }

    public static getValidationError(
        value: MonitorCriteriaInstance,
        monitorType: MonitorType
    ): string | null {
        if (!value.data) {
            return 'Monitor Step is required';
        }

        if (value.data.filters.length === 0) {
            return 'Monitor Criteria filter is required';
        }

        if (!value.data.name) {
            return 'Monitor Criteria name is required';
        }

        if (!value.data.description) {
            return 'Monitor Criteria description is required';
        }

        for (const incident of value.data.incidents) {
            if (!incident) {
                continue;
            }

            if (!incident.title) {
                return 'Monitor Criteria incident title is required';
            }

            if (!incident.description) {
                return 'Monitor Criteria incident description is required';
            }

            if (!incident.incidentSeverityId) {
                return 'Monitor Criteria incident severity is required';
            }
        }

        for (const filter of value.data.filters) {
            if (!filter.checkOn) {
                return 'Monitor Criteria filter check on is required';
            }

            if (
                monitorType === MonitorType.Ping &&
                filter.checkOn !== CheckOn.IsOnline &&
                filter.checkOn !== CheckOn.ResponseTime
            ) {
                return (
                    'Ping  Monitor cannot have filter criteria: ' +
                    filter.checkOn
                );
            }
        }

        return null;
    }

    public setName(name: string): MonitorCriteriaInstance {
        if (this.data) {
            this.data.name = name;
        }

        return this;
    }

    public setDescription(description: string): MonitorCriteriaInstance {
        if (this.data) {
            this.data.description = description;
        }

        return this;
    }

    public static clone(
        monitorCriteriaInstance: MonitorCriteriaInstance
    ): MonitorCriteriaInstance {
        return MonitorCriteriaInstance.fromJSON(
            monitorCriteriaInstance.toJSON()
        );
    }

    public setMonitorStatusId(
        monitorStatusId: ObjectID | undefined
    ): MonitorCriteriaInstance {
        if (this.data) {
            this.data.monitorStatusId = monitorStatusId;
        }

        return this;
    }

    public setFilterCondition(
        filterCondition: FilterCondition
    ): MonitorCriteriaInstance {
        if (this.data) {
            this.data.filterCondition = filterCondition;
        }

        return this;
    }

    public setFilters(filters: Array<CriteriaFilter>): MonitorCriteriaInstance {
        if (this.data) {
            this.data.filters = filters;
        }

        return this;
    }

    public setIncidents(
        incidents: Array<CriteriaIncident>
    ): MonitorCriteriaInstance {
        if (this.data) {
            this.data.incidents = [...incidents];
        }

        return this;
    }

    public setChangeMonitorStatus(
        changeMonitorStatus: boolean | undefined
    ): MonitorCriteriaInstance {
        if (this.data) {
            this.data.changeMonitorStatus = changeMonitorStatus;
        }

        return this;
    }

    public setCreateIncidents(
        createIncidents: boolean | undefined
    ): MonitorCriteriaInstance {
        if (this.data) {
            this.data.createIncidents = createIncidents;
        }

        return this;
    }

    public override toJSON(): JSONObject {
        if (!this.data) {
            return MonitorCriteriaInstance.getNewMonitorCriteriaInstanceAsJSON();
        }

        return JSONFunctions.serialize({
            _type: ObjectType.MonitorCriteriaInstance,
            value: {
                id: this.data.id,
                monitorStatusId: this.data.monitorStatusId?.toString(),
                filterCondition: this.data.filterCondition,
                filters: this.data.filters,
                incidents: this.data.incidents,
                changeMonitorStatus: this.data.changeMonitorStatus,
                createIncidents: this.data.createIncidents,
                name: this.data.name,
                description: this.data.description,
            } as any,
        });
    }

    public static override fromJSON(json: JSONObject): MonitorCriteriaInstance {
        if (json instanceof MonitorCriteriaInstance) {
            return json;
        }

        if (!json) {
            throw new BadDataException('json is null');
        }

        if (!json['_type']) {
            throw new BadDataException('json._type is null');
        }

        if (json['_type'] !== ObjectType.MonitorCriteriaInstance) {
            throw new BadDataException(
                'json._type should be MonitorCriteriaInstance'
            );
        }

        if (!json['value']) {
            throw new BadDataException('json.value is null');
        }

        json = json['value'] as JSONObject;

        if (!json['filterCondition']) {
            throw new BadDataException('json.filterCondition is null');
        }

        if (!json['filters']) {
            throw new BadDataException('json.filters is null');
        }

        if (!Array.isArray(json['filters'])) {
            throw new BadDataException('json.filters should be an array');
        }

        if (!json['incidents']) {
            throw new BadDataException('json.incidents is null');
        }

        if (!Array.isArray(json['incidents'])) {
            throw new BadDataException('json.incidents should be an array');
        }

        let monitorStatusId: ObjectID | undefined = undefined;

        if (
            json['monitorStatusId'] &&
            typeof json['monitorStatusId'] === Typeof.String
        ) {
            monitorStatusId = new ObjectID(json['monitorStatusId'] as string);
        } else if (
            json['monitorStatusId'] &&
            (json['monitorStatusId'] as JSONObject)['value'] !== null
        ) {
            monitorStatusId = new ObjectID(
                (json['monitorStatusId'] as JSONObject)['value'] as string
            );
        }

        const filterCondition: FilterCondition = json[
            'filterCondition'
        ] as FilterCondition;

        const filters: Array<CriteriaFilter> = [];

        const incidents: Array<CriteriaIncident> = [];

        for (const filter of json['filters']) {
            filters.push({ ...(filter as any) });
        }

        for (const incident of json['incidents']) {
            incidents.push({ ...(incident as any) });
        }

        const monitorCriteriaInstance: MonitorCriteriaInstance =
            new MonitorCriteriaInstance();

        monitorCriteriaInstance.data = JSONFunctions.deserialize({
            id: (json['id'] as string) || ObjectID.generate().toString(),
            monitorStatusId,
            filterCondition,
            changeMonitorStatus:
                (json['changeMonitorStatus'] as boolean) || false,
            createIncidents: (json['createIncidents'] as boolean) || false,
            filters: filters as any,
            incidents: incidents as any,
            name: (json['name'] as string) || '',
            description: (json['description'] as string) || '',
        }) as any;

        return monitorCriteriaInstance;
    }

    public static isValid(_json: JSONObject): boolean {
        return true;
    }

    protected static override toDatabase(
        value: MonitorCriteriaInstance | FindOperator<MonitorCriteriaInstance>
    ): JSONObject | null {
        if (value && value instanceof MonitorCriteriaInstance) {
            return (value as MonitorCriteriaInstance).toJSON();
        } else if (value) {
            return JSONFunctions.serialize(value as any);
        }

        return null;
    }

    protected static override fromDatabase(
        value: JSONObject
    ): MonitorCriteriaInstance | null {
        if (value) {
            return MonitorCriteriaInstance.fromJSON(value);
        }

        return null;
    }

    public override toString(): string {
        return JSON.stringify(this.toJSON());
    }
}
