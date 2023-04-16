import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import { JSONObject } from '../JSON';
import URL from '../API/URL';
import IP from '../IP/IP';
import MonitorCriteria from './MonitorCriteria';
import BadDataException from '../Exception/BadDataException';

export interface MonitorStepType {
    monitorDestination?: URL | IP | undefined;
    monitorCriteria: MonitorCriteria;
}

export default class MonitorStep extends DatabaseProperty {
    public data: MonitorStepType | undefined = undefined;

    public constructor() {
        super();

        this.data = {
            monitorDestination: undefined,
            monitorCriteria: new MonitorCriteria(),
        };
    }


    public static getNewMonitorStepAsJSON(): JSONObject {
        return {
            _type: 'MonitorStep',
            value: {
                monitorDestination: undefined,
                monitorCriteria: MonitorCriteria.getNewMonitorCriteriaAsJSON(),
            },
        };
    }

    public static isValid(_json: JSONObject): boolean {
        return true;
    }

    public toJSON(): JSONObject {
        if (this.data) {
            return {
                _type: 'MonitorStep',
                value: {
                    monitorDestination: this.data?.monitorDestination?.toJSON() || undefined,
                    monitorCriteria: this.data.monitorCriteria.toJSON(),
                },
            };
        }

        return MonitorStep.getNewMonitorStepAsJSON();
    }

    public fromJSON(json: JSONObject): MonitorStep {

        if(json instanceof MonitorStep){
            return json;
        }

        if (!json || json['_type'] !== 'MonitorStep') {
            throw new BadDataException('Invalid monitor step');
        }

        if (!json['value']) {
            throw new BadDataException('Invalid monitor step');
        }

        json = json['value'] as JSONObject;

        let monitorDestination: URL | IP | undefined = undefined;

        if (
            json &&
            json['monitorDestination'] &&
            (json['monitorDestination'] as JSONObject)['_type'] === 'URL'
        ) {
            monitorDestination = URL.fromJSON(
                json['monitorDestination'] as JSONObject
            );
        }

        if (
            json &&
            json['monitorDestination'] &&
            (json['monitorDestination'] as JSONObject)['_type'] === 'IP'
        ) {
            monitorDestination = IP.fromJSON(
                json['monitorDestination'] as JSONObject
            );
        }

        if (!json['monitorCriteria']) {
            throw new BadDataException('Invalid monitor criteria');
        }

        if (
            MonitorCriteria.isValid(json['monitorCriteria'] as JSONObject) ===
            false
        ) {
            throw new BadDataException('Invalid monitor criteria');
        }

        this.data = {
            monitorDestination: monitorDestination || undefined,
            monitorCriteria: new MonitorCriteria().fromJSON(
                json['monitorCriteria'] as JSONObject
            ),
        };

        return this;
    }

    public isValid(): boolean {
        return true;
    }

    protected static override toDatabase(
        _value: MonitorStep | FindOperator<MonitorStep>
    ): JSONObject | null {
        if (_value) {
            return (_value as MonitorStep).toJSON();
        }

        return null;
    }

    protected static override fromDatabase(
        value: JSONObject
    ): MonitorStep | null {
        if (value) {
            return new MonitorStep().fromJSON(value);
        }

        return null;
    }

    public override toString(): string {
        return JSON.stringify(this.toJSON());
    }
}
