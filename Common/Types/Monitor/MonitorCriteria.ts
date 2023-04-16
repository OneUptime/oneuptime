import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import { JSONArray, JSONObject } from '../JSON';
import MonitorCriteriaInstance from './MonitorCriteriaInstance';
import BadDataException from '../Exception/BadDataException';

export interface MonitorCriteriaType {
    monitorCriteriaInstanceArray: Array<MonitorCriteriaInstance>;
}

export default class MonitorCriteria extends DatabaseProperty {
    public data: MonitorCriteriaType | undefined = undefined;

    public constructor() {
        super();
        this.data = {
            monitorCriteriaInstanceArray: [
                new MonitorCriteriaInstance(),
            ],
        };
        
    }


    public static getNewMonitorCriteriaAsJSON(): JSONObject {
        return {
            _type: 'MonitorCriteria',
            value: {
                monitorCriteriaInstanceArray: [
                    new MonitorCriteriaInstance().toJSON(),
                ],
            },
        };
    }


    public toJSON(): JSONObject {
        
        if (!this.data) {
            return MonitorCriteria.getNewMonitorCriteriaAsJSON();
        }

        return {
            _type: 'MonitorCriteria',
            value: {
                monitorCriteriaInstanceArray:
                    this.data.monitorCriteriaInstanceArray.map(
                        (criteria: MonitorCriteriaInstance) => {
                            return criteria.toJSON();
                        }
                    ),
            },
        };
    }

    public fromJSON(json: JSONObject): MonitorCriteria {

        if(json instanceof MonitorCriteria){
            return json;
        }

        if (!json || json['_type'] !== 'MonitorCriteria') {
            throw new BadDataException('Invalid monitor criteria');
        }

        if (!json) {
            throw new BadDataException('Invalid monitor criteria');
        }

        if (!json['value']) {
            throw new BadDataException('Invalid monitor criteria');
        }

        if (!(json['value'] as JSONObject)['monitorCriteriaInstanceArray']) {
            throw new BadDataException('Invalid monitor criteria');
        }

        const monitorCriteriaInstanceArray: JSONArray = (
            json['value'] as JSONObject
        )['monitorCriteriaInstanceArray'] as JSONArray;

        this.data = {
            monitorCriteriaInstanceArray: monitorCriteriaInstanceArray.map(
                (json: JSONObject) => {
                    return new MonitorCriteriaInstance().fromJSON(json);
                }
            ),
        };

        return this;
    }

    public static isValid(_json: JSONObject): boolean {
        return true;
    }

    protected static override toDatabase(
        _value: MonitorCriteria | FindOperator<MonitorCriteria>
    ): JSONObject | null {
        if (_value) {
            return (_value as MonitorCriteria).toJSON();
        }

        return null;
    }

    protected static override fromDatabase(
        value: JSONObject
    ): MonitorCriteria | null {
        if (value) {
            return new MonitorCriteria().fromJSON(value);
        }

        return null;
    }

    public override toString(): string {
        return JSON.stringify(this.toJSON());
    }
}
