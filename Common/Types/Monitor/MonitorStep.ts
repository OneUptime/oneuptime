import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import { JSONObject } from '../JSON';
import URL from '../API/URL';
import IP from '../IP/IP';
import MonitorCriteria from './MonitorCriteria';
import BadDataException from '../Exception/BadDataException';

export interface MonitorStepType {
    monitorDestination: URL | IP;
    monitorCriteria: MonitorCriteria;
}

export default class MonitorStep extends DatabaseProperty {
    public monitorStep: MonitorStepType | undefined = undefined;

    public constructor() {
        super();
    }

    public static isValid(_json: JSONObject): boolean {
        return true;
    }

    public toJSON(): JSONObject {
        if (this.monitorStep) {
            return {
                _type: 'MonitorStep',
                value: {
                    monitorDestination:
                        this.monitorStep.monitorDestination.toJSON(),
                    monitorCriteria: this.monitorStep.monitorCriteria.toJSON(),
                },
            };
        }

        return {};
    }

    public fromJSON(json: JSONObject): MonitorStep {
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

        if (!monitorDestination) {
            throw new BadDataException('Invalid monitor destination');
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

        this.monitorStep = {
            monitorDestination: monitorDestination,
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
