import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import Dictionary from "Common/Types/Dictionary";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const DataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();

interface DataTypeProperty {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface DataTypeValue {
  value: string;
  description: string;
}

interface DataTypePageData {
  title: string;
  description: string;
  isEnum: boolean;
  properties: Array<DataTypeProperty>;
  values: Array<DataTypeValue>;
  jsonExample: string;
}

// Detailed documentation for each data type, keyed by path
const dataTypeDetails: Dictionary<DataTypePageData> = {
  "object-id": {
    title: "ObjectID",
    description:
      "A unique identifier for objects, typically a UUID string.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string (UUID)",
        required: true,
        description:
          "A UUID v4 string uniquely identifying the object (e.g., 550e8400-e29b-41d4-a716-446655440000).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "ObjectID", value: "550e8400-e29b-41d4-a716-446655440000" },
      null,
      2,
    ),
  },
  decimal: {
    title: "Decimal",
    description: "A decimal number type for precise numeric values.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "number",
        required: true,
        description: "A decimal number value (e.g., 99.99).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Decimal", value: 99.99 },
      null,
      2,
    ),
  },
  name: {
    title: "Name",
    description: "A structured name type representing a text name value.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string",
        required: true,
        description: "The name string value.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Name", value: "My Resource Name" },
      null,
      2,
    ),
  },
  "equal-to": {
    title: "EqualTo",
    description:
      "A query filter that matches objects where a field is equal to the specified value.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string | number | boolean",
        required: true,
        description: "The value to compare against for equality.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "EqualTo", value: "some-value" },
      null,
      2,
    ),
  },
  "equal-to-or-null": {
    title: "EqualToOrNull",
    description:
      "A query filter that matches objects where a field is equal to the specified value or is null.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string | number | boolean",
        required: true,
        description:
          "The value to compare against. Matches if the field equals this value OR is null.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "EqualToOrNull", value: "some-value" },
      null,
      2,
    ),
  },
  "monitor-steps": {
    title: "MonitorSteps",
    description:
      "Complex nested object describing monitor check configuration including steps and default status.",
    isEnum: false,
    properties: [
      {
        name: "monitorStepsInstanceArray",
        type: "Array<MonitorStep>",
        required: true,
        description:
          "An array of MonitorStep objects. Each MonitorStep defines a check target (URL, IP, hostname, etc.), request configuration, and criteria for determining monitor status based on the response.",
      },
      {
        name: "defaultMonitorStatusId",
        type: "ObjectID",
        required: true,
        description:
          "The ID of the monitor status to use as the default when no criteria match. This is typically the 'Operational' or 'Online' status.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        _type: "MonitorSteps",
        value: {
          monitorStepsInstanceArray: [
            {
              _type: "MonitorStep",
              value: {
                id: "550e8400-e29b-41d4-a716-446655440000",
                monitorDestination: {
                  _type: "URL",
                  value: "https://example.com",
                },
                monitorCriteria: {
                  monitorCriteriaInstanceArray: [],
                },
              },
            },
          ],
          defaultMonitorStatusId: "660e8400-e29b-41d4-a716-446655440001",
        },
      },
      null,
      2,
    ),
  },
  "monitor-step": {
    title: "MonitorStep",
    description:
      "A single monitor step defining a check target, request configuration, and criteria for determining status.",
    isEnum: false,
    properties: [
      {
        name: "id",
        type: "string (UUID)",
        required: true,
        description: "Unique identifier for this monitor step.",
      },
      {
        name: "monitorDestination",
        type: "URL | IP | Hostname",
        required: true,
        description:
          "The target to monitor. Can be a URL, IP address, or hostname depending on the monitor type.",
      },
      {
        name: "monitorCriteria",
        type: "MonitorCriteria",
        required: true,
        description:
          "The criteria used to evaluate the monitor check result and determine the resulting monitor status.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        _type: "MonitorStep",
        value: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          monitorDestination: {
            _type: "URL",
            value: "https://example.com",
          },
          monitorCriteria: {
            monitorCriteriaInstanceArray: [],
          },
        },
      },
      null,
      2,
    ),
  },
  recurring: {
    title: "Recurring",
    description:
      "Object describing a recurring interval schedule (e.g., every 5 minutes, daily).",
    isEnum: false,
    properties: [
      {
        name: "intervalType",
        type: "EventInterval (enum)",
        required: true,
        description:
          "The unit of the interval. Possible values: Hour, Day, Week, Month, Year.",
      },
      {
        name: "intervalCount",
        type: "PositiveNumber",
        required: true,
        description:
          "How many units between each recurrence. For example, intervalCount=2 with intervalType=Day means every 2 days.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        _type: "Recurring",
        value: {
          intervalType: "Day",
          intervalCount: { _type: "PositiveNumber", value: 1 },
        },
      },
      null,
      2,
    ),
  },
  "restriction-times": {
    title: "RestrictionTimes",
    description:
      "Object describing on-call duty time restrictions (daily or weekly windows).",
    isEnum: false,
    properties: [
      {
        name: "restrictionType",
        type: "RestrictionType (enum)",
        required: true,
        description:
          "The type of restriction. Possible values: None, Daily, Weekly. 'None' means the policy is always active.",
      },
      {
        name: "dayRestrictionTimes",
        type: "StartAndEndTime | null",
        required: false,
        description:
          "For Daily restriction type. An object with startTime (HH:MM) and endTime (HH:MM) defining the active window each day.",
      },
      {
        name: "weeklyRestrictionTimes",
        type: "Array<WeeklyRestriction>",
        required: false,
        description:
          "For Weekly restriction type. An array of objects each specifying a startDay, startTime, endDay, and endTime.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        _type: "RestrictionTimes",
        value: {
          restrictionType: "Daily",
          dayRestrictionTimes: { startTime: "09:00", endTime: "17:00" },
          weeklyRestrictionTimes: null,
        },
      },
      null,
      2,
    ),
  },
  "monitor-criteria": {
    title: "MonitorCriteria",
    description:
      "A collection of monitor criteria instances used to evaluate monitor check results.",
    isEnum: false,
    properties: [
      {
        name: "monitorCriteriaInstanceArray",
        type: "Array<MonitorCriteriaInstance>",
        required: true,
        description:
          "An array of MonitorCriteriaInstance objects. Each instance defines a set of conditions and the resulting monitor status when those conditions are met.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        _type: "MonitorCriteria",
        value: {
          monitorCriteriaInstanceArray: [],
        },
      },
      null,
      2,
    ),
  },
  "positive-number": {
    title: "PositiveNumber",
    description: "A number type that must be greater than zero.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "number",
        required: true,
        description: "A positive number value (must be > 0).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "PositiveNumber", value: 5 },
      null,
      2,
    ),
  },
  "monitor-criteria-instance": {
    title: "MonitorCriteriaInstance",
    description:
      "A single criteria rule defining conditions and the resulting monitor status when conditions are met.",
    isEnum: false,
    properties: [
      {
        name: "id",
        type: "string (UUID)",
        required: true,
        description: "Unique identifier for this criteria instance.",
      },
      {
        name: "monitorStatusId",
        type: "ObjectID",
        required: true,
        description:
          "The monitor status to set when this criteria's conditions are met.",
      },
      {
        name: "filterCondition",
        type: "FilterCondition (enum)",
        required: true,
        description:
          "How to combine multiple filters. Possible values: All (AND logic), Any (OR logic).",
      },
      {
        name: "filters",
        type: "Array<CriteriaFilter>",
        required: true,
        description:
          "An array of filter objects that define the conditions to check (e.g., response status code, body content, response time).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        _type: "MonitorCriteriaInstance",
        value: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          monitorStatusId: "660e8400-e29b-41d4-a716-446655440001",
          filterCondition: "All",
          filters: [],
        },
      },
      null,
      2,
    ),
  },
  "not-equal": {
    title: "NotEqual",
    description:
      "A query filter that matches objects where a field is not equal to the specified value.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string | number | boolean",
        required: true,
        description: "The value to compare against for inequality.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "NotEqual", value: "excluded-value" },
      null,
      2,
    ),
  },
  email: {
    title: "Email",
    description: "An email address type with built-in format validation.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string",
        required: true,
        description:
          "A valid email address string (e.g., user@example.com).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Email", value: "user@example.com" },
      null,
      2,
    ),
  },
  phone: {
    title: "Phone",
    description: "A phone number type with built-in format validation.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string",
        required: true,
        description:
          "A valid phone number string (e.g., +1-555-123-4567).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Phone", value: "+1-555-123-4567" },
      null,
      2,
    ),
  },
  color: {
    title: "Color",
    description: "A color value represented as a hex string (e.g., #3498db).",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string",
        required: true,
        description: "A hex color string (e.g., #3498db).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Color", value: "#3498db" },
      null,
      2,
    ),
  },
  domain: {
    title: "Domain",
    description: "A domain name type (e.g., example.com).",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string",
        required: true,
        description: "A valid domain name string (e.g., example.com).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Domain", value: "example.com" },
      null,
      2,
    ),
  },
  version: {
    title: "Version",
    description: "A semantic version type (e.g., 1.0.0).",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string",
        required: true,
        description:
          "A semantic version string following the format MAJOR.MINOR.PATCH (e.g., 1.0.0).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Version", value: "1.0.0" },
      null,
      2,
    ),
  },
  ip: {
    title: "IP",
    description: "An IP address type supporting both IPv4 and IPv6 formats.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string",
        required: true,
        description:
          "A valid IPv4 or IPv6 address string (e.g., 192.168.1.1 or ::1).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "IP", value: "192.168.1.1" },
      null,
      2,
    ),
  },
  route: {
    title: "Route",
    description: "A URL route/path segment type.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string",
        required: true,
        description: "A URL path segment (e.g., /api/v1/monitors).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Route", value: "/api/v1/monitors" },
      null,
      2,
    ),
  },
  url: {
    title: "URL",
    description: "A full URL type with protocol, host, and path.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string",
        required: true,
        description:
          "A valid URL string with protocol (e.g., https://example.com/api).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "URL", value: "https://example.com/api" },
      null,
      2,
    ),
  },
  permission: {
    title: "Permission",
    description:
      "A string identifier representing an access control permission in OneUptime. Permissions are assigned to API keys and team members to control what actions they can perform.",
    isEnum: false,
    properties: [
      {
        name: "permission",
        type: "string",
        required: true,
        description:
          "A permission string like 'ProjectOwner', 'ProjectMember', 'CanReadMonitor', 'CanEditIncident', etc. Each resource in the API reference shows which permissions are needed for each operation.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      [
        "ProjectOwner",
        "ProjectMember",
        "CanReadMonitor",
        "CanEditMonitor",
        "CanDeleteMonitor",
      ],
      null,
      2,
    ),
  },
  search: {
    title: "Search",
    description:
      "A query filter for text search that matches objects containing the specified string.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string",
        required: true,
        description:
          "The search string. Matches objects where the field contains this text.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Search", value: "search term" },
      null,
      2,
    ),
  },
  "greater-than": {
    title: "GreaterThan",
    description:
      "A query filter that matches objects where a field is greater than the specified value.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string | number | Date",
        required: true,
        description: "The value to compare against.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "GreaterThan", value: 100 },
      null,
      2,
    ),
  },
  "greater-than-or-equal": {
    title: "GreaterThanOrEqual",
    description:
      "A query filter that matches objects where a field is greater than or equal to the specified value.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string | number | Date",
        required: true,
        description: "The value to compare against.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "GreaterThanOrEqual", value: 100 },
      null,
      2,
    ),
  },
  "greater-than-or-null": {
    title: "GreaterThanOrNull",
    description:
      "A query filter that matches objects where a field is greater than the specified value or is null.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string | number | Date",
        required: true,
        description:
          "The value to compare against. Matches if the field is greater than this value OR is null.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "GreaterThanOrNull", value: 100 },
      null,
      2,
    ),
  },
  "less-than-or-null": {
    title: "LessThanOrNull",
    description:
      "A query filter that matches objects where a field is less than the specified value or is null.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string | number | Date",
        required: true,
        description:
          "The value to compare against. Matches if the field is less than this value OR is null.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "LessThanOrNull", value: 100 },
      null,
      2,
    ),
  },
  "less-than": {
    title: "LessThan",
    description:
      "A query filter that matches objects where a field is less than the specified value.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string | number | Date",
        required: true,
        description: "The value to compare against.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "LessThan", value: 100 },
      null,
      2,
    ),
  },
  "less-than-or-equal": {
    title: "LessThanOrEqual",
    description:
      "A query filter that matches objects where a field is less than or equal to the specified value.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string | number | Date",
        required: true,
        description: "The value to compare against.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "LessThanOrEqual", value: 100 },
      null,
      2,
    ),
  },
  port: {
    title: "Port",
    description: "A network port number type (1-65535).",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "number",
        required: true,
        description: "A valid port number between 1 and 65535.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Port", value: 443 },
      null,
      2,
    ),
  },
  hostname: {
    title: "Hostname",
    description: "A hostname type (e.g., api.example.com).",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string",
        required: true,
        description: "A valid hostname string (e.g., api.example.com).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Hostname", value: "api.example.com" },
      null,
      2,
    ),
  },
  "hashed-string": {
    title: "HashedString",
    description:
      "A string that is stored in hashed form. Used for sensitive data like passwords and API keys.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string",
        required: true,
        description:
          "The plain-text value to be hashed before storage. On read, returns the hashed form.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "HashedString", value: "my-secret-value" },
      null,
      2,
    ),
  },
  "date-time": {
    title: "DateTime",
    description:
      "An ISO 8601 date-time string (e.g., 2024-01-15T10:30:00.000Z).",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string (ISO 8601)",
        required: true,
        description:
          "An ISO 8601 formatted date-time string (e.g., 2024-01-15T10:30:00.000Z).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "DateTime", value: "2024-01-15T10:30:00.000Z" },
      null,
      2,
    ),
  },
  buffer: {
    title: "Buffer",
    description:
      "A binary data buffer, typically base64-encoded when serialized to JSON.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "string (base64)",
        required: true,
        description:
          "Base64-encoded binary data.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Buffer", value: "SGVsbG8gV29ybGQ=" },
      null,
      2,
    ),
  },
  "in-between": {
    title: "InBetween",
    description:
      "A query filter that matches objects where a field value is between two specified values (inclusive).",
    isEnum: false,
    properties: [
      {
        name: "startValue",
        type: "string | number | Date",
        required: true,
        description: "The lower bound of the range (inclusive).",
      },
      {
        name: "endValue",
        type: "string | number | Date",
        required: true,
        description: "The upper bound of the range (inclusive).",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        _type: "InBetween",
        value: {
          startValue: "2024-01-01T00:00:00.000Z",
          endValue: "2024-12-31T23:59:59.999Z",
        },
      },
      null,
      2,
    ),
  },
  "not-null": {
    title: "NotNull",
    description:
      "A query filter that matches objects where a field is not null.",
    isEnum: false,
    properties: [],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "NotNull", value: true },
      null,
      2,
    ),
  },
  "is-null": {
    title: "IsNull",
    description:
      "A query filter that matches objects where a field is null.",
    isEnum: false,
    properties: [],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "IsNull", value: true },
      null,
      2,
    ),
  },
  includes: {
    title: "Includes",
    description:
      "A query filter that matches objects where a field value is included in the specified array of values.",
    isEnum: false,
    properties: [
      {
        name: "value",
        type: "Array<string | number>",
        required: true,
        description:
          "An array of values. Matches if the field value is one of these values.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      { _type: "Includes", value: ["value1", "value2", "value3"] },
      null,
      2,
    ),
  },
  "dashboard-component": {
    title: "DashboardComponent",
    description:
      "A configuration object for a dashboard component including its type, layout, and settings.",
    isEnum: false,
    properties: [
      {
        name: "componentId",
        type: "ObjectID",
        required: true,
        description: "Unique identifier for this dashboard component.",
      },
      {
        name: "componentType",
        type: "string",
        required: true,
        description:
          "The type of component (e.g., Chart, Value, Table).",
      },
      {
        name: "widthInDashboardUnits",
        type: "number",
        required: true,
        description: "Width of the component in dashboard grid units.",
      },
      {
        name: "heightInDashboardUnits",
        type: "number",
        required: true,
        description: "Height of the component in dashboard grid units.",
      },
      {
        name: "topInDashboardUnits",
        type: "number",
        required: true,
        description:
          "Top position of the component in dashboard grid units.",
      },
      {
        name: "leftInDashboardUnits",
        type: "number",
        required: true,
        description:
          "Left position of the component in dashboard grid units.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        _type: "DashboardComponent",
        value: {
          componentId: "550e8400-e29b-41d4-a716-446655440000",
          componentType: "Chart",
          widthInDashboardUnits: 6,
          heightInDashboardUnits: 4,
          topInDashboardUnits: 0,
          leftInDashboardUnits: 0,
        },
      },
      null,
      2,
    ),
  },
  "dashboard-view-config": {
    title: "DashboardViewConfig",
    description:
      "A configuration object for a dashboard view including its components and layout.",
    isEnum: false,
    properties: [
      {
        name: "components",
        type: "Array<DashboardComponent>",
        required: true,
        description:
          "An array of DashboardComponent objects that define the layout and content of the dashboard.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        _type: "DashboardViewConfig",
        value: {
          components: [
            {
              componentId: "550e8400-e29b-41d4-a716-446655440000",
              componentType: "Chart",
              widthInDashboardUnits: 6,
              heightInDashboardUnits: 4,
              topInDashboardUnits: 0,
              leftInDashboardUnits: 0,
            },
          ],
        },
      },
      null,
      2,
    ),
  },
};

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const page: string | undefined = req.params["page"];

    if (!page) {
      res.status(404);
      return res.render(`${ViewsPath}/pages/index`, {
        page: "404",
        pageTitle: "Page Not Found",
        enableGoogleTagManager: IsBillingEnabled,
        pageDescription: "Page you're looking for is not found.",
        resources: Resources,
        dataTypes: DataTypes,
        pageData: {},
      });
    }

    const detail: DataTypePageData | undefined = dataTypeDetails[page];

    if (!detail) {
      res.status(404);
      return res.render(`${ViewsPath}/pages/index`, {
        page: "404",
        pageTitle: "Page Not Found",
        enableGoogleTagManager: IsBillingEnabled,
        pageDescription: "Page you're looking for is not found.",
        resources: Resources,
        dataTypes: DataTypes,
        pageData: {},
      });
    }

    const pageData: Dictionary<unknown> = {
      title: detail.title,
      description: detail.description,
      isEnum: detail.isEnum,
      properties: detail.properties,
      values: detail.values,
      jsonExample: detail.jsonExample,
    };

    return res.render(`${ViewsPath}/pages/index`, {
      page: "data-type",
      resources: Resources,
      dataTypes: DataTypes,
      pageTitle: detail.title,
      enableGoogleTagManager: IsBillingEnabled,
      pageDescription: detail.description,
      pageData: pageData,
    });
  }
}
