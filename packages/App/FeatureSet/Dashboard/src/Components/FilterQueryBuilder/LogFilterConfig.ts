import { FilterBuilderConfig, FilterFieldValueOption } from "./Types";
import LogSeverity, {
  normalizeLogSeverity,
} from "Common/Types/Log/LogSeverity";

const DEFAULT_PILL_CLASS: string = "bg-gray-50 text-gray-600 ring-gray-500/10";

const SEVERITY_PILL_CLASS: Record<LogSeverity, string> = {
  [LogSeverity.Fatal]: "bg-red-100 text-red-800 ring-red-600/20",
  [LogSeverity.Error]: "bg-red-50 text-red-700 ring-red-600/10",
  [LogSeverity.Warning]: "bg-amber-50 text-amber-700 ring-amber-600/10",
  [LogSeverity.Information]: "bg-blue-50 text-blue-700 ring-blue-700/10",
  [LogSeverity.Debug]: DEFAULT_PILL_CLASS,
  [LogSeverity.Trace]: "bg-gray-50 text-gray-500 ring-gray-500/10",
  [LogSeverity.Unspecified]: DEFAULT_PILL_CLASS,
};

/*
 * Normalised rather than matched on the raw string so that filters saved before
 * the dropdown was fixed — which hold "INFO", "WARNING" and friends — still get
 * their colour. Those filters match no rows, but a colourless pill would hide
 * that they are severity filters at all.
 */
function getSeverityPillClass(value: string): string {
  const severity: LogSeverity | null = normalizeLogSeverity(value);
  return severity ? SEVERITY_PILL_CLASS[severity] : DEFAULT_PILL_CLASS;
}

/*
 * Ordered loudest-first, the way the Logs view lists them.
 *
 * These are the exact strings stored on a log row. They must stay that way:
 * ingest re-derives severityText from severityNumber into these seven enum
 * members, and the filter evaluator compares `=` and `IN` case-sensitively. An
 * option of "INFO" or "Info" therefore matches nothing, silently, forever —
 * which is what this dropdown used to emit.
 */
const severityValueOptions: Array<FilterFieldValueOption> = [
  LogSeverity.Fatal,
  LogSeverity.Error,
  LogSeverity.Warning,
  LogSeverity.Information,
  LogSeverity.Debug,
  LogSeverity.Trace,
  LogSeverity.Unspecified,
].map((severity: LogSeverity) => {
  return { value: severity, label: severity };
});

const LogFilterConfig: FilterBuilderConfig = {
  entityNameSingular: "log",
  entityNamePlural: "logs",
  supportCustomAttributes: true,
  customAttributeLabel: "Custom Attribute...",
  customAttributeDescription: "Filter on a custom log attribute",
  defaultCondition: { field: "severityText", operator: "=", value: "" },
  fields: [
    {
      key: "severityText",
      label: "Severity",
      description: "Log severity level (e.g. Error, Warning, Information)",
      valueType: "dropdown",
      valuePlaceholder: "Select severity...",
      valueOptions: severityValueOptions,
      getValuePillClass: getSeverityPillClass,
    },
    {
      key: "body",
      label: "Log Body",
      description: "The log message content",
      valueType: "text",
      valuePlaceholder: "Enter text to match...",
    },
    {
      key: "primaryEntityId",
      label: "Service ID",
      description: "The service that produced the log",
      valueType: "text",
      valuePlaceholder: "Service ID",
    },
  ],
};

export default LogFilterConfig;
