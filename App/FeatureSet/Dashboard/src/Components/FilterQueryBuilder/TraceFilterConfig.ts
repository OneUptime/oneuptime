import { FilterBuilderConfig } from "./Types";

function getSpanKindPillClass(value: string): string {
  const v: string = value.toUpperCase();
  if (v === "SPAN_KIND_SERVER") {
    return "bg-blue-50 text-blue-700 ring-blue-700/10";
  }
  if (v === "SPAN_KIND_CLIENT") {
    return "bg-purple-50 text-purple-700 ring-purple-700/10";
  }
  if (v === "SPAN_KIND_PRODUCER") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-700/10";
  }
  if (v === "SPAN_KIND_CONSUMER") {
    return "bg-teal-50 text-teal-700 ring-teal-700/10";
  }
  if (v === "SPAN_KIND_INTERNAL") {
    return "bg-gray-50 text-gray-700 ring-gray-500/10";
  }
  return "bg-gray-50 text-gray-600 ring-gray-500/10";
}

function getStatusCodePillClass(value: string): string {
  if (value === "2") {
    return "bg-red-50 text-red-700 ring-red-600/10";
  }
  if (value === "1") {
    return "bg-green-50 text-green-700 ring-green-600/10";
  }
  if (value === "0") {
    return "bg-gray-50 text-gray-600 ring-gray-500/10";
  }
  return "bg-gray-50 text-gray-600 ring-gray-500/10";
}

const TraceFilterConfig: FilterBuilderConfig = {
  entityNameSingular: "span",
  entityNamePlural: "spans",
  supportCustomAttributes: true,
  customAttributeLabel: "Custom Attribute...",
  customAttributeDescription: "Filter on a custom span attribute",
  defaultCondition: { field: "kind", operator: "=", value: "" },
  fields: [
    {
      key: "name",
      label: "Span Name",
      description: "The operation name on the span (e.g. GET /api/users)",
      valueType: "text",
      valuePlaceholder: "e.g. GET /api/users",
    },
    {
      key: "kind",
      label: "Span Kind",
      description: "The role of the span in a trace",
      valueType: "dropdown",
      valuePlaceholder: "Select span kind...",
      valueOptions: [
        {
          value: "SPAN_KIND_SERVER",
          label: "Server",
          description: "Inbound request handlers",
        },
        {
          value: "SPAN_KIND_CLIENT",
          label: "Client",
          description: "Outbound requests",
        },
        {
          value: "SPAN_KIND_PRODUCER",
          label: "Producer",
          description: "Publishes messages to a queue",
        },
        {
          value: "SPAN_KIND_CONSUMER",
          label: "Consumer",
          description: "Consumes messages from a queue",
        },
        {
          value: "SPAN_KIND_INTERNAL",
          label: "Internal",
          description: "Internal operation within a service",
        },
      ],
      getValuePillClass: getSpanKindPillClass,
    },
    {
      key: "statusCode",
      label: "Status",
      description: "OpenTelemetry span status",
      valueType: "dropdown",
      valuePlaceholder: "Select status...",
      valueOptions: [
        { value: "0", label: "Unset", description: "No status set" },
        { value: "1", label: "Ok", description: "Span completed successfully" },
        { value: "2", label: "Error", description: "Span ended in error" },
      ],
      getValuePillClass: getStatusCodePillClass,
    },
    {
      key: "statusMessage",
      label: "Status Message",
      description: "Optional text describing the span status",
      valueType: "text",
      valuePlaceholder: "e.g. Internal Error",
    },
    {
      key: "serviceId",
      label: "Service ID",
      description: "The telemetry service that produced the span",
      valueType: "text",
      valuePlaceholder: "Service ID",
    },
    {
      key: "hasException",
      label: "Has Exception",
      description: "Whether the span recorded an exception event",
      valueType: "dropdown",
      valuePlaceholder: "Select...",
      valueOptions: [
        { value: "true", label: "Yes", description: "Has an exception event" },
        {
          value: "false",
          label: "No",
          description: "No exception recorded",
        },
      ],
    },
    {
      key: "isRootSpan",
      label: "Is Root Span",
      description: "Whether this is the top-level span of a trace",
      valueType: "dropdown",
      valuePlaceholder: "Select...",
      valueOptions: [
        { value: "true", label: "Yes", description: "Root of the trace" },
        { value: "false", label: "No", description: "Child span" },
      ],
    },
  ],
};

export default TraceFilterConfig;
