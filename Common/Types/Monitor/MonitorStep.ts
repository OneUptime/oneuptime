import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import { JSONObject } from '../JSON';
import URL from '../API/URL';
import IP from '../IP/IP';
import MonitorCriteria from './MonitorCriteria';
import BadDataException from '../Exception/BadDataException';
import HTTPMethod from '../API/HTTPMethod';
import Dictionary from '../Dictionary';
import ObjectID from '../ObjectID';

export interface MonitorStepType {
    monitorDestination?: URL | IP | undefined;
    monitorCriteria: MonitorCriteria;
    requestType: HTTPMethod;
    requestHeaders?: Dictionary<string> | undefined;
    requestBody?: string | undefined;
    defaultMonitorStatusId?: ObjectID | undefined;
}

export default class MonitorStep extends DatabaseProperty {
    public data: MonitorStepType | undefined = undefined;

    public constructor() {
        super();

        this.data = {
            monitorDestination: undefined,
            monitorCriteria: new MonitorCriteria(),
            requestType: HTTPMethod.GET,
            requestHeaders: undefined,
            requestBody: undefined,
            defaultMonitorStatusId: undefined,
        };
    }

    public setDefaultMonitorStatusId(
        defaultMonitorStatusId: ObjectID | undefined
    ): MonitorStep {
        this.data!.defaultMonitorStatusId = defaultMonitorStatusId;
        return this;
    }


    public setRequestType(requestType: HTTPMethod): MonitorStep {
        this.data!.requestType = requestType;
        return this;
    }

    public setRequestHeaders(requestHeaders: Dictionary<string>): MonitorStep {
        this.data!.requestHeaders = requestHeaders;
        return this;
    }

    public static clone(monitorStep: MonitorStep): MonitorStep {
        return new MonitorStep().fromJSON(monitorStep.toJSON());
    }

    public setRequestBody(requestBody: string): MonitorStep {
        this.data!.requestBody = requestBody;
        return this;
    }

    public setMonitorDestination(monitorDestination: URL | IP): MonitorStep {
        this.data!.monitorDestination = monitorDestination;
        return this;
    }

    public setMonitorCriteria(monitorCriteria: MonitorCriteria): MonitorStep {
        this.data!.monitorCriteria = monitorCriteria;
        return this;
    }

    public static getNewMonitorStepAsJSON(): JSONObject {
        return {
            _type: 'MonitorStep',
            value: {
                monitorDestination: undefined,
                monitorCriteria: MonitorCriteria.getNewMonitorCriteriaAsJSON(),
                requestType: HTTPMethod.GET,
                requestHeaders: undefined,
                requestBody: undefined,
                defaultMonitorStatusId: undefined,
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
                    monitorDestination:
                        this.data?.monitorDestination?.toJSON() || undefined,
                    monitorCriteria: this.data.monitorCriteria.toJSON(),
                    requestType: this.data.requestType,
                    requestHeaders: this.data.requestHeaders || undefined,
                    requestBody: this.data.requestBody || undefined,
                    defaultMonitorStatusId:
                        this.data.defaultMonitorStatusId?.toJSON() || undefined,
                },
            };
        }

        return MonitorStep.getNewMonitorStepAsJSON();
    }

    public fromJSON(json: JSONObject): MonitorStep {
        if (json instanceof MonitorStep) {
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

        if(!json['defaultMonitorStatusId'] || !(json['defaultMonitorStatusId'] as JSONObject)['_type'] || (json['defaultMonitorStatusId'] as JSONObject)['_type'] !== 'ObjectID') {
            throw new BadDataException('Invalid default monitor status id');
        }

        this.data = {
            monitorDestination: monitorDestination || undefined,
            monitorCriteria: new MonitorCriteria().fromJSON(
                json['monitorCriteria'] as JSONObject
            ),
            requestType: (json['requestType'] as HTTPMethod) || HTTPMethod.GET,
            requestHeaders:
                (json['requestHeaders'] as Dictionary<string>) || undefined,
            requestBody: (json['requestBody'] as string) || undefined,
            defaultMonitorStatusId:
                new ObjectID((json['defaultMonitorStatusId'] as JSONObject)['value'] as string) || undefined,

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
