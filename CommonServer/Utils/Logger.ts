import { SeverityNumber } from '@opentelemetry/api-logs';
import OneUptimeTelemetry from './Telemetry';
import Exception from 'Common/Types/Exception/Exception';
import { JSONObject } from 'Common/Types/JSON';
import { ConfigLogLevel, LogLevel } from '../EnvironmentConfig';

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
        if (
            LogLevel === ConfigLogLevel.DEBUG ||
            LogLevel === ConfigLogLevel.INFO
        ) {
            // eslint-disable-next-line no-console
            console.info(message);

            this.emit({
                body: message,
                severityNumber: SeverityNumber.INFO,
            });
        }
    }

    public static error(message: LogBody): void {
        if (
            LogLevel === ConfigLogLevel.DEBUG ||
            LogLevel === ConfigLogLevel.INFO ||
            LogLevel === ConfigLogLevel.WARN ||
            LogLevel === ConfigLogLevel.ERROR
        ) {
            // eslint-disable-next-line no-console
            console.error(message);

            this.emit({
                body: message,
                severityNumber: SeverityNumber.ERROR,
            });
        }
    }

    public static warn(message: LogBody): void {
        if (
            LogLevel === ConfigLogLevel.DEBUG ||
            LogLevel === ConfigLogLevel.INFO ||
            LogLevel === ConfigLogLevel.WARN
        ) {
            // eslint-disable-next-line no-console
            console.warn(message);

            this.emit({
                body: message,
                severityNumber: SeverityNumber.WARN,
            });
        }
    }

    public static debug(message: LogBody): void {
        if (LogLevel === ConfigLogLevel.DEBUG) {
            // eslint-disable-next-line no-console
            console.debug(message);

            this.emit({
                body: message,
                severityNumber: SeverityNumber.DEBUG,
            });
        }
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
