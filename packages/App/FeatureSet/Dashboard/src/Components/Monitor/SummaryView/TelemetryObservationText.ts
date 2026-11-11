import TelemetryObservation, {
  TelemetryObservationKind,
} from "Common/Types/Monitor/TelemetryObservation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a telemetry monitor's check saw, as one line in the reader's
 * language: "12 logs", "3 series", "No data". Shared by the Observed column
 * of Monitoring Logs, its CSV export and the row's View Summary, so the
 * three always say the same. Every count is a whole sentence of its own
 * (translatePlural), never a number glued to a translated noun.
 */
export const getTelemetryObservationText: (
  translator: Translator,
  observation: TelemetryObservation,
) => string = (
  translator: Translator,
  observation: TelemetryObservation,
): string => {
  const count: number = observation.count;

  switch (observation.kind) {
    case TelemetryObservationKind.Logs:
      return translator.translatePlural(
        { one: "{{count}} log", other: "{{count}} logs" },
        count,
      );
    case TelemetryObservationKind.Spans:
      return translator.translatePlural(
        { one: "{{count}} span", other: "{{count}} spans" },
        count,
      );
    case TelemetryObservationKind.Exceptions:
      return translator.translatePlural(
        { one: "{{count}} exception", other: "{{count}} exceptions" },
        count,
      );
    case TelemetryObservationKind.Profiles:
      return translator.translatePlural(
        { one: "{{count}} profile", other: "{{count}} profiles" },
        count,
      );
    case TelemetryObservationKind.SecurityEvents:
      return translator.translatePlural(
        {
          one: "{{count}} security event",
          other: "{{count}} security events",
        },
        count,
      );
    case TelemetryObservationKind.BadAiAnswers:
      return translator.translatePlural(
        { one: "{{count}} bad AI answer", other: "{{count}} bad AI answers" },
        count,
      );
    case TelemetryObservationKind.MetricSeries:
      return translator.translatePlural(
        { one: "{{count}} series", other: "{{count}} series" },
        count,
      );
    case TelemetryObservationKind.MetricDataPoints:
      return translator.translatePlural(
        { one: "{{count}} data point", other: "{{count}} data points" },
        count,
      );
    case TelemetryObservationKind.NoMetricData:
      return translator.translateText("No data") || "No data";
  }
};
