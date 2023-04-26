import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import { JSONArray, JSONObject, ObjectType } from '../JSON';
import MonitorCriteriaInstance from './MonitorCriteriaInstance';
import BadDataException from '../Exception/BadDataException';
import MonitorType from './MonitorType';

export interface MonitorCriteriaType {
    monitorCriteriaInstanceArray: Array<MonitorCriteriaInstance>;
}

export default class MonitorCriteria extends DatabaseProperty {
    public data: MonitorCriteriaType | undefined = undefined;

    public constructor() {
        super();
        this.data = {
            monitorCriteriaInstanceArray: [new MonitorCriteriaInstance()],
        };
    }

    public static getValidationError(
        value: MonitorCriteria,
        monitorType: MonitorType
    ): string | null {
        if (!value.data) {
            return 'Monitor Criteria is required';
        }

        if (value.data.monitorCriteriaInstanceArray.length === 0) {
            return 'Monitor Criteria is required';
        }

        for (const criteria of value.data.monitorCriteriaInstanceArray) {
            if (
                MonitorCriteriaInstance.getValidationError(
                    criteria,
                    monitorType
                )
            ) {
                return MonitorCriteriaInstance.getValidationError(
                    criteria,
                    monitorType
                );
            }
        }

        return null;
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

    public override toJSON(): JSONObject {
        if (!this.data) {
            return MonitorCriteria.getNewMonitorCriteriaAsJSON();
        }

        return {
            _type: ObjectType.MonitorCriteria,
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

    public static override fromJSON(json: JSONObject): MonitorCriteria {
        if (json instanceof MonitorCriteria) {
            return json;
        }

        if (!json || json['_type'] !== ObjectType.MonitorCriteria) {
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

        const monitorCriteria: MonitorCriteria = new MonitorCriteria();

        monitorCriteria.data = {
            monitorCriteriaInstanceArray: monitorCriteriaInstanceArray.map(
                (json: JSONObject) => {
                    return MonitorCriteriaInstance.fromJSON(json);
                }
            ),
        };

        return monitorCriteria;
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
            return MonitorCriteria.fromJSON(value);
        }

        return null;
    }

    public override toString(): string {
        return JSON.stringify(this.toJSON());
    }
}
