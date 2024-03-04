import { SeverityNumber } from '@opentelemetry/api-logs';
import OneUptimeTelemetry from './Telemetry';
import Exception from 'Common/Types/Exception/Exception';
import { JSONObject } from 'Common/Types/JSON';

export type LogBody = string | JSONObject | Exception | Error | unknown;

export default class logger {
    public static serializeLogBody(body: LogBody): string {
        if (typeof body === 'string') {
            return body;
        } else if (body instanceof Exception || body instanceof Error) {
            return body.message;
        }
        return JSON.stringify(body);
    }

    public static info(message: LogBody): void {
        this.emit({
            body: message,
            severityNumber: SeverityNumber.INFO,
        });
    }

    public static error(message: LogBody): void {
        this.emit({
            body: message,
            severityNumber: SeverityNumber.ERROR,
        });
    }

    public static warn(message: LogBody): void {
        this.emit({
            body: message,
            severityNumber: SeverityNumber.WARN,
        });
    }

    public static emit(data: {
        body: LogBody;
        severityNumber: SeverityNumber;
    }): void {
        OneUptimeTelemetry.getLogger().emit({
            body: this.serializeLogBody(data.body),
            severityNumber: data.severityNumber,
        });
    }
}
