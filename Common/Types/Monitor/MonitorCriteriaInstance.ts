import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import { JSONObject } from '../JSON';
import ObjectID from '../ObjectID';
import { CriteriaIncident } from './CriteriaIncident';
import { CriteriaFilter, FilterCondition } from './CriteriaFilter';
import BadDataException from '../Exception/BadDataException';

export interface MonitorCriteriaInstanceType {
    monitorStatusId: ObjectID | undefined;
    filterCondition: FilterCondition;
    filters: Array<CriteriaFilter>;
    createIncidents: Array<CriteriaIncident>;
}

export default class MonitorCriteriaInstance extends DatabaseProperty {
    public data: MonitorCriteriaInstanceType | undefined = undefined;

    public constructor() {
        super();
        this.data = {
            monitorStatusId: undefined,
            filterCondition: FilterCondition.All,
            filters: [],
            createIncidents: [],
        };
    }

    public static getNewMonitorCriteriaInstanceAsJSON(): JSONObject {
        return {
            monitorStatusId: undefined,
            filterCondition: FilterCondition.All,
            filters: [],
            createIncidents: [],
        };
    }



    public toJSON(): JSONObject {
        if (!this.data) {
            return MonitorCriteriaInstance.getNewMonitorCriteriaInstanceAsJSON();
        }

        return {
            monitorStatusId: this.data.monitorStatusId,
            filterCondition: this.data.filterCondition,
            filters: this.data.filters,
            createIncidents: this.data.createIncidents,
        };
    }

    public fromJSON(json: JSONObject): MonitorCriteriaInstance {

        if(json instanceof MonitorCriteriaInstance){
            return json;
        }

        if (!json) {
            throw new BadDataException('json is null');
        }

        if (!json['filterCondition']) {
            throw new BadDataException('json.filterCondition is null');
        }

        if (!json['filters']) {
            throw new BadDataException('json.filters is null');
        }

        if (!Array.isArray(json['filters'])) {
            throw new BadDataException('json.filters should be an array');
        }

        if (!json['createIncidents']) {
            throw new BadDataException('json.createIncidents is null');
        }

        if (!Array.isArray(json['createIncidents'])) {
            throw new BadDataException(
                'json.createIncidents should be an array'
            );
        }

        let monitorStatusId: ObjectID | undefined = undefined;

        if(json['monitorStatusId'] && (json['monitorStatusId'] as JSONObject)['value'] !== null) {
            monitorStatusId = new ObjectID(
                (json['monitorStatusId'] as JSONObject)['value'] as string
            );
        }

        const filterCondition: FilterCondition = json[
            'filterCondition'
        ] as FilterCondition;

        const filters: Array<CriteriaFilter> = [];

        const createIncidents: Array<CriteriaIncident> = [];

        for (const filter of json['filters']) {
            filters.push({ ...filter });
        }

        for (const incident of json['createIncidents']) {
            createIncidents.push({ ...incident });
        }

        this.data = {
            monitorStatusId,
            filterCondition,
            filters,
            createIncidents,
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
