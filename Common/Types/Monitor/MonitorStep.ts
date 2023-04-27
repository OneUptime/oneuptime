import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import { JSONObject, ObjectType } from '../JSON';
import URL from '../API/URL';
import IP from '../IP/IP';
import MonitorCriteria from './MonitorCriteria';
import BadDataException from '../Exception/BadDataException';
import HTTPMethod from '../API/HTTPMethod';
import Dictionary from '../Dictionary';
import ObjectID from '../ObjectID';
import MonitorType from './MonitorType';

export interface MonitorStepType {
    id: string;
    monitorDestination?: URL | IP | undefined;
    monitorCriteria: MonitorCriteria;
    requestType: HTTPMethod;
    requestHeaders?: Dictionary<string> | undefined;
    requestBody?: string | undefined;
}

export default class MonitorStep extends DatabaseProperty {
    public data: MonitorStepType | undefined = undefined;

    public constructor() {
        super();

        this.data = {
            id: ObjectID.generate().toString(),
            monitorDestination: undefined,
            monitorCriteria: new MonitorCriteria(),
            requestType: HTTPMethod.GET,
            requestHeaders: undefined,
            requestBody: undefined,
        };
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
        return MonitorStep.fromJSON(monitorStep.toJSON());
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
            _type: ObjectType.MonitorStep,
            value: {
                id: ObjectID.generate().toString(),
                monitorDestination: undefined,
                monitorCriteria: MonitorCriteria.getNewMonitorCriteriaAsJSON(),
                requestType: HTTPMethod.GET,
                requestHeaders: undefined,
                requestBody: undefined,
            },
        };
    }

    public static getValidationError(
        value: MonitorStep,
        monitorType: MonitorType
    ): string | null {
        if (!value.data) {
            return 'Monitor Step is required';
        }

        if (!value.data.monitorDestination) {
            return 'Monitor Destination is required';
        }

        if (!value.data.monitorCriteria) {
            return 'Monitor Criteria is required';
        }

        if (
            !MonitorCriteria.getValidationError(
                value.data.monitorCriteria,
                monitorType
            )
        ) {
            return MonitorCriteria.getValidationError(
                value.data.monitorCriteria,
                monitorType
            );
        }

        if (!value.data.requestType && monitorType === MonitorType.API) {
            return 'Request Type is required';
        }

        return null;
    }

    

    public override toJSON(): JSONObject {
        if (this.data) {
            return {
                _type: ObjectType.MonitorStep,
                value: {
                    id: this.data.id,
                    monitorDestination:
                        this.data?.monitorDestination?.toJSON() || undefined,
                    monitorCriteria: this.data.monitorCriteria.toJSON(),
                    requestType: this.data.requestType,
                    requestHeaders: this.data.requestHeaders || undefined,
                    requestBody: this.data.requestBody || undefined,
                   
                },
            };
        }

        return MonitorStep.getNewMonitorStepAsJSON();
    }

    public static override fromJSON(json: JSONObject): MonitorStep {
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

        const monitorStep: MonitorStep = new MonitorStep();

        monitorStep.data = {
            id: json['id'] as string,
            monitorDestination: monitorDestination || undefined,
            monitorCriteria: MonitorCriteria.fromJSON(
                json['monitorCriteria'] as JSONObject
            ),
            requestType: (json['requestType'] as HTTPMethod) || HTTPMethod.GET,
            requestHeaders:
                (json['requestHeaders'] as Dictionary<string>) || undefined,
            requestBody: (json['requestBody'] as string) || undefined,
           
        };

        return monitorStep;
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
            return MonitorStep.fromJSON(value);
        }

        return null;
    }

    public override toString(): string {
        return JSON.stringify(this.toJSON());
    }
}
