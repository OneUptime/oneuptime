import { Black, White } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';
import Span, { SpanKind } from 'Model/AnalyticsModels/Span';
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

    public static getGanttChartBarColor(data: {
        span: Span;
        telemetryServices: Array<TelemetryService>;
    }): {
        barColor: Color;
        titleColor: Color;
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
                titleColor: White,
            };
        }

        const barColor: Color = service.serviceColor;
        const titleColor: Color = Color.shouldUseDarkText(barColor)
            ? White
            : Black;

        return {
            barColor,
            titleColor,
        };
    }
}
