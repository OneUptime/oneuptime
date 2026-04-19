import { FilterBuilderConfig } from "./Types";

function getSeverityPillClass(value: string): string {
  const v: string = value.toUpperCase();
  if (v === "FATAL") {
    return "bg-red-100 text-red-800 ring-red-600/20";
  }
  if (v === "ERROR") {
    return "bg-red-50 text-red-700 ring-red-600/10";
  }
  if (v === "WARNING") {
    return "bg-amber-50 text-amber-700 ring-amber-600/10";
  }
  if (v === "INFO") {
    return "bg-blue-50 text-blue-700 ring-blue-700/10";
  }
  if (v === "DEBUG") {
    return "bg-gray-50 text-gray-600 ring-gray-500/10";
  }
  if (v === "TRACE") {
    return "bg-gray-50 text-gray-500 ring-gray-500/10";
  }
  return "bg-gray-50 text-gray-600 ring-gray-500/10";
}

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
      description: "Log severity level (e.g. ERROR, WARNING, INFO)",
      valueType: "dropdown",
      valuePlaceholder: "Select severity...",
      valueOptions: [
        { value: "TRACE", label: "TRACE" },
        { value: "DEBUG", label: "DEBUG" },
        { value: "INFO", label: "INFO" },
        { value: "WARNING", label: "WARNING" },
        { value: "ERROR", label: "ERROR" },
        { value: "FATAL", label: "FATAL" },
      ],
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
      key: "serviceId",
      label: "Service ID",
      description: "The service that produced the log",
      valueType: "text",
      valuePlaceholder: "Service ID",
    },
  ],
};

export default LogFilterConfig;
