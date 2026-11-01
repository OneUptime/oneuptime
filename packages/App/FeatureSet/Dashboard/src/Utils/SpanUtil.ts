import OneUptimeDate from "Common/Types/Date";
import { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

export enum IntervalUnit {
  Nanoseconds = "ns",
  Microseconds = "μs",
  Milliseconds = "ms",
  Seconds = "s",
}

export interface DivisibilityFactor {
  divisibilityFactorNumber: number;
  intervalUnit: IntervalUnit;
}

/*
 * What OpenTelemetry's span kinds are called, by the value a span stores: keys
 * of the Dashboard's locales. Every screen that names a kind reads it here, so
 * a language words each one once. The `kind:server` search term stays English.
 */
const SPAN_KIND_NAMES: Record<SpanKind, string> = {
  [SpanKind.Server]: translationKey("Server"),
  [SpanKind.Client]: translationKey("Client"),
  [SpanKind.Producer]: translationKey("Producer"),
  [SpanKind.Consumer]: translationKey("Consumer"),
  [SpanKind.Internal]: translationKey("Internal"),
};

export default class SpanUtil {
  public static getSpanStatusText(status: SpanStatus): string {
    switch (status) {
      case SpanStatus.Ok:
        return "Ok";
      case SpanStatus.Error:
        return "Error";
      default:
        return "Unset";
    }
  }

  public static getSpanStatusDropdownOptions(): Array<DropdownOption> {
    const options: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEnum(SpanStatus, true);
    return options;
  }

  public static getSpanKindDropdownOptions(): Array<DropdownOption> {
    const spanKindDropdownOptions: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEnum(SpanKind, true);
    return spanKindDropdownOptions;
  }

  public static getSpanDurationAsString(data: {
    divisibilityFactor: DivisibilityFactor;
    spanDurationInUnixNano: number;
  }): string {
    const { spanDurationInUnixNano } = data;

    if (!spanDurationInUnixNano) {
      return "0 ms";
    }

    return OneUptimeDate.getHumanizedDurationFromNanoseconds({
      nanoseconds: spanDurationInUnixNano,
    });
  }

  public static getSpanStartsAtAsString(data: {
    divisibilityFactor: DivisibilityFactor;
    timelineStartTimeUnixNano: number;
    spanStartTimeUnixNano: number;
  }): string {
    const {
      divisibilityFactor,
      timelineStartTimeUnixNano,
      spanStartTimeUnixNano,
    } = data;

    return `${Math.round(
      (spanStartTimeUnixNano! - timelineStartTimeUnixNano) /
        divisibilityFactor.divisibilityFactorNumber,
    )} ${divisibilityFactor.intervalUnit}`;
  }

  public static getSpanEventTimeAsString(data: {
    divisibilityFactor: DivisibilityFactor;
    timelineStartTimeUnixNano: number;
    spanEventTimeUnixNano: number;
  }): string {
    const {
      divisibilityFactor,
      timelineStartTimeUnixNano,
      spanEventTimeUnixNano,
    } = data;

    return `${Math.round(
      (spanEventTimeUnixNano! - timelineStartTimeUnixNano) /
        divisibilityFactor.divisibilityFactorNumber,
    )} ${divisibilityFactor.intervalUnit}`;
  }

  public static getSpanEndsAtAsString(data: {
    divisibilityFactor: DivisibilityFactor;
    timelineStartTimeUnixNano: number;
    spanEndTimeUnixNano: number;
  }): string {
    const {
      divisibilityFactor,
      timelineStartTimeUnixNano,
      spanEndTimeUnixNano,
    } = data;

    return `${Math.round(
      (spanEndTimeUnixNano! - timelineStartTimeUnixNano) /
        divisibilityFactor.divisibilityFactorNumber,
    )} ${divisibilityFactor.intervalUnit}`;
  }

  /*
   * A kind's name, in the reader's language with their translator and in
   * English without one. By default spans are always internal.
   */
  public static getSpanKindFriendlyName(
    spanKind: SpanKind,
    translator?: Translator | undefined,
  ): string {
    const name: string =
      SPAN_KIND_NAMES[spanKind] || SPAN_KIND_NAMES[SpanKind.Internal];

    return translator ? translator.translateTerm(name) : name;
  }

  // Each kind's name, keyed by the value a span stores: a facet's labels.
  public static getSpanKindNameMap(
    translator?: Translator | undefined,
  ): Record<string, string> {
    const names: Record<string, string> = {};

    for (const spanKind of Object.values(SpanKind)) {
      names[spanKind] = SpanUtil.getSpanKindFriendlyName(spanKind, translator);
    }

    return names;
  }

  public static getDivisibilityFactor(
    totalTimelineTimeInUnixNano: number,
  ): DivisibilityFactor {
    let intervalUnit: IntervalUnit = IntervalUnit.Milliseconds;
    let divisibilityFactorNumber: number = 1000; // default is in milliseconds

    if (totalTimelineTimeInUnixNano < 1000) {
      intervalUnit = IntervalUnit.Nanoseconds;
      divisibilityFactorNumber = 1; // this is in nanoseconds
    } else if (totalTimelineTimeInUnixNano < 1000000) {
      intervalUnit = IntervalUnit.Microseconds;
      divisibilityFactorNumber = 1000; // this is in microseconds
    } else if (totalTimelineTimeInUnixNano < 1000000000) {
      intervalUnit = IntervalUnit.Milliseconds;
      divisibilityFactorNumber = 1000000; // this is in microseconds
    } else if (totalTimelineTimeInUnixNano < 1000000000000) {
      intervalUnit = IntervalUnit.Seconds;
      divisibilityFactorNumber = 1000000000; // this is in seconds
    }

    return {
      divisibilityFactorNumber: divisibilityFactorNumber,
      intervalUnit: intervalUnit,
    };
  }

  public static getSpanStatusCodeFriendlyName(statusCode: SpanStatus): string {
    let statusCodeText: string = "Unset"; // by default spans are always unset

    if (statusCode === SpanStatus.Ok) {
      statusCodeText = "Ok";
    } else if (statusCode === SpanStatus.Error) {
      statusCodeText = "Error";
    } else {
      statusCodeText = "Unset";
    }

    return statusCodeText;
  }
}
