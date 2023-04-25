import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import { JSONObject } from '../JSON';
import ObjectID from '../ObjectID';
import { CriteriaIncident } from './CriteriaIncident';
import { CheckOn, CriteriaFilter, FilterCondition } from './CriteriaFilter';
import BadDataException from '../Exception/BadDataException';

export interface MonitorCriteriaInstanceType {
    monitorStatusId: ObjectID | undefined;
    filterCondition: FilterCondition;
    filters: Array<CriteriaFilter>;
    incidents: Array<CriteriaIncident>;
    name: string;
    description: string;
    changeMonitorStatus?: boolean | undefined;
    createIncidents?: boolean | undefined;
}

export default class MonitorCriteriaInstance extends DatabaseProperty {
    public data: MonitorCriteriaInstanceType | undefined = undefined;

    public constructor() {
        super();
        this.data = {
            monitorStatusId: undefined,
            filterCondition: FilterCondition.All,
            filters: [
                {
                    checkOn: CheckOn.IsOnline,
                    filterType: undefined,
                    value: undefined,
                }
            ],
            incidents: [],
            name: '',
            description: '',
        };
    }

    public static getNewMonitorCriteriaInstanceAsJSON(): JSONObject {
        return {
            monitorStatusId: undefined,
            filterCondition: FilterCondition.All,
            filters: [
                {
                    checkOn: CheckOn.IsOnline,
                    filterType: undefined,
                    value: undefined,
                }
            ],
            incidents: [],
            name: '',
            description: '',
        };
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
        return new MonitorCriteriaInstance().fromJSON(
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
            this.data.incidents = incidents;
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

    public toJSON(): JSONObject {
        if (!this.data) {
            return MonitorCriteriaInstance.getNewMonitorCriteriaInstanceAsJSON();
        }

        return {
            _type: 'MonitorCriteriaInstance',
            value: {
                monitorStatusId: this.data.monitorStatusId,
                filterCondition: this.data.filterCondition,
                filters: this.data.filters,
                incidents: this.data.incidents,
            }
        }
    }

    public fromJSON(json: JSONObject): MonitorCriteriaInstance {
        if (json instanceof MonitorCriteriaInstance) {
            return json;
        }



        if (!json) {
            throw new BadDataException('json is null');
        }

        if(!json['_type']) {
            throw new BadDataException('json._type is null');
        }

        if (json['_type'] !== 'MonitorCriteriaInstance') {
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
            filters.push({ ...filter });
        }

        for (const incident of json['incidents']) {
            incidents.push({ ...incident });
        }

        this.data = {
            monitorStatusId,
            filterCondition,
            filters,
            incidents,
            name: (json['name'] as string) || '',
            description: (json['description'] as string) || '',
        };

        return this;
    }

    public static isValid(_json: JSONObject): boolean {
        return true;
    }

    protected static override toDatabase(
        _value: MonitorCriteriaInstance | FindOperator<MonitorCriteriaInstance>
    ): JSONObject | null {
        if (_value) {
            return (_value as MonitorCriteriaInstance).toJSON();
        }

        return null;
    }

    protected static override fromDatabase(
        value: JSONObject
    ): MonitorCriteriaInstance | null {
        if (value) {
            return new MonitorCriteriaInstance().fromJSON(value);
        }

        return null;
    }

    public override toString(): string {
        return JSON.stringify(this.toJSON());
    }
}
