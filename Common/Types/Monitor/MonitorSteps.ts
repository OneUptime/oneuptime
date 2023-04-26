import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import { JSONArray, JSONObject, ObjectType } from '../JSON';
import MonitorStep from './MonitorStep';
import BadDataException from '../Exception/BadDataException';

export interface MonitorStepsType {
    monitorStepsInstanceArray: Array<MonitorStep>;
}

export default class MonitorSteps extends DatabaseProperty {
    public data: MonitorStepsType | undefined = undefined;

    public constructor() {
        super();
        this.data = {
            monitorStepsInstanceArray: [new MonitorStep()],
        };
    }

    public static getNewMonitorStepsAsJSON(): JSONObject {
        return {
            _type: ObjectType.MonitorSteps,
            value: {
                monitorStepsInstanceArray: [new MonitorStep().toJSON()],
            },
        };
    }

    public override toJSON(): JSONObject {
        if (!this.data) {
            return MonitorSteps.getNewMonitorStepsAsJSON();
        }

        return {
            _type: ObjectType.MonitorSteps,
            value: {
                monitorStepsInstanceArray:
                    this.data.monitorStepsInstanceArray.map(
                        (step: MonitorStep) => {
                            return step.toJSON();
                        }
                    ),
            },
        };
    }

    public static override fromJSON(json: JSONObject): MonitorSteps {
        if (json instanceof MonitorSteps) {
            return json;
        }

        if (!json) {
            throw new BadDataException('Invalid monitor steps');
        }

        if (json['_type'] !== 'MonitorSteps') {
            throw new BadDataException('Invalid monitor steps');
        }

        if (!json['value']) {
            throw new BadDataException('Invalid monitor steps');
        }

        if (!(json['value'] as JSONObject)['monitorStepsInstanceArray']) {
            throw new BadDataException('Invalid monitor steps');
        }

        const monitorStepsInstanceArray: JSONArray = (
            json['value'] as JSONObject
        )['monitorStepsInstanceArray'] as JSONArray;

        const monitorSteps = new MonitorSteps();


        monitorSteps.data = {
            monitorStepsInstanceArray: monitorStepsInstanceArray.map(
                (json: JSONObject) => {
                    return MonitorStep.fromJSON(json);
                }
            ),
        };

        return monitorSteps;
    }

    public static isValid(_json: JSONObject): boolean {
        return true;
    }

    protected static override toDatabase(
        _value: MonitorSteps | FindOperator<MonitorSteps>
    ): JSONObject | null {
        if (_value) {
            return (_value as MonitorSteps).toJSON();
        }

        return null;
    }

    protected static override fromDatabase(
        value: JSONObject
    ): MonitorSteps | null {
        if (value) {
            return MonitorSteps.fromJSON(value);
        }

        return null;
    }

    public override toString(): string {
        return JSON.stringify(this.toJSON());
    }
}
