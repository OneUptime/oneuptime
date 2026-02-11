import Dictionary from "Common/Types/Dictionary";

export interface DataTypeDocumentation {
  name: string;
  path: string;
  description: string;
}

export default class DataTypeUtil {
  public static getDataTypes(): Array<DataTypeDocumentation> {
    return [
      {
        name: "ObjectID",
        path: "object-id",
        description: "A unique identifier for objects, typically a UUID string.",
      },
      {
        name: "Decimal",
        path: "decimal",
        description: "A decimal number type for precise numeric values.",
      },
      {
        name: "Name",
        path: "name",
        description: "A structured name type representing a text name value.",
      },
      {
        name: "EqualTo",
        path: "equal-to",
        description:
          "A query filter that matches objects where a field is equal to the specified value.",
      },
      {
        name: "EqualToOrNull",
        path: "equal-to-or-null",
        description:
          "A query filter that matches objects where a field is equal to the specified value or is null.",
      },
      {
        name: "MonitorSteps",
        path: "monitor-steps",
        description:
          "Complex nested object describing monitor check configuration including steps and default status.",
      },
      {
        name: "MonitorStep",
        path: "monitor-step",
        description:
          "A single monitor step defining a check target, request configuration, and criteria for determining status.",
      },
      {
        name: "Recurring",
        path: "recurring",
        description:
          "Object describing a recurring interval schedule (e.g., every 5 minutes, daily).",
      },
      {
        name: "RestrictionTimes",
        path: "restriction-times",
        description:
          "Object describing on-call duty time restrictions (daily or weekly windows).",
      },
      {
        name: "MonitorCriteria",
        path: "monitor-criteria",
        description:
          "A collection of monitor criteria instances used to evaluate monitor check results.",
      },
      {
        name: "PositiveNumber",
        path: "positive-number",
        description: "A number type that must be greater than zero.",
      },
      {
        name: "MonitorCriteriaInstance",
        path: "monitor-criteria-instance",
        description:
          "A single criteria rule defining conditions and the resulting monitor status when conditions are met.",
      },
      {
        name: "NotEqual",
        path: "not-equal",
        description:
          "A query filter that matches objects where a field is not equal to the specified value.",
      },
      {
        name: "Email",
        path: "email",
        description:
          "An email address type with built-in format validation.",
      },
      {
        name: "Phone",
        path: "phone",
        description:
          "A phone number type with built-in format validation.",
      },
      {
        name: "Color",
        path: "color",
        description:
          "A color value represented as a hex string (e.g., #3498db).",
      },
      {
        name: "Domain",
        path: "domain",
        description: "A domain name type (e.g., example.com).",
      },
      {
        name: "Version",
        path: "version",
        description:
          "A semantic version type (e.g., 1.0.0).",
      },
      {
        name: "IP",
        path: "ip",
        description:
          "An IP address type supporting both IPv4 and IPv6 formats.",
      },
      {
        name: "Route",
        path: "route",
        description: "A URL route/path segment type.",
      },
      {
        name: "URL",
        path: "url",
        description: "A full URL type with protocol, host, and path.",
      },
      {
        name: "Permission",
        path: "permission",
        description:
          "A string identifier representing an access control permission in OneUptime.",
      },
      {
        name: "Search",
        path: "search",
        description:
          "A query filter for text search that matches objects containing the specified string.",
      },
      {
        name: "GreaterThan",
        path: "greater-than",
        description:
          "A query filter that matches objects where a field is greater than the specified value.",
      },
      {
        name: "GreaterThanOrEqual",
        path: "greater-than-or-equal",
        description:
          "A query filter that matches objects where a field is greater than or equal to the specified value.",
      },
      {
        name: "GreaterThanOrNull",
        path: "greater-than-or-null",
        description:
          "A query filter that matches objects where a field is greater than the specified value or is null.",
      },
      {
        name: "LessThanOrNull",
        path: "less-than-or-null",
        description:
          "A query filter that matches objects where a field is less than the specified value or is null.",
      },
      {
        name: "LessThan",
        path: "less-than",
        description:
          "A query filter that matches objects where a field is less than the specified value.",
      },
      {
        name: "LessThanOrEqual",
        path: "less-than-or-equal",
        description:
          "A query filter that matches objects where a field is less than or equal to the specified value.",
      },
      {
        name: "Port",
        path: "port",
        description: "A network port number type (1-65535).",
      },
      {
        name: "Hostname",
        path: "hostname",
        description: "A hostname type (e.g., api.example.com).",
      },
      {
        name: "HashedString",
        path: "hashed-string",
        description:
          "A string that is stored in hashed form. Used for sensitive data like passwords and API keys.",
      },
      {
        name: "DateTime",
        path: "date-time",
        description:
          "An ISO 8601 date-time string (e.g., 2024-01-15T10:30:00.000Z).",
      },
      {
        name: "Buffer",
        path: "buffer",
        description:
          "A binary data buffer, typically base64-encoded when serialized to JSON.",
      },
      {
        name: "InBetween",
        path: "in-between",
        description:
          "A query filter that matches objects where a field value is between two specified values (inclusive).",
      },
      {
        name: "NotNull",
        path: "not-null",
        description:
          "A query filter that matches objects where a field is not null.",
      },
      {
        name: "IsNull",
        path: "is-null",
        description:
          "A query filter that matches objects where a field is null.",
      },
      {
        name: "Includes",
        path: "includes",
        description:
          "A query filter that matches objects where a field value is included in the specified array of values.",
      },
      {
        name: "DashboardComponent",
        path: "dashboard-component",
        description:
          "A configuration object for a dashboard component including its type, layout, and settings.",
      },
      {
        name: "DashboardViewConfig",
        path: "dashboard-view-config",
        description:
          "A configuration object for a dashboard view including its components and layout.",
      },
    ];
  }

  public static getDataTypeDictionaryByPath(): Dictionary<DataTypeDocumentation> {
    const dict: Dictionary<DataTypeDocumentation> = {};

    for (const dataType of DataTypeUtil.getDataTypes()) {
      dict[dataType.path] = dataType;
    }

    return dict;
  }
}
