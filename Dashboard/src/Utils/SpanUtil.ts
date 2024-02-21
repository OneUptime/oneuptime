import {
    Black,
    Cyan,
    Green,
    Purple,
    Red,
    White,
    Yellow,
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
                barColor: Green,
                titleColor: White,
            };
        } else if (span.kind === SpanKind.Client) {
            return {
                barColor: Yellow,
                titleColor: Black,
            };
        } else if (span.kind === SpanKind.Producer) {
            return {
                barColor: Purple,
                titleColor: White,
            };
        } else if (span.kind === SpanKind.Consumer) {
            return {
                barColor: Cyan,
                titleColor: White,
            };
        }
        return {
            barColor: Red,
            titleColor: White,
        };
    }
}
