import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import Span, { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import DropdownUtil from "Common/UI/Utils/Dropdown";

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

  public static getSpanKindFriendlyName(spanKind: SpanKind): string {
    let spanKindText: string = "Internal"; // by default spans are always internal

    if (spanKind === SpanKind.Client) {
      spanKindText = "Client";
    } else if (spanKind === SpanKind.Server) {
      spanKindText = "Server";
    } else if (spanKind === SpanKind.Producer) {
      spanKindText = "Producer";
    } else if (spanKind === SpanKind.Consumer) {
      spanKindText = "Consumer";
    } else {
      spanKindText = "Internal";
    }

    return spanKindText;
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

  public static getGanttChartBarColor(data: {
    span: Span;
    telemetryServices: Array<Service>;
  }): {
    barColor: Color;
  } {
    const service: Service | undefined = data.telemetryServices.find(
      (service: Service) => {
        return service.id?.toString() === data.span.serviceId?.toString();
      },
    );

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
