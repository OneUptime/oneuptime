import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import { JSONObject } from '../JSON';
import ObjectID from '../ObjectID';

export enum CheckOn {
    ResponseTime = 'Response Time',
    ResponseCode = 'Response Code',
    ResponseHeader = 'Response Header',
    ResponseBody = 'Response Body',
    IsOnline = 'Is Online',
}

export interface CriteriaFilter {
    checkOn: CheckOn;
    filterType: FilterType;
    value: string | number;
}

export interface CriteriaIncident {
    title: string;
    description: string;
    incidentSeverityId: ObjectID;
}

export enum FilterType {
    EqualTo = 'Equal To',
    NotEqualTo = 'Not Equal To',
    GreaterThan = 'Greater Than',
    LessThan = 'Less Than',
    GreaterThanOrEqualTo = 'Greater Than Or Equal To',
    LessThanOrEqualTo = 'Less Than Or Equal To',
    Contains = 'Contains',
    NotContains = 'Not Contains',
    StartsWith = 'Starts With',
    EndsWith = 'Ends With',
    IsEmpty = 'Is Empty',
    IsNotEmpty = 'Is Not Empty',
}

export enum FilterCondtion {
    All = 'All',
    Any = 'Any',
}

export interface MonitorCriteriaInstanceType {
    monitorStateId: ObjectID;
    filter: {
        filterCondition: FilterCondtion;
        filters: Array<CriteriaFilter>;
    };
    createIncidents: Array<CriteriaIncident>;
}

export default class MonitorCriteriaInstance extends DatabaseProperty {
    public monitorCriteriaInstance: JSONObject = {};

    public constructor() {
        super();
    }

    public toJSON(): JSONObject {
        return this.monitorCriteriaInstance;
    }

    public fromJSON(json: JSONObject): MonitorCriteriaInstance {
        this.monitorCriteriaInstance = json;
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
