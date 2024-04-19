import { Black } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';
import Span, { SpanKind, SpanStatus } from 'Model/AnalyticsModels/Span';
import TelemetryService from 'Model/Models/TelemetryService';

export default class SpanUtil {
    public static getSpanKindFriendlyName(spanKind: SpanKind): string {
        let spanKindText: string = 'Internal'; // by default spans are always internal

        if (spanKind === SpanKind.Client) {
            spanKindText = 'Client';
        } else if (spanKind === SpanKind.Server) {
            spanKindText = 'Server';
        } else if (spanKind === SpanKind.Producer) {
            spanKindText = 'Producer';
        } else if (spanKind === SpanKind.Consumer) {
            spanKindText = 'Consumer';
        } else {
            spanKindText = 'Internal';
        }

        return spanKindText;
    }

    public static getSpanStatusCodeFriendlyName(
        statusCode: SpanStatus
    ): string {
        let statusCodeText: string = 'Unset'; // by default spans are always unset

        if (statusCode === SpanStatus.Ok) {
            statusCodeText = 'Ok';
        } else if (statusCode === SpanStatus.Error) {
            statusCodeText = 'Error';
        } else {
            statusCodeText = 'Unset';
        }

        return statusCodeText;
    }

    public static getGanttChartBarColor(data: {
        span: Span;
        telemetryServices: Array<TelemetryService>;
    }): {
        barColor: Color;
    } {
        const service: TelemetryService | undefined =
            data.telemetryServices.find((service: TelemetryService) => {
                return (
                    service.id?.toString() === data.span.serviceId?.toString()
                );
            });

        if (!service || !service.serviceColor) {
            return {
                barColor: Black,
            };
        }

        const barColor: Color = service.serviceColor;

        return {
            barColor,
        };
    }
}
