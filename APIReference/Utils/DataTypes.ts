import Dictionary from "Common/Types/Dictionary";

export interface DataTypeDocumentation {
  name: string;
  path: string;
  description: string;
  /*
   * Additional column type display strings that should link to this data type page.
   * Used for cases where the TableColumnType enum value doesn't match the PascalCase name
   * (e.g., enum "Date" should link to the "DateTime" data type page).
   */
  columnTypeAliases?: Array<string>;
}

export default class DataTypeUtil {
  public static getDataTypes(): Array<DataTypeDocumentation> {
    return [
      {
        name: "ObjectID",
        path: "object-id",
        description:
          "A unique identifier for objects, typically a UUID string.",
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
        columnTypeAliases: ["Small Positive Number", "Big Positive Number"],
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
        description: "An email address type with built-in format validation.",
      },
      {
        name: "Phone",
        path: "phone",
        description: "A phone number type with built-in format validation.",
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
        description: "A semantic version type (e.g., 1.0.0).",
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
        columnTypeAliases: ["Date"],
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
      {
        name: "CriteriaFilter",
        path: "criteria-filter",
        description:
          "A single filter condition within a MonitorCriteriaInstance that defines what to check and how to compare it.",
      },
      {
        name: "CriteriaIncident",
        path: "criteria-incident",
        description:
          "Configuration for an incident that is automatically created when a MonitorCriteriaInstance's conditions are met.",
      },
      {
        name: "CriteriaAlert",
        path: "criteria-alert",
        description:
          "Configuration for an alert that is automatically created when a MonitorCriteriaInstance's conditions are met.",
      },
      {
        name: "CheckOn",
        path: "check-on",
        description:
          "Enum specifying what aspect of a monitor response to evaluate (e.g., response code, response time, body content).",
      },
      {
        name: "FilterType",
        path: "filter-type",
        description:
          "Enum specifying the comparison operator used in a CriteriaFilter (e.g., Equal To, Greater Than, Contains).",
      },
      {
        name: "FilterCondition",
        path: "filter-condition",
        description:
          "Enum specifying how multiple filters are combined: 'All' (AND) or 'Any' (OR).",
      },
      {
        name: "MonitorStepLogMonitor",
        path: "monitor-step-log-monitor",
        description:
          "Configuration for a Log monitor step, defining which logs to query and evaluate.",
      },
      {
        name: "MonitorStepTraceMonitor",
        path: "monitor-step-trace-monitor",
        description:
          "Configuration for a Trace monitor step, defining which spans to query and evaluate.",
      },
      {
        name: "MonitorStepMetricMonitor",
        path: "monitor-step-metric-monitor",
        description:
          "Configuration for a Metric monitor step, defining which metrics to query and evaluate.",
      },
      {
        name: "MonitorStepSnmpMonitor",
        path: "monitor-step-snmp-monitor",
        description:
          "Configuration for an SNMP monitor step, defining the SNMP device connection and OIDs to query.",
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

  /*
   * Convert PascalCase name to space-separated display string.
   * e.g., "ObjectID" → "Object ID", "MonitorSteps" → "Monitor Steps",
   *        "HashedString" → "Hashed String", "IP" → "IP"
   */
  private static pascalCaseToDisplayString(name: string): string {
    return name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  }

  /*
   * Build a mapping from column type display strings to data type page paths.
   * Automatically derives both PascalCase and display-string variants from each
   * data type's name, so adding a new entry to getDataTypes() is all that's needed.
   */
  public static getTypeToDocPathMap(): Dictionary<string> {
    const map: Dictionary<string> = {};

    for (const dt of DataTypeUtil.getDataTypes()) {
      // Map PascalCase name: "ObjectID" → "object-id"
      map[dt.name] = dt.path;

      // Map display string: "Object ID" → "object-id"
      const displayName: string = DataTypeUtil.pascalCaseToDisplayString(
        dt.name,
      );
      if (displayName !== dt.name) {
        map[displayName] = dt.path;
      }

      // Map any explicit aliases (for edge cases like enum "Date" → "date-time")
      if (dt.columnTypeAliases) {
        for (const alias of dt.columnTypeAliases) {
          map[alias] = dt.path;
        }
      }
    }

    return map;
  }
}
