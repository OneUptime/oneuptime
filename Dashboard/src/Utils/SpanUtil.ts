import {
    Black,
    Cyan500,
    Green500,
    Purple500,
    Red500,
    White,
    Yellow500,
} from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';
import Span, { SpanKind } from 'Model/AnalyticsModels/Span';

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

    public static getGanttChartBarColor(span: Span): {
        barColor: Color;
        titleColor: Color;
    } {
        if (span.kind === SpanKind.Server) {
            return {
                barColor: Green500,
                titleColor: White,
            };
        } else if (span.kind === SpanKind.Client) {
            return {
                barColor: Yellow500,
                titleColor: Black,
            };
        } else if (span.kind === SpanKind.Producer) {
            return {
                barColor: Purple500,
                titleColor: White,
            };
        } else if (span.kind === SpanKind.Consumer) {
            return {
                barColor: Cyan500,
                titleColor: White,
            };
        }
        return {
            barColor: Red500,
            titleColor: White,
        };
    }
}
