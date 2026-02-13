import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import Dictionary from "Common/Types/Dictionary";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const DataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();
const TypeToDocPath: Dictionary<string> = DataTypeUtil.getTypeToDocPathMap();
const DataTypesByPath: Dictionary<DataTypeDocumentation> =
  DataTypeUtil.getDataTypeDictionaryByPath();

/*
 * Convert "See TypeName" references in descriptions to HTML links.
 * Matches patterns like "See MonitorStep", "See CriteriaFilter, CheckOn, and FilterType"
 * and converts them to clickable links.
 */
function linkifyDescription(text: string): string {
  // Escape HTML entities first
  let escaped: string = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  /*
   * Replace "See TypeName" references with links
   * Match type names that exist in our documentation
   */
  for (const typeName in TypeToDocPath) {
    const path: string | undefined = TypeToDocPath[typeName];
    if (!path) {
      continue;
    }
    // Only match PascalCase type names (at least 2 chars, starts with uppercase)
    const pascalCasePattern: RegExp = /^[A-Z][a-zA-Z]+$/;
    if (!pascalCasePattern.test(typeName)) {
      continue;
    }
    // Replace standalone occurrences of the type name (word boundaries)
    const regex: RegExp = new RegExp(`\\b${typeName}\\b`, "g");
    escaped = escaped.replace(
      regex,
      `<a href="/reference/${path}" class="text-indigo-600 hover:text-indigo-700 hover:underline font-medium">${typeName}</a>`,
    );
  }

  return escaped;
}

interface DataTypeProperty {
  name: string;
  type: string;
  required: boolean;
  description: string;
  typeLinks?: Array<{ label: string; path: string }>;
}

interface DataTypeValue {
  value: string;
  description: string;
}

interface RelatedType {
  name: string;
  path: string;
  relationship: string;
  description?: string;
}

interface TypeHierarchyItem {
  name: string;
  path: string;
}

interface DataTypePageData {
  title: string;
  description: string;
  isEnum: boolean;
  properties: Array<DataTypeProperty>;
  values: Array<DataTypeValue>;
  jsonExample: string;
  relatedTypes?: Array<RelatedType>;
  typeHierarchy?: Array<TypeHierarchyItem>;
}

// Detailed documentation for each data type, keyed by path
const dataTypeDetails: Dictionary<DataTypePageData> = {
  "object-id": {
    title: "ObjectID",
    description: "A unique identifier for objects, typically a UUID string.",
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
    jsonExample: JSON.stringify({ _type: "Decimal", value: 99.99 }, null, 2),
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
      "The top-level configuration object for a Monitor. It contains an ordered array of MonitorStep objects (each defining what to check and how to evaluate the result) and a defaultMonitorStatusId that serves as the fallback status when no criteria in any step match. The structure is: MonitorSteps → MonitorStep[] → MonitorCriteria → MonitorCriteriaInstance[] → CriteriaFilter[]. See MonitorStep, MonitorCriteria, MonitorCriteriaInstance, and CriteriaFilter for the nested types.",
    isEnum: false,
    typeHierarchy: [{ name: "MonitorSteps", path: "monitor-steps" }],
    relatedTypes: [
      {
        name: "MonitorStep",
        path: "monitor-step",
        relationship: "Contains an array of MonitorStep objects",
      },
      {
        name: "MonitorCriteria",
        path: "monitor-criteria",
        relationship: "Each step contains MonitorCriteria",
      },
      {
        name: "MonitorCriteriaInstance",
        path: "monitor-criteria-instance",
        relationship: "Criteria contains instances that define rules",
      },
      {
        name: "CriteriaFilter",
        path: "criteria-filter",
        relationship: "Each instance contains filter conditions",
      },
      {
        name: "CheckOn",
        path: "check-on",
        relationship: "Enum of what to check in filters",
      },
      {
        name: "FilterType",
        path: "filter-type",
        relationship: "Enum of comparison operators in filters",
      },
    ],
    properties: [
      {
        name: "monitorStepsInstanceArray",
        type: "Array<MonitorStep>",
        required: true,
        description:
          "An ordered array of MonitorStep objects. Each step defines a check target (URL, IP, hostname, etc.), HTTP request configuration (for API/Website monitors), and a MonitorCriteria object containing rules that determine the resulting monitor status, incidents, and alerts. Most monitors use a single step, but you can define multiple steps for different endpoints.",
        typeLinks: [
          { label: "Array<", path: "" },
          { label: "MonitorStep", path: "monitor-step" },
          { label: ">", path: "" },
        ],
      },
      {
        name: "defaultMonitorStatusId",
        type: "ObjectID",
        required: true,
        description:
          "The ID of a MonitorStatus resource. This status is used as the fallback when none of the criteria in any MonitorStep match the check result. Typically set to the 'Operational' or 'Online' monitor status. You can list your project's monitor statuses via the MonitorStatus API to find the correct ID.",
        typeLinks: [{ label: "ObjectID", path: "object-id" }],
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
                  value: "https://api.example.com/health",
                },
                requestType: "GET",
                monitorCriteria: {
                  monitorCriteriaInstanceArray: [
                    {
                      id: "aaa11111-1111-1111-1111-111111111111",
                      name: "Offline Check",
                      description:
                        "Mark as offline when the site is down or returns non-200",
                      monitorStatusId: "bbbb2222-2222-2222-2222-222222222222",
                      filterCondition: "Any",
                      filters: [
                        {
                          checkOn: "Is Online",
                          filterType: "False",
                        },
                        {
                          checkOn: "Response Status Code",
                          filterType: "Not Equal To",
                          value: 200,
                        },
                      ],
                      changeMonitorStatus: true,
                      createIncidents: true,
                      incidents: [
                        {
                          id: "ccc33333-3333-3333-3333-333333333333",
                          title: "API Health Endpoint is offline",
                          description:
                            "The API health endpoint is not responding or returning errors.",
                          incidentSeverityId:
                            "ddd44444-4444-4444-4444-444444444444",
                          autoResolveIncident: true,
                        },
                      ],
                      createAlerts: true,
                      alerts: [
                        {
                          id: "eee55555-5555-5555-5555-555555555555",
                          title: "API Health Endpoint is offline",
                          description:
                            "The API health endpoint is not responding or returning errors.",
                          alertSeverityId:
                            "fff66666-6666-6666-6666-666666666666",
                          autoResolveAlert: true,
                        },
                      ],
                    },
                    {
                      id: "ggg77777-7777-7777-7777-777777777777",
                      name: "Online Check",
                      description:
                        "Mark as online when the site is up and returns 200",
                      monitorStatusId: "hhh88888-8888-8888-8888-888888888888",
                      filterCondition: "All",
                      filters: [
                        {
                          checkOn: "Is Online",
                          filterType: "True",
                        },
                        {
                          checkOn: "Response Status Code",
                          filterType: "Equal To",
                          value: 200,
                        },
                      ],
                      changeMonitorStatus: true,
                      createIncidents: false,
                      incidents: [],
                      createAlerts: false,
                      alerts: [],
                    },
                  ],
                },
              },
            },
          ],
          defaultMonitorStatusId: "hhh88888-8888-8888-8888-888888888888",
        },
      },
      null,
      2,
    ),
  },
  "monitor-step": {
    title: "MonitorStep",
    description:
      "A single monitor step that defines what to check and how to evaluate the result. The properties you need depend on the MonitorType. For Website/API monitors, set monitorDestination and requestType. For Port monitors, also set monitorDestinationPort. For Synthetic/CustomJavaScriptCode monitors, set customCode. For Log/Trace/Metric/SNMP monitors, set the corresponding sub-config (logMonitor, traceMonitor, metricMonitor, snmpMonitor). Every step must include a MonitorCriteria object containing the evaluation rules. See MonitorCriteria, CriteriaFilter, and CheckOn for details on how criteria are evaluated.",
    isEnum: false,
    typeHierarchy: [
      { name: "MonitorSteps", path: "monitor-steps" },
      { name: "MonitorStep", path: "monitor-step" },
    ],
    relatedTypes: [
      {
        name: "MonitorSteps",
        path: "monitor-steps",
        relationship: "Parent container that holds MonitorStep array",
      },
      {
        name: "MonitorCriteria",
        path: "monitor-criteria",
        relationship: "Contains the evaluation rules for this step",
      },
      {
        name: "MonitorStepLogMonitor",
        path: "monitor-step-log-monitor",
        relationship: "Log monitor configuration",
      },
      {
        name: "MonitorStepTraceMonitor",
        path: "monitor-step-trace-monitor",
        relationship: "Trace monitor configuration",
      },
      {
        name: "MonitorStepMetricMonitor",
        path: "monitor-step-metric-monitor",
        relationship: "Metric monitor configuration",
      },
      {
        name: "MonitorStepSnmpMonitor",
        path: "monitor-step-snmp-monitor",
        relationship: "SNMP monitor configuration",
      },
    ],
    properties: [
      {
        name: "id",
        type: "string (UUID)",
        required: true,
        description:
          "A unique identifier for this monitor step. Generate a UUID v4 value.",
      },
      {
        name: "monitorDestination",
        type: "URL | IP | Hostname",
        required: false,
        description:
          "The target to monitor. Required for Website, API, Ping, IP, Port, and SSL Certificate monitor types. Use a URL object for Website/API monitors, an IP object for IP/Ping monitors, or a Hostname object for Port/SSL monitors.",
      },
      {
        name: "monitorDestinationPort",
        type: "Port",
        required: false,
        description:
          "The port number to check. Required only for Port monitor type. A number between 1 and 65535.",
      },
      {
        name: "monitorCriteria",
        type: "MonitorCriteria",
        required: true,
        description:
          "The criteria used to evaluate the monitor check result. Contains an array of MonitorCriteriaInstance objects that define conditions and resulting status changes, incidents, and alerts. Criteria instances are evaluated in order; the first matching instance determines the outcome.",
        typeLinks: [{ label: "MonitorCriteria", path: "monitor-criteria" }],
      },
      {
        name: "requestType",
        type: "string (HTTPMethod)",
        required: false,
        description:
          "The HTTP method for the request. Required for API monitors. Possible values: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS.",
      },
      {
        name: "requestHeaders",
        type: "Dictionary<string>",
        required: false,
        description:
          'Key-value pairs of HTTP headers to send with the request. Used for API and Website monitors. Example: { "Authorization": "Bearer token", "Content-Type": "application/json" }.',
      },
      {
        name: "requestBody",
        type: "string",
        required: false,
        description:
          "The HTTP request body. Used for API monitors with POST, PUT, or PATCH methods. Typically a JSON string.",
      },
      {
        name: "doNotFollowRedirects",
        type: "boolean",
        required: false,
        description:
          "If true, the monitor will not follow HTTP redirects (3xx responses). Defaults to false. Used for API and Website monitors.",
      },
      {
        name: "customCode",
        type: "string",
        required: false,
        description:
          "JavaScript code to execute. Required for CustomJavaScriptCode and SyntheticMonitor types. For custom code monitors, the code should return a value that can be checked by criteria. For synthetic monitors, the code has access to a browser automation API (Playwright).",
      },
      {
        name: "screenSizeTypes",
        type: "Array<string>",
        required: false,
        description:
          "Screen sizes for synthetic monitor browser testing. Possible values: Mobile, Tablet, Desktop. Used only for SyntheticMonitor type.",
      },
      {
        name: "browserTypes",
        type: "Array<string>",
        required: false,
        description:
          "Browser types for synthetic monitor testing. Possible values: Chromium, Firefox, Webkit. Used only for SyntheticMonitor type.",
      },
      {
        name: "retryCountOnError",
        type: "number",
        required: false,
        description:
          "Number of times to retry the check if it fails with an error. Defaults to 0. Used for CustomJavaScriptCode and SyntheticMonitor types.",
      },
      {
        name: "logMonitor",
        type: "MonitorStepLogMonitor",
        required: false,
        description:
          "Configuration for log-based monitoring. Required for Logs monitor type. Defines log severity filters, body search text, service IDs, and the time window to evaluate. See MonitorStepLogMonitor.",
        typeLinks: [
          { label: "MonitorStepLogMonitor", path: "monitor-step-log-monitor" },
        ],
      },
      {
        name: "traceMonitor",
        type: "MonitorStepTraceMonitor",
        required: false,
        description:
          "Configuration for trace/span-based monitoring. Required for Traces monitor type. Defines span status filters, span name, service IDs, and the time window to evaluate. See MonitorStepTraceMonitor.",
        typeLinks: [
          {
            label: "MonitorStepTraceMonitor",
            path: "monitor-step-trace-monitor",
          },
        ],
      },
      {
        name: "metricMonitor",
        type: "MonitorStepMetricMonitor",
        required: false,
        description:
          "Configuration for metric-based monitoring. Required for Metrics monitor type. Defines the metric query configuration and rolling time window. See MonitorStepMetricMonitor.",
        typeLinks: [
          {
            label: "MonitorStepMetricMonitor",
            path: "monitor-step-metric-monitor",
          },
        ],
      },
      {
        name: "exceptionMonitor",
        type: "MonitorStepExceptionMonitor",
        required: false,
        description:
          "Configuration for exception-based monitoring. Required for Exceptions monitor type. Defines exception class, message filters, service IDs, and the time window to evaluate.",
      },
      {
        name: "snmpMonitor",
        type: "MonitorStepSnmpMonitor",
        required: false,
        description:
          "Configuration for SNMP monitoring. Required for SNMP monitor type. Defines SNMP version, hostname, port, community string or V3 auth, OIDs to query, and timeout settings. See MonitorStepSnmpMonitor.",
        typeLinks: [
          {
            label: "MonitorStepSnmpMonitor",
            path: "monitor-step-snmp-monitor",
          },
        ],
      },
      {
        name: "dnsMonitor",
        type: "MonitorStepDnsMonitor",
        required: false,
        description:
          "Configuration for DNS monitoring. Required for DNS monitor type. Defines query name (domain), record type, optional DNS server, port, timeout, and retry settings. See MonitorStepDnsMonitor.",
        typeLinks: [
          {
            label: "MonitorStepDnsMonitor",
            path: "monitor-step-dns-monitor",
          },
        ],
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        "// Example 1: Website Monitor Step": "",
        websiteStep: {
          _type: "MonitorStep",
          value: {
            id: "550e8400-e29b-41d4-a716-446655440000",
            monitorDestination: {
              _type: "URL",
              value: "https://example.com",
            },
            requestType: "GET",
            monitorCriteria: {
              monitorCriteriaInstanceArray: [
                {
                  id: "aaa11111-1111-1111-1111-111111111111",
                  name: "Offline Check",
                  description: "Triggered when site is unreachable or non-200",
                  monitorStatusId: "offline-status-id",
                  filterCondition: "Any",
                  filters: [
                    { checkOn: "Is Online", filterType: "False" },
                    {
                      checkOn: "Response Status Code",
                      filterType: "Not Equal To",
                      value: 200,
                    },
                  ],
                  changeMonitorStatus: true,
                  createIncidents: true,
                  incidents: [
                    {
                      id: "inc-1",
                      title: "Website is offline",
                      description: "The website is not responding.",
                      incidentSeverityId: "severity-id",
                      autoResolveIncident: true,
                    },
                  ],
                  createAlerts: false,
                  alerts: [],
                },
                {
                  id: "bbb22222-2222-2222-2222-222222222222",
                  name: "Online Check",
                  description: "Triggered when site is up and returns 200",
                  monitorStatusId: "online-status-id",
                  filterCondition: "All",
                  filters: [
                    { checkOn: "Is Online", filterType: "True" },
                    {
                      checkOn: "Response Status Code",
                      filterType: "Equal To",
                      value: 200,
                    },
                  ],
                  changeMonitorStatus: true,
                  createIncidents: false,
                  incidents: [],
                  createAlerts: false,
                  alerts: [],
                },
              ],
            },
          },
        },
        "// Example 2: API Monitor Step (POST with headers and body)": "",
        apiStep: {
          _type: "MonitorStep",
          value: {
            id: "660e8400-e29b-41d4-a716-446655440001",
            monitorDestination: {
              _type: "URL",
              value: "https://api.example.com/v1/health",
            },
            requestType: "POST",
            requestHeaders: {
              Authorization: "Bearer my-api-token",
              "Content-Type": "application/json",
            },
            requestBody: '{"check": "deep"}',
            doNotFollowRedirects: false,
            monitorCriteria: {
              monitorCriteriaInstanceArray: [],
            },
          },
        },
        "// Example 3: Port Monitor Step": "",
        portStep: {
          _type: "MonitorStep",
          value: {
            id: "770e8400-e29b-41d4-a716-446655440002",
            monitorDestination: {
              _type: "Hostname",
              value: "db.example.com",
            },
            monitorDestinationPort: 5432,
            monitorCriteria: {
              monitorCriteriaInstanceArray: [],
            },
          },
        },
        "// Example 4: SSL Certificate Monitor Step": "",
        sslStep: {
          _type: "MonitorStep",
          value: {
            id: "880e8400-e29b-41d4-a716-446655440003",
            monitorDestination: {
              _type: "URL",
              value: "https://secure.example.com",
            },
            monitorCriteria: {
              monitorCriteriaInstanceArray: [
                {
                  id: "ssl-criteria-1",
                  name: "Certificate Expiring Soon",
                  description: "Alert when SSL cert expires within 14 days",
                  monitorStatusId: "degraded-status-id",
                  filterCondition: "Any",
                  filters: [
                    {
                      checkOn: "Expires In Days",
                      filterType: "Less Than",
                      value: 14,
                    },
                  ],
                  changeMonitorStatus: true,
                  createAlerts: true,
                  alerts: [
                    {
                      id: "alert-ssl-1",
                      title: "SSL Certificate expiring soon",
                      description: "Certificate expires in less than 14 days.",
                      alertSeverityId: "warning-severity-id",
                      autoResolveAlert: true,
                    },
                  ],
                  createIncidents: false,
                  incidents: [],
                },
              ],
            },
          },
        },
        "// Example 5: Ping Monitor Step": "",
        pingStep: {
          _type: "MonitorStep",
          value: {
            id: "990e8400-e29b-41d4-a716-446655440004",
            monitorDestination: {
              _type: "IP",
              value: "192.168.1.1",
            },
            monitorCriteria: {
              monitorCriteriaInstanceArray: [
                {
                  id: "ping-criteria-1",
                  name: "Host Down",
                  description: "Triggered when host is not reachable",
                  monitorStatusId: "offline-status-id",
                  filterCondition: "Any",
                  filters: [{ checkOn: "Is Online", filterType: "False" }],
                  changeMonitorStatus: true,
                  createIncidents: true,
                  incidents: [
                    {
                      id: "inc-ping-1",
                      title: "Host 192.168.1.1 is unreachable",
                      description: "Ping monitor cannot reach the host.",
                      incidentSeverityId: "critical-severity-id",
                      autoResolveIncident: true,
                    },
                  ],
                  createAlerts: false,
                  alerts: [],
                },
              ],
            },
          },
        },
        "// Example 6: Incoming Request Monitor Step": "",
        incomingRequestStep: {
          _type: "MonitorStep",
          value: {
            id: "aa0e8400-e29b-41d4-a716-446655440005",
            monitorCriteria: {
              monitorCriteriaInstanceArray: [
                {
                  id: "heartbeat-criteria-1",
                  name: "Heartbeat Missing",
                  description:
                    "Triggered when no request received in 30 minutes",
                  monitorStatusId: "offline-status-id",
                  filterCondition: "Any",
                  filters: [
                    {
                      checkOn: "Incoming Request",
                      filterType: "Not Recieved In Minutes",
                      value: 30,
                    },
                  ],
                  changeMonitorStatus: true,
                  createIncidents: true,
                  incidents: [
                    {
                      id: "inc-heartbeat-1",
                      title: "Heartbeat not received",
                      description:
                        "No incoming request received in the last 30 minutes.",
                      incidentSeverityId: "critical-severity-id",
                      autoResolveIncident: true,
                    },
                  ],
                  createAlerts: false,
                  alerts: [],
                },
                {
                  id: "heartbeat-criteria-2",
                  name: "Heartbeat Received",
                  description:
                    "Triggered when a request was received in last 30 min",
                  monitorStatusId: "online-status-id",
                  filterCondition: "All",
                  filters: [
                    {
                      checkOn: "Incoming Request",
                      filterType: "Recieved In Minutes",
                      value: 30,
                    },
                  ],
                  changeMonitorStatus: true,
                  createIncidents: false,
                  incidents: [],
                  createAlerts: false,
                  alerts: [],
                },
              ],
            },
          },
        },
        "// Example 7: Log Monitor Step": "",
        logStep: {
          _type: "MonitorStep",
          value: {
            id: "bb0e8400-e29b-41d4-a716-446655440006",
            logMonitor: {
              attributes: {},
              body: "ERROR",
              severityTexts: ["Error", "Fatal"],
              telemetryServiceIds: ["service-id-1"],
              lastXSecondsOfLogs: 300,
            },
            monitorCriteria: {
              monitorCriteriaInstanceArray: [
                {
                  id: "log-criteria-1",
                  name: "Error Spike",
                  description: "Alert when error log count exceeds threshold",
                  monitorStatusId: "degraded-status-id",
                  filterCondition: "All",
                  filters: [
                    {
                      checkOn: "Log Count",
                      filterType: "Greater Than",
                      value: 100,
                    },
                  ],
                  changeMonitorStatus: true,
                  createAlerts: true,
                  alerts: [
                    {
                      id: "alert-log-1",
                      title: "High error log volume detected",
                      description:
                        "More than 100 error logs in the last 5 minutes.",
                      alertSeverityId: "warning-severity-id",
                      autoResolveAlert: true,
                    },
                  ],
                  createIncidents: false,
                  incidents: [],
                },
              ],
            },
          },
        },
        "// Example 8: Custom JavaScript Code Monitor Step": "",
        customCodeStep: {
          _type: "MonitorStep",
          value: {
            id: "cc0e8400-e29b-41d4-a716-446655440007",
            customCode:
              "const res = await fetch('https://api.example.com/status'); const data = await res.json(); return { result: data.queueSize };",
            retryCountOnError: 2,
            monitorCriteria: {
              monitorCriteriaInstanceArray: [
                {
                  id: "code-criteria-1",
                  name: "Queue Overloaded",
                  description: "Alert when queue size exceeds 1000",
                  monitorStatusId: "degraded-status-id",
                  filterCondition: "All",
                  filters: [
                    {
                      checkOn: "Result Value",
                      filterType: "Greater Than",
                      value: 1000,
                    },
                  ],
                  changeMonitorStatus: true,
                  createAlerts: true,
                  alerts: [
                    {
                      id: "alert-code-1",
                      title: "Queue overloaded",
                      description: "Queue size has exceeded 1000 items.",
                      alertSeverityId: "warning-severity-id",
                      autoResolveAlert: true,
                    },
                  ],
                  createIncidents: false,
                  incidents: [],
                },
              ],
            },
          },
        },
        "// Example 9: Server Monitor Step": "",
        serverStep: {
          _type: "MonitorStep",
          value: {
            id: "dd0e8400-e29b-41d4-a716-446655440008",
            monitorCriteria: {
              monitorCriteriaInstanceArray: [
                {
                  id: "server-criteria-1",
                  name: "High CPU",
                  description: "Alert when CPU usage exceeds 90%",
                  monitorStatusId: "degraded-status-id",
                  filterCondition: "Any",
                  filters: [
                    {
                      checkOn: "CPU Usage (in %)",
                      filterType: "Greater Than",
                      value: 90,
                    },
                  ],
                  changeMonitorStatus: true,
                  createAlerts: true,
                  alerts: [
                    {
                      id: "alert-cpu-1",
                      title: "High CPU usage",
                      description: "Server CPU usage exceeds 90%.",
                      alertSeverityId: "critical-severity-id",
                      autoResolveAlert: true,
                    },
                  ],
                  createIncidents: false,
                  incidents: [],
                },
                {
                  id: "server-criteria-2",
                  name: "Disk Full",
                  description: "Alert when disk usage exceeds 85%",
                  monitorStatusId: "degraded-status-id",
                  filterCondition: "Any",
                  filters: [
                    {
                      checkOn: "Disk Usage (in %)",
                      filterType: "Greater Than",
                      value: 85,
                      serverMonitorOptions: { diskPath: "/" },
                    },
                  ],
                  changeMonitorStatus: true,
                  createIncidents: true,
                  incidents: [
                    {
                      id: "inc-disk-1",
                      title: "Disk space critically low",
                      description: "Disk usage on / exceeds 85%.",
                      incidentSeverityId: "critical-severity-id",
                      autoResolveIncident: true,
                    },
                  ],
                  createAlerts: false,
                  alerts: [],
                },
              ],
            },
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
      "A collection of MonitorCriteriaInstance objects used to evaluate monitor check results. Each instance in the array is evaluated in order; the first instance whose filter conditions match determines the resulting monitor status and whether incidents or alerts are created. If no instances match, the MonitorSteps.defaultMonitorStatusId is used as a fallback. See MonitorCriteriaInstance for the structure of each rule, and CriteriaFilter for the filter conditions.",
    isEnum: false,
    typeHierarchy: [
      { name: "MonitorSteps", path: "monitor-steps" },
      { name: "MonitorStep", path: "monitor-step" },
      { name: "MonitorCriteria", path: "monitor-criteria" },
    ],
    relatedTypes: [
      {
        name: "MonitorStep",
        path: "monitor-step",
        relationship: "Parent that contains this criteria",
      },
      {
        name: "MonitorCriteriaInstance",
        path: "monitor-criteria-instance",
        relationship: "Contains array of criteria instances",
      },
      {
        name: "CriteriaFilter",
        path: "criteria-filter",
        relationship: "Each instance uses filters to define conditions",
      },
      {
        name: "FilterCondition",
        path: "filter-condition",
        relationship: "Determines AND/OR logic for filters",
      },
    ],
    properties: [
      {
        name: "monitorCriteriaInstanceArray",
        type: "Array<MonitorCriteriaInstance>",
        required: true,
        description:
          "An ordered array of MonitorCriteriaInstance objects. Evaluated top to bottom; the first matching instance wins. Each instance contains filter conditions (using CriteriaFilter objects), a target MonitorStatus ID, and optional incident/alert configurations. Place failure/offline criteria first and success/online criteria last.",
        typeLinks: [
          { label: "Array<", path: "" },
          {
            label: "MonitorCriteriaInstance",
            path: "monitor-criteria-instance",
          },
          { label: ">", path: "" },
        ],
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        monitorCriteriaInstanceArray: [
          {
            id: "criteria-1-offline",
            name: "Offline Check",
            description: "Mark offline when unreachable or non-200",
            monitorStatusId: "offline-status-id",
            filterCondition: "Any",
            filters: [
              { checkOn: "Is Online", filterType: "False" },
              {
                checkOn: "Response Status Code",
                filterType: "Not Equal To",
                value: 200,
              },
            ],
            changeMonitorStatus: true,
            createIncidents: true,
            incidents: [
              {
                id: "inc-1",
                title: "Service is offline",
                description: "The monitored service is not responding.",
                incidentSeverityId: "severity-id",
                autoResolveIncident: true,
              },
            ],
            createAlerts: false,
            alerts: [],
          },
          {
            id: "criteria-2-slow",
            name: "Slow Response",
            description: "Mark degraded when response time exceeds 5 seconds",
            monitorStatusId: "degraded-status-id",
            filterCondition: "All",
            filters: [
              { checkOn: "Is Online", filterType: "True" },
              {
                checkOn: "Response Time (in ms)",
                filterType: "Greater Than",
                value: 5000,
              },
            ],
            changeMonitorStatus: true,
            createIncidents: false,
            incidents: [],
            createAlerts: true,
            alerts: [
              {
                id: "alert-slow-1",
                title: "Slow response detected",
                description: "Response time exceeds 5 seconds.",
                alertSeverityId: "warning-severity-id",
                autoResolveAlert: true,
              },
            ],
          },
          {
            id: "criteria-3-online",
            name: "Online Check",
            description: "Mark online when reachable and returns 200",
            monitorStatusId: "online-status-id",
            filterCondition: "All",
            filters: [
              { checkOn: "Is Online", filterType: "True" },
              {
                checkOn: "Response Status Code",
                filterType: "Equal To",
                value: 200,
              },
            ],
            changeMonitorStatus: true,
            createIncidents: false,
            incidents: [],
            createAlerts: false,
            alerts: [],
          },
        ],
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
    jsonExample: JSON.stringify({ _type: "PositiveNumber", value: 5 }, null, 2),
  },
  "monitor-criteria-instance": {
    title: "MonitorCriteriaInstance",
    description:
      "A single criteria rule within a MonitorCriteria array. Each instance defines: (1) filter conditions (using CriteriaFilter objects combined with a FilterCondition), (2) the MonitorStatus to set when conditions match, and (3) optional incidents and alerts to automatically create. Criteria instances are evaluated in order within their parent MonitorCriteria; the first matching instance wins. See CriteriaFilter for filter structure, CheckOn for available checks, FilterType for comparison operators, CriteriaIncident for incident configuration, and CriteriaAlert for alert configuration.",
    isEnum: false,
    typeHierarchy: [
      { name: "MonitorSteps", path: "monitor-steps" },
      { name: "MonitorStep", path: "monitor-step" },
      { name: "MonitorCriteria", path: "monitor-criteria" },
      { name: "MonitorCriteriaInstance", path: "monitor-criteria-instance" },
    ],
    relatedTypes: [
      {
        name: "MonitorCriteria",
        path: "monitor-criteria",
        relationship: "Parent container that holds instances",
      },
      {
        name: "CriteriaFilter",
        path: "criteria-filter",
        relationship: "Defines the conditions to check",
      },
      {
        name: "FilterCondition",
        path: "filter-condition",
        relationship: "AND/OR logic for combining filters",
      },
      {
        name: "CheckOn",
        path: "check-on",
        relationship: "What to check in each filter",
      },
      {
        name: "FilterType",
        path: "filter-type",
        relationship: "Comparison operator in each filter",
      },
      {
        name: "CriteriaIncident",
        path: "criteria-incident",
        relationship: "Auto-created incidents when criteria matches",
      },
      {
        name: "CriteriaAlert",
        path: "criteria-alert",
        relationship: "Auto-created alerts when criteria matches",
      },
    ],
    properties: [
      {
        name: "id",
        type: "string (UUID)",
        required: true,
        description:
          "A unique identifier for this criteria instance. Generate a UUID v4 value.",
      },
      {
        name: "name",
        type: "string",
        required: true,
        description:
          "A human-readable name for this criteria (e.g., 'Offline Check', 'Slow Response', 'Certificate Expiring').",
      },
      {
        name: "description",
        type: "string",
        required: true,
        description:
          "A description of what this criteria checks and when it triggers (e.g., 'Mark offline when the site is unreachable or returns a non-200 status').",
      },
      {
        name: "monitorStatusId",
        type: "ObjectID",
        required: true,
        description:
          "The ID of a MonitorStatus resource to set when this criteria matches. List your project's monitor statuses via the MonitorStatus API to find the correct IDs (e.g., 'Online', 'Offline', 'Degraded').",
        typeLinks: [{ label: "ObjectID", path: "object-id" }],
      },
      {
        name: "filterCondition",
        type: "FilterCondition (enum)",
        required: true,
        description:
          "How to combine the filters array. 'All' means all filters must be true (AND logic). 'Any' means at least one filter must be true (OR logic). See FilterCondition.",
        typeLinks: [{ label: "FilterCondition", path: "filter-condition" }],
      },
      {
        name: "filters",
        type: "Array<CriteriaFilter>",
        required: true,
        description:
          "An array of CriteriaFilter objects that define the conditions to evaluate. Each filter specifies what to check (CheckOn), how to compare (FilterType), and the expected value. Must contain at least one filter. See CriteriaFilter, CheckOn, and FilterType.",
        typeLinks: [
          { label: "Array<", path: "" },
          { label: "CriteriaFilter", path: "criteria-filter" },
          { label: ">", path: "" },
        ],
      },
      {
        name: "changeMonitorStatus",
        type: "boolean",
        required: false,
        description:
          "Whether to change the monitor's status to monitorStatusId when this criteria matches. Defaults to false. Set to true to enable automatic status changes.",
      },
      {
        name: "createIncidents",
        type: "boolean",
        required: false,
        description:
          "Whether to automatically create incidents when this criteria matches. Defaults to false. Set to true and provide the incidents array to enable auto-incident creation.",
      },
      {
        name: "incidents",
        type: "Array<CriteriaIncident>",
        required: false,
        description:
          "An array of CriteriaIncident objects defining incidents to create when this criteria matches and createIncidents is true. Each incident has a title, description, severity, and can be set to auto-resolve. See CriteriaIncident.",
        typeLinks: [
          { label: "Array<", path: "" },
          { label: "CriteriaIncident", path: "criteria-incident" },
          { label: ">", path: "" },
        ],
      },
      {
        name: "createAlerts",
        type: "boolean",
        required: false,
        description:
          "Whether to automatically create alerts when this criteria matches. Defaults to false. Set to true and provide the alerts array to enable auto-alert creation.",
      },
      {
        name: "alerts",
        type: "Array<CriteriaAlert>",
        required: false,
        description:
          "An array of CriteriaAlert objects defining alerts to create when this criteria matches and createAlerts is true. Each alert has a title, description, severity, and can be set to auto-resolve. See CriteriaAlert.",
        typeLinks: [
          { label: "Array<", path: "" },
          { label: "CriteriaAlert", path: "criteria-alert" },
          { label: ">", path: "" },
        ],
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Offline Check",
        description:
          "Mark as offline when site is unreachable or returns non-200 status code",
        monitorStatusId: "660e8400-e29b-41d4-a716-446655440001",
        filterCondition: "Any",
        filters: [
          { checkOn: "Is Online", filterType: "False" },
          {
            checkOn: "Response Status Code",
            filterType: "Not Equal To",
            value: 200,
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        incidents: [
          {
            id: "770e8400-e29b-41d4-a716-446655440002",
            title: "Website is offline",
            description: "The website is not responding or returning errors.",
            incidentSeverityId: "880e8400-e29b-41d4-a716-446655440003",
            autoResolveIncident: true,
            remediationNotes: "Check server logs and restart if needed.",
            onCallPolicyIds: ["990e8400-e29b-41d4-a716-446655440004"],
          },
        ],
        createAlerts: true,
        alerts: [
          {
            id: "aa0e8400-e29b-41d4-a716-446655440005",
            title: "Website is offline",
            description: "The website is not responding or returning errors.",
            alertSeverityId: "bb0e8400-e29b-41d4-a716-446655440006",
            autoResolveAlert: true,
          },
        ],
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
        description: "A valid email address string (e.g., user@example.com).",
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
        description: "A valid phone number string (e.g., +1-555-123-4567).",
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
    jsonExample: JSON.stringify({ _type: "Color", value: "#3498db" }, null, 2),
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
    jsonExample: JSON.stringify({ _type: "Version", value: "1.0.0" }, null, 2),
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
    jsonExample: JSON.stringify({ _type: "IP", value: "192.168.1.1" }, null, 2),
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
    jsonExample: JSON.stringify({ _type: "GreaterThan", value: 100 }, null, 2),
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
    jsonExample: JSON.stringify({ _type: "LessThan", value: 100 }, null, 2),
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
    jsonExample: JSON.stringify({ _type: "Port", value: 443 }, null, 2),
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
        description: "Base64-encoded binary data.",
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
    jsonExample: JSON.stringify({ _type: "NotNull", value: true }, null, 2),
  },
  "is-null": {
    title: "IsNull",
    description: "A query filter that matches objects where a field is null.",
    isEnum: false,
    properties: [],
    values: [],
    jsonExample: JSON.stringify({ _type: "IsNull", value: true }, null, 2),
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
        description: "The type of component (e.g., Chart, Value, Table).",
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
        description: "Top position of the component in dashboard grid units.",
      },
      {
        name: "leftInDashboardUnits",
        type: "number",
        required: true,
        description: "Left position of the component in dashboard grid units.",
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
  "criteria-filter": {
    title: "CriteriaFilter",
    description:
      "A single filter condition within a MonitorCriteriaInstance. Each filter defines what to check (CheckOn), how to compare it (FilterType), and the expected value. Multiple filters in a MonitorCriteriaInstance are combined using the parent's FilterCondition (All = AND, Any = OR). The available CheckOn values depend on the monitor type. See CheckOn for all available checks, FilterType for comparison operators, and MonitorCriteriaInstance for how filters are used.",
    isEnum: false,
    typeHierarchy: [
      { name: "MonitorSteps", path: "monitor-steps" },
      { name: "MonitorStep", path: "monitor-step" },
      { name: "MonitorCriteria", path: "monitor-criteria" },
      { name: "MonitorCriteriaInstance", path: "monitor-criteria-instance" },
      { name: "CriteriaFilter", path: "criteria-filter" },
    ],
    relatedTypes: [
      {
        name: "MonitorCriteriaInstance",
        path: "monitor-criteria-instance",
        relationship: "Parent that holds the filters array",
      },
      {
        name: "CheckOn",
        path: "check-on",
        relationship: "Enum of what to check",
      },
      {
        name: "FilterType",
        path: "filter-type",
        relationship: "Enum of comparison operators",
      },
      {
        name: "FilterCondition",
        path: "filter-condition",
        relationship: "How filters are combined (AND/OR)",
      },
    ],
    properties: [
      {
        name: "checkOn",
        type: "CheckOn (enum)",
        required: true,
        description:
          "What aspect of the monitor response to evaluate. The available values depend on monitor type. For Website/API: 'Is Online', 'Response Status Code', 'Response Time (in ms)', 'Response Body', 'Response Header', etc. For Server: 'CPU Usage (in %)', 'Memory Usage (in %)', 'Disk Usage (in %)'. For SSL: 'Expires In Days', 'Is Valid Certificate'. For Logs: 'Log Count'. For Incoming Request: 'Incoming Request'. See CheckOn for the full list.",
        typeLinks: [{ label: "CheckOn", path: "check-on" }],
      },
      {
        name: "filterType",
        type: "FilterType (enum)",
        required: true,
        description:
          "The comparison operator. Common values: 'Equal To', 'Not Equal To', 'Greater Than', 'Less Than', 'Greater Than Or Equal To', 'Less Than Or Equal To', 'Contains', 'Not Contains', 'True', 'False'. For incoming request monitors: 'Not Recieved In Minutes', 'Recieved In Minutes'. See FilterType for the full list.",
        typeLinks: [{ label: "FilterType", path: "filter-type" }],
      },
      {
        name: "value",
        type: "string | number",
        required: false,
        description:
          "The value to compare against. Not required for boolean-type FilterTypes like 'True' and 'False'. For numeric checks (response code, response time, CPU %, etc.), use a number. For text checks (response body, headers), use a string. For time-based checks ('Not Recieved In Minutes'), use the number of minutes.",
      },
      {
        name: "evaluateOverTime",
        type: "boolean",
        required: false,
        description:
          "If true, the filter evaluates over a time window instead of a single check result. Use with evaluateOverTimeOptions to configure aggregation.",
      },
      {
        name: "evaluateOverTimeOptions",
        type: "object",
        required: false,
        description:
          "Configuration for time-based evaluation. Contains 'timeValueInMinutes' (number of minutes to evaluate) and 'evaluateOverTimeType' (aggregation: 'Average', 'Sum', 'Maximum Value', 'Minimum Value', 'All Values', 'Any Value').",
      },
      {
        name: "serverMonitorOptions",
        type: "object",
        required: false,
        description:
          "Additional options for Server monitor filters. Contains 'diskPath' (string) - the filesystem path to check when using 'Disk Usage (in %)' checkOn (e.g., '/', '/data', 'C:\\\\').",
      },
      {
        name: "metricMonitorOptions",
        type: "object",
        required: false,
        description:
          "Additional options for Metric monitor filters. Contains 'metricAlias' (string) - the alias of the metric to check, and 'metricAggregationType' (string) - aggregation type ('Average', 'Sum', 'Maximum Value', 'Minimum Value').",
      },
      {
        name: "snmpMonitorOptions",
        type: "object",
        required: false,
        description:
          "Additional options for SNMP monitor filters. Contains 'oid' (string) - the SNMP OID to check when using 'SNMP OID Value' or 'SNMP OID Exists' checkOn values.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        "// Example 1: Check if site is online (boolean check)":
          "Used for Website, API, Ping monitors",
        filter1: {
          checkOn: "Is Online",
          filterType: "True",
        },
        "// Example 2: Check HTTP response status code":
          "Used for Website, API monitors",
        filter2: {
          checkOn: "Response Status Code",
          filterType: "Equal To",
          value: 200,
        },
        "// Example 3: Check response time threshold":
          "Used for Website, API monitors",
        filter3: {
          checkOn: "Response Time (in ms)",
          filterType: "Greater Than",
          value: 5000,
        },
        "// Example 4: Check response body contains text":
          "Used for Website, API monitors",
        filter4: {
          checkOn: "Response Body",
          filterType: "Contains",
          value: '"status":"healthy"',
        },
        "// Example 5: Check SSL certificate expiration":
          "Used for SSL Certificate monitors",
        filter5: {
          checkOn: "Expires In Days",
          filterType: "Less Than",
          value: 14,
        },
        "// Example 6: Check incoming request heartbeat":
          "Used for Incoming Request monitors",
        filter6: {
          checkOn: "Incoming Request",
          filterType: "Not Recieved In Minutes",
          value: 30,
        },
        "// Example 7: Check server CPU usage": "Used for Server monitors",
        filter7: {
          checkOn: "CPU Usage (in %)",
          filterType: "Greater Than",
          value: 90,
        },
        "// Example 8: Check disk usage with path": "Used for Server monitors",
        filter8: {
          checkOn: "Disk Usage (in %)",
          filterType: "Greater Than",
          value: 85,
          serverMonitorOptions: { diskPath: "/" },
        },
        "// Example 9: Check log count": "Used for Log monitors",
        filter9: {
          checkOn: "Log Count",
          filterType: "Greater Than",
          value: 100,
        },
        "// Example 10: Check custom code result value":
          "Used for Custom JavaScript Code monitors",
        filter10: {
          checkOn: "Result Value",
          filterType: "Greater Than",
          value: 1000,
        },
        "// Example 11: Check SNMP OID value": "Used for SNMP monitors",
        filter11: {
          checkOn: "SNMP OID Value",
          filterType: "Greater Than",
          value: 90,
          snmpMonitorOptions: { oid: "1.3.6.1.2.1.25.3.3.1.2" },
        },
        "// Example 12: Check with time-based aggregation":
          "Evaluate average over time window",
        filter12: {
          checkOn: "Response Time (in ms)",
          filterType: "Greater Than",
          value: 3000,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: "Average",
          },
        },
      },
      null,
      2,
    ),
  },
  "criteria-incident": {
    title: "CriteriaIncident",
    description:
      "Configuration for an incident that is automatically created when a MonitorCriteriaInstance's conditions are met. When createIncidents is true on the parent MonitorCriteriaInstance, one or more incidents with these settings are created. Incidents can be configured to auto-resolve when the criteria no longer matches. You can assign on-call policies, labels, and owners. See MonitorCriteriaInstance for how this is used.",
    isEnum: false,
    relatedTypes: [
      {
        name: "MonitorCriteriaInstance",
        path: "monitor-criteria-instance",
        relationship: "Parent that holds the incidents array",
      },
      {
        name: "CriteriaAlert",
        path: "criteria-alert",
        relationship: "Lighter-weight alternative to incidents",
      },
    ],
    properties: [
      {
        name: "id",
        type: "string (UUID)",
        required: true,
        description:
          "A unique identifier for this incident configuration. Generate a UUID v4 value.",
      },
      {
        name: "title",
        type: "string",
        required: true,
        description:
          "The title of the auto-created incident. Supports template variables like {monitorName} which are replaced with the monitor's name at runtime.",
      },
      {
        name: "description",
        type: "string",
        required: true,
        description:
          "A description of the incident. Supports template variables. Displayed in the incident details.",
      },
      {
        name: "incidentSeverityId",
        type: "ObjectID",
        required: true,
        description:
          "The ID of an IncidentSeverity resource (e.g., Critical, Major, Minor). List your project's incident severities via the IncidentSeverity API to get the correct ID.",
      },
      {
        name: "autoResolveIncident",
        type: "boolean",
        required: false,
        description:
          "If true, the incident is automatically resolved when the criteria that created it no longer matches (e.g., the monitor recovers). Defaults to false.",
      },
      {
        name: "remediationNotes",
        type: "string",
        required: false,
        description:
          "Notes for the on-call team on how to remediate this incident. Displayed in the incident details.",
      },
      {
        name: "onCallPolicyIds",
        type: "Array<ObjectID>",
        required: false,
        description:
          "Array of OnCallDutyPolicy IDs to notify when this incident is created. The policies determine who gets paged.",
      },
      {
        name: "labelIds",
        type: "Array<ObjectID>",
        required: false,
        description:
          "Array of Label IDs to apply to the auto-created incident for categorization and filtering.",
      },
      {
        name: "ownerTeamIds",
        type: "Array<ObjectID>",
        required: false,
        description: "Array of Team IDs to assign as owners of the incident.",
      },
      {
        name: "ownerUserIds",
        type: "Array<ObjectID>",
        required: false,
        description: "Array of User IDs to assign as owners of the incident.",
      },
      {
        name: "showIncidentOnStatusPage",
        type: "boolean",
        required: false,
        description:
          "If true, the incident is automatically displayed on the public status page. Defaults to false.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        title: "{monitorName} is offline",
        description:
          "{monitorName} is currently not responding. Please investigate immediately.",
        incidentSeverityId: "660e8400-e29b-41d4-a716-446655440001",
        autoResolveIncident: true,
        remediationNotes:
          "1. Check server logs for errors\n2. Verify network connectivity\n3. Restart the service if needed",
        onCallPolicyIds: ["770e8400-e29b-41d4-a716-446655440002"],
        labelIds: ["880e8400-e29b-41d4-a716-446655440003"],
        ownerTeamIds: ["990e8400-e29b-41d4-a716-446655440004"],
        ownerUserIds: [],
        showIncidentOnStatusPage: true,
      },
      null,
      2,
    ),
  },
  "criteria-alert": {
    title: "CriteriaAlert",
    description:
      "Configuration for an alert that is automatically created when a MonitorCriteriaInstance's conditions are met. Alerts are lighter-weight than incidents and are used for warnings or non-critical notifications. When createAlerts is true on the parent MonitorCriteriaInstance, one or more alerts with these settings are created. See MonitorCriteriaInstance for how this is used, and CriteriaIncident for the heavier incident equivalent.",
    isEnum: false,
    relatedTypes: [
      {
        name: "MonitorCriteriaInstance",
        path: "monitor-criteria-instance",
        relationship: "Parent that holds the alerts array",
      },
      {
        name: "CriteriaIncident",
        path: "criteria-incident",
        relationship: "Heavier-weight alternative for critical issues",
      },
    ],
    properties: [
      {
        name: "id",
        type: "string (UUID)",
        required: true,
        description:
          "A unique identifier for this alert configuration. Generate a UUID v4 value.",
      },
      {
        name: "title",
        type: "string",
        required: true,
        description:
          "The title of the auto-created alert. Supports template variables like {monitorName}.",
      },
      {
        name: "description",
        type: "string",
        required: true,
        description:
          "A description of the alert. Supports template variables. Displayed in the alert details.",
      },
      {
        name: "alertSeverityId",
        type: "ObjectID",
        required: true,
        description:
          "The ID of an AlertSeverity resource (e.g., Warning, Info). List your project's alert severities via the AlertSeverity API to get the correct ID.",
      },
      {
        name: "autoResolveAlert",
        type: "boolean",
        required: false,
        description:
          "If true, the alert is automatically resolved when the criteria that created it no longer matches. Defaults to false.",
      },
      {
        name: "remediationNotes",
        type: "string",
        required: false,
        description:
          "Notes on how to remediate this alert. Displayed in the alert details.",
      },
      {
        name: "onCallPolicyIds",
        type: "Array<ObjectID>",
        required: false,
        description:
          "Array of OnCallDutyPolicy IDs to notify when this alert is created.",
      },
      {
        name: "labelIds",
        type: "Array<ObjectID>",
        required: false,
        description: "Array of Label IDs to apply to the auto-created alert.",
      },
      {
        name: "ownerTeamIds",
        type: "Array<ObjectID>",
        required: false,
        description: "Array of Team IDs to assign as owners of the alert.",
      },
      {
        name: "ownerUserIds",
        type: "Array<ObjectID>",
        required: false,
        description: "Array of User IDs to assign as owners of the alert.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        title: "{monitorName} - Slow response time",
        description:
          "{monitorName} response time exceeds the threshold. Performance may be degraded.",
        alertSeverityId: "660e8400-e29b-41d4-a716-446655440001",
        autoResolveAlert: true,
        remediationNotes:
          "Check application performance and database query times.",
        onCallPolicyIds: [],
        labelIds: [],
        ownerTeamIds: ["770e8400-e29b-41d4-a716-446655440002"],
        ownerUserIds: [],
      },
      null,
      2,
    ),
  },
  "check-on": {
    title: "CheckOn",
    description:
      "Enum specifying what aspect of a monitor response or system metric to evaluate in a CriteriaFilter. The available CheckOn values depend on the monitor type. For example, 'Response Status Code' applies to Website and API monitors, while 'CPU Usage (in %)' applies to Server monitors. See CriteriaFilter for how this is used, and FilterType for the comparison operators that can be applied.",
    isEnum: true,
    relatedTypes: [
      {
        name: "CriteriaFilter",
        path: "criteria-filter",
        relationship: "Used as the checkOn property",
      },
      {
        name: "FilterType",
        path: "filter-type",
        relationship: "Paired with CheckOn to define comparisons",
      },
      {
        name: "MonitorCriteriaInstance",
        path: "monitor-criteria-instance",
        relationship: "Contains filters that use CheckOn",
      },
    ],
    properties: [],
    values: [
      {
        value: "Is Online",
        description:
          "Whether the target is reachable. Use with FilterType 'True' or 'False'. Applies to: Website, API, Ping, IP, Port, SSL Certificate monitors.",
      },
      {
        value: "Is Request Timeout",
        description:
          "Whether the request timed out. Use with FilterType 'True' or 'False'. Applies to: Website, API monitors.",
      },
      {
        value: "Response Time (in ms)",
        description:
          "The response time in milliseconds. Use with numeric FilterTypes like 'Greater Than', 'Less Than'. Applies to: Website, API monitors.",
      },
      {
        value: "Response Status Code",
        description:
          "The HTTP response status code (e.g., 200, 404, 500). Use with 'Equal To', 'Not Equal To', etc. Applies to: Website, API monitors.",
      },
      {
        value: "Response Header",
        description:
          "Check if a specific response header exists. Use with 'Contains', 'Is Empty'. Applies to: Website, API monitors.",
      },
      {
        value: "Response Header Value",
        description:
          "The value of a specific response header. Use with text FilterTypes. Applies to: Website, API monitors.",
      },
      {
        value: "Response Body",
        description:
          "The response body content. Use with 'Contains', 'Not Contains', 'Is Empty'. Applies to: Website, API monitors.",
      },
      {
        value: "Request Body",
        description:
          "The request body content for incoming request monitors. Use with text FilterTypes. Applies to: Incoming Request monitors.",
      },
      {
        value: "Request Header",
        description:
          "Check if a specific request header exists. Applies to: Incoming Request monitors.",
      },
      {
        value: "Request Header Value",
        description:
          "The value of a specific request header. Applies to: Incoming Request monitors.",
      },
      {
        value: "CPU Usage (in %)",
        description:
          "Server CPU utilization percentage (0-100). Use with numeric FilterTypes. Applies to: Server monitors.",
      },
      {
        value: "Memory Usage (in %)",
        description:
          "Server memory utilization percentage (0-100). Use with numeric FilterTypes. Applies to: Server monitors.",
      },
      {
        value: "Disk Usage (in %)",
        description:
          "Server disk utilization percentage (0-100). Requires serverMonitorOptions.diskPath to specify which disk. Applies to: Server monitors.",
      },
      {
        value: "Server Process Name",
        description:
          "Check if a process with a given name is running. Use with 'Is Executing' or 'Is Not Executing'. Applies to: Server monitors.",
      },
      {
        value: "Server Process PID",
        description:
          "Check if a process with a given PID is running. Use with 'Is Executing' or 'Is Not Executing'. Applies to: Server monitors.",
      },
      {
        value: "Server Process Command",
        description:
          "Check if a process with a given command is running. Use with 'Is Executing' or 'Is Not Executing'. Applies to: Server monitors.",
      },
      {
        value: "Expires In Hours",
        description:
          "Hours until SSL certificate expiration. Use with numeric FilterTypes. Applies to: SSL Certificate monitors.",
      },
      {
        value: "Expires In Days",
        description:
          "Days until SSL certificate expiration. Use with numeric FilterTypes. Applies to: SSL Certificate monitors.",
      },
      {
        value: "Is Self Signed Certificate",
        description:
          "Whether the SSL certificate is self-signed. Use with 'True' or 'False'. Applies to: SSL Certificate monitors.",
      },
      {
        value: "Is Expired Certificate",
        description:
          "Whether the SSL certificate has expired. Use with 'True' or 'False'. Applies to: SSL Certificate monitors.",
      },
      {
        value: "Is Valid Certificate",
        description:
          "Whether the SSL certificate is valid. Use with 'True' or 'False'. Applies to: SSL Certificate monitors.",
      },
      {
        value: "Is Not A Valid Certificate",
        description:
          "Whether the SSL certificate is invalid. Use with 'True' or 'False'. Applies to: SSL Certificate monitors.",
      },
      {
        value: "Result Value",
        description:
          "The return value from custom JavaScript code execution. Use with any FilterType. Applies to: Custom JavaScript Code monitors.",
      },
      {
        value: "Error",
        description:
          "Whether the custom code execution produced an error. Use with 'Contains', 'Is Empty'. Applies to: Custom JavaScript Code, Synthetic monitors.",
      },
      {
        value: "Execution Time (in ms)",
        description:
          "The time taken to execute custom code in milliseconds. Use with numeric FilterTypes. Applies to: Custom JavaScript Code, Synthetic monitors.",
      },
      {
        value: "Screen Size",
        description:
          "The screen size used during synthetic test. Use with 'Equal To'. Applies to: Synthetic monitors.",
      },
      {
        value: "Browser Type",
        description:
          "The browser type used during synthetic test. Use with 'Equal To'. Applies to: Synthetic monitors.",
      },
      {
        value: "Log Count",
        description:
          "The number of log entries matching the log monitor filter in the configured time window. Use with numeric FilterTypes. Applies to: Log monitors.",
      },
      {
        value: "Span Count",
        description:
          "The number of trace spans matching the trace monitor filter. Use with numeric FilterTypes. Applies to: Trace monitors.",
      },
      {
        value: "Exception Count",
        description:
          "The number of exceptions matching the exception monitor filter. Use with numeric FilterTypes. Applies to: Exception monitors.",
      },
      {
        value: "Metric Value",
        description:
          "The value of a metric. Requires metricMonitorOptions to specify which metric. Use with numeric FilterTypes. Applies to: Metric monitors.",
      },
      {
        value: "Incoming Request",
        description:
          "Whether an incoming HTTP request was received. Use with 'Recieved In Minutes' or 'Not Recieved In Minutes' FilterType. Applies to: Incoming Request monitors.",
      },
      {
        value: "Email Subject",
        description:
          "The subject of an incoming email. Use with text FilterTypes. Applies to: Incoming Email monitors.",
      },
      {
        value: "Email From Address",
        description:
          "The sender address of an incoming email. Use with text FilterTypes. Applies to: Incoming Email monitors.",
      },
      {
        value: "Email Body",
        description:
          "The body of an incoming email. Use with text FilterTypes. Applies to: Incoming Email monitors.",
      },
      {
        value: "Email To Address",
        description:
          "The recipient address of an incoming email. Use with text FilterTypes. Applies to: Incoming Email monitors.",
      },
      {
        value: "Email Received",
        description:
          "Whether an email was received. Use with 'Recieved In Minutes' or 'Not Recieved In Minutes'. Applies to: Incoming Email monitors.",
      },
      {
        value: "SNMP OID Value",
        description:
          "The value returned for a specific SNMP OID. Requires snmpMonitorOptions.oid. Use with any FilterType. Applies to: SNMP monitors.",
      },
      {
        value: "SNMP OID Exists",
        description:
          "Whether a specific SNMP OID exists on the device. Requires snmpMonitorOptions.oid. Use with 'True' or 'False'. Applies to: SNMP monitors.",
      },
      {
        value: "SNMP Response Time (in ms)",
        description:
          "The SNMP query response time in milliseconds. Use with numeric FilterTypes. Applies to: SNMP monitors.",
      },
      {
        value: "SNMP Device Is Online",
        description:
          "Whether the SNMP device is reachable. Use with 'True' or 'False'. Applies to: SNMP monitors.",
      },
      {
        value: "DNS Response Time (in ms)",
        description:
          "The DNS query response time in milliseconds. Use with numeric FilterTypes. Applies to: DNS monitors.",
      },
      {
        value: "DNS Is Online",
        description:
          "Whether the DNS resolution succeeded. Use with 'True' or 'False'. Applies to: DNS monitors.",
      },
      {
        value: "DNS Record Value",
        description:
          "The value of a DNS record returned by the query. Use with string FilterTypes (Contains, EqualTo, etc.). Applies to: DNS monitors.",
      },
      {
        value: "DNSSEC Is Valid",
        description:
          "Whether DNSSEC validation passed (AD flag present). Use with 'True' or 'False'. Applies to: DNS monitors.",
      },
      {
        value: "DNS Record Exists",
        description:
          "Whether any DNS records were returned for the query. Use with 'True' or 'False'. Applies to: DNS monitors.",
      },
      {
        value: "JavaScript Expression",
        description:
          "A JavaScript expression to evaluate against the monitor result. Use with 'Evaluates To True'. Applies to: Custom JavaScript Code monitors.",
      },
    ],
    jsonExample: JSON.stringify(
      {
        "// Use CheckOn values in CriteriaFilter objects": "",
        "// Website/API example": {
          checkOn: "Response Status Code",
          filterType: "Equal To",
          value: 200,
        },
        "// Server example": {
          checkOn: "CPU Usage (in %)",
          filterType: "Greater Than",
          value: 90,
        },
        "// SSL Certificate example": {
          checkOn: "Expires In Days",
          filterType: "Less Than",
          value: 14,
        },
        "// Incoming Request example": {
          checkOn: "Incoming Request",
          filterType: "Not Recieved In Minutes",
          value: 30,
        },
      },
      null,
      2,
    ),
  },
  "filter-type": {
    title: "FilterType",
    description:
      "Enum specifying the comparison operator used in a CriteriaFilter. Determines how the monitored value (specified by CheckOn) is compared against the expected value. See CriteriaFilter for how this is used with CheckOn values.",
    isEnum: true,
    relatedTypes: [
      {
        name: "CriteriaFilter",
        path: "criteria-filter",
        relationship: "Used as the filterType property",
      },
      {
        name: "CheckOn",
        path: "check-on",
        relationship: "Paired with FilterType to define comparisons",
      },
      {
        name: "MonitorCriteriaInstance",
        path: "monitor-criteria-instance",
        relationship: "Contains filters that use FilterType",
      },
    ],
    properties: [],
    values: [
      {
        value: "Equal To",
        description:
          "Matches when the checked value equals the specified value. Works with numbers, strings, and status codes.",
      },
      {
        value: "Not Equal To",
        description:
          "Matches when the checked value does not equal the specified value.",
      },
      {
        value: "Greater Than",
        description:
          "Matches when the checked value is greater than the specified value. For numeric checks like response time, CPU %, etc.",
      },
      {
        value: "Less Than",
        description:
          "Matches when the checked value is less than the specified value.",
      },
      {
        value: "Greater Than Or Equal To",
        description:
          "Matches when the checked value is greater than or equal to the specified value.",
      },
      {
        value: "Less Than Or Equal To",
        description:
          "Matches when the checked value is less than or equal to the specified value.",
      },
      {
        value: "Contains",
        description:
          "Matches when the checked string value contains the specified substring. For text checks like response body, headers.",
      },
      {
        value: "Not Contains",
        description:
          "Matches when the checked string value does not contain the specified substring.",
      },
      {
        value: "Starts With",
        description:
          "Matches when the checked string value starts with the specified prefix.",
      },
      {
        value: "Ends With",
        description:
          "Matches when the checked string value ends with the specified suffix.",
      },
      {
        value: "Is Empty",
        description:
          "Matches when the checked value is empty or not present. No value parameter needed.",
      },
      {
        value: "Is Not Empty",
        description:
          "Matches when the checked value exists and is not empty. No value parameter needed.",
      },
      {
        value: "True",
        description:
          "Matches when the checked boolean value is true. Used with CheckOn values like 'Is Online', 'Is Valid Certificate'. No value parameter needed.",
      },
      {
        value: "False",
        description:
          "Matches when the checked boolean value is false. Used with CheckOn values like 'Is Online', 'Is Expired Certificate'. No value parameter needed.",
      },
      {
        value: "Not Recieved In Minutes",
        description:
          "Matches when no request/email has been received within the specified number of minutes. Used with 'Incoming Request' and 'Email Received' CheckOn values. The value parameter is the number of minutes.",
      },
      {
        value: "Recieved In Minutes",
        description:
          "Matches when a request/email has been received within the specified number of minutes. Used with 'Incoming Request' and 'Email Received' CheckOn values. The value parameter is the number of minutes.",
      },
      {
        value: "Evaluates To True",
        description:
          "Matches when a JavaScript expression evaluates to true. Used with 'JavaScript Expression' CheckOn.",
      },
      {
        value: "Is Executing",
        description:
          "Matches when a server process is currently running. Used with 'Server Process Name', 'Server Process PID', 'Server Process Command' CheckOn values.",
      },
      {
        value: "Is Not Executing",
        description:
          "Matches when a server process is not currently running. Used with 'Server Process Name', 'Server Process PID', 'Server Process Command' CheckOn values.",
      },
    ],
    jsonExample: JSON.stringify(
      {
        "// Numeric comparison": {
          checkOn: "Response Time (in ms)",
          filterType: "Greater Than",
          value: 5000,
        },
        "// Boolean check (no value needed)": {
          checkOn: "Is Online",
          filterType: "True",
        },
        "// Text search": {
          checkOn: "Response Body",
          filterType: "Contains",
          value: "error",
        },
        "// Time-based check": {
          checkOn: "Incoming Request",
          filterType: "Not Recieved In Minutes",
          value: 30,
        },
        "// Process check": {
          checkOn: "Server Process Name",
          filterType: "Is Not Executing",
          value: "nginx",
        },
      },
      null,
      2,
    ),
  },
  "filter-condition": {
    title: "FilterCondition",
    description:
      "Enum specifying how multiple CriteriaFilter objects within a MonitorCriteriaInstance are combined. Determines whether all filters must match (AND logic) or any single filter matching is sufficient (OR logic). See MonitorCriteriaInstance for how this is used.",
    isEnum: true,
    relatedTypes: [
      {
        name: "MonitorCriteriaInstance",
        path: "monitor-criteria-instance",
        relationship: "Uses FilterCondition to combine filters",
      },
      {
        name: "CriteriaFilter",
        path: "criteria-filter",
        relationship: "The filters that are combined",
      },
    ],
    properties: [],
    values: [
      {
        value: "All",
        description:
          "All filters in the array must evaluate to true for the criteria to match (AND logic). Use when you need every condition to be satisfied. Example: 'Is Online = True' AND 'Response Status Code = 200'.",
      },
      {
        value: "Any",
        description:
          "At least one filter in the array must evaluate to true for the criteria to match (OR logic). Use for failure detection where any single issue should trigger the criteria. Example: 'Is Online = False' OR 'Response Status Code != 200'.",
      },
    ],
    jsonExample: JSON.stringify(
      {
        "// AND logic - all conditions must be true": {
          filterCondition: "All",
          filters: [
            { checkOn: "Is Online", filterType: "True" },
            {
              checkOn: "Response Status Code",
              filterType: "Equal To",
              value: 200,
            },
            {
              checkOn: "Response Time (in ms)",
              filterType: "Less Than",
              value: 5000,
            },
          ],
        },
        "// OR logic - any condition triggers": {
          filterCondition: "Any",
          filters: [
            { checkOn: "Is Online", filterType: "False" },
            {
              checkOn: "Response Status Code",
              filterType: "Not Equal To",
              value: 200,
            },
          ],
        },
      },
      null,
      2,
    ),
  },
  "monitor-step-log-monitor": {
    title: "MonitorStepLogMonitor",
    description:
      "Configuration for a Log monitor step. Defines which logs to query and evaluate, including severity filters, body search text, telemetry service filters, and the time window. Used as the 'logMonitor' property on a MonitorStep when the monitor type is 'Logs'. The criteria filters on the parent MonitorStep then use 'Log Count' as the CheckOn value to evaluate the number of matching logs.",
    isEnum: false,
    relatedTypes: [
      {
        name: "MonitorStep",
        path: "monitor-step",
        relationship: "Parent that holds this as logMonitor property",
      },
      {
        name: "CheckOn",
        path: "check-on",
        relationship: "Use 'Log Count' CheckOn with log monitors",
      },
    ],
    properties: [
      {
        name: "attributes",
        type: "Dictionary<string | number | boolean>",
        required: true,
        description:
          "Key-value pairs of log attributes to filter on. Only logs matching all specified attributes are included. Use an empty object {} to match all logs.",
      },
      {
        name: "body",
        type: "string",
        required: true,
        description:
          "Text to search for in log body/message. Only logs containing this text are included. Use an empty string to match all log bodies.",
      },
      {
        name: "severityTexts",
        type: "Array<string>",
        required: true,
        description:
          "Log severity levels to include. Possible values: 'Unspecified', 'Trace', 'Debug', 'Information', 'Warning', 'Error', 'Fatal'. Use an empty array to include all severities.",
      },
      {
        name: "telemetryServiceIds",
        type: "Array<ObjectID>",
        required: true,
        description:
          "Array of TelemetryService IDs to filter logs from. Only logs from these services are included. Use an empty array to include logs from all services.",
      },
      {
        name: "lastXSecondsOfLogs",
        type: "number",
        required: true,
        description:
          "The time window in seconds. Only logs from the last X seconds are evaluated. For example, 300 means the last 5 minutes of logs.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        attributes: { "service.environment": "production" },
        body: "ERROR",
        severityTexts: ["Error", "Fatal"],
        telemetryServiceIds: ["550e8400-e29b-41d4-a716-446655440000"],
        lastXSecondsOfLogs: 300,
      },
      null,
      2,
    ),
  },
  "monitor-step-trace-monitor": {
    title: "MonitorStepTraceMonitor",
    description:
      "Configuration for a Trace monitor step. Defines which trace spans to query and evaluate, including span status filters, span name search, telemetry service filters, and the time window. Used as the 'traceMonitor' property on a MonitorStep when the monitor type is 'Traces'. The criteria filters then use 'Span Count' as the CheckOn value.",
    isEnum: false,
    relatedTypes: [
      {
        name: "MonitorStep",
        path: "monitor-step",
        relationship: "Parent that holds this as traceMonitor property",
      },
      {
        name: "CheckOn",
        path: "check-on",
        relationship: "Use 'Span Count' CheckOn with trace monitors",
      },
    ],
    properties: [
      {
        name: "attributes",
        type: "Dictionary<string | number | boolean>",
        required: true,
        description:
          "Key-value pairs of span attributes to filter on. Only spans matching all specified attributes are included. Use an empty object {} to match all spans.",
      },
      {
        name: "spanStatuses",
        type: "Array<string>",
        required: true,
        description:
          "Span status codes to include. Possible values: 'Unset', 'Ok', 'Error'. Use an empty array to include all statuses.",
      },
      {
        name: "spanName",
        type: "string",
        required: true,
        description:
          "Text to search for in the span name. Only spans whose name contains this text are included. Use an empty string to match all span names.",
      },
      {
        name: "telemetryServiceIds",
        type: "Array<ObjectID>",
        required: true,
        description:
          "Array of TelemetryService IDs to filter spans from. Only spans from these services are included. Use an empty array for all services.",
      },
      {
        name: "lastXSecondsOfSpans",
        type: "number",
        required: true,
        description:
          "The time window in seconds. Only spans from the last X seconds are evaluated. For example, 600 means the last 10 minutes.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        attributes: { "http.method": "POST" },
        spanStatuses: ["Error"],
        spanName: "/api/checkout",
        telemetryServiceIds: ["550e8400-e29b-41d4-a716-446655440000"],
        lastXSecondsOfSpans: 600,
      },
      null,
      2,
    ),
  },
  "monitor-step-metric-monitor": {
    title: "MonitorStepMetricMonitor",
    description:
      "Configuration for a Metric monitor step. Defines the metric query and the rolling time window for evaluation. Used as the 'metricMonitor' property on a MonitorStep when the monitor type is 'Metrics'. The criteria filters then use 'Metric Value' as the CheckOn value with metricMonitorOptions to specify the metric alias.",
    isEnum: false,
    relatedTypes: [
      {
        name: "MonitorStep",
        path: "monitor-step",
        relationship: "Parent that holds this as metricMonitor property",
      },
      {
        name: "CheckOn",
        path: "check-on",
        relationship: "Use 'Metric Value' CheckOn with metric monitors",
      },
    ],
    properties: [
      {
        name: "metricViewConfig",
        type: "object",
        required: true,
        description:
          "The metric query configuration. Contains 'queryConfigs' (array of metric queries with name, query, and formula) and 'formulaConfigs' (array of formulas that combine queries).",
      },
      {
        name: "rollingTime",
        type: "string",
        required: true,
        description:
          "The time window for metric evaluation. Possible values: 'Past 1 Minute', 'Past 5 Minutes', 'Past 10 Minutes', 'Past 15 Minutes', 'Past 30 Minutes', 'Past 1 Hour', 'Past 3 Hours', 'Past 6 Hours', 'Past 12 Hours', 'Past 1 Day'.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        metricViewConfig: {
          queryConfigs: [],
          formulaConfigs: [],
        },
        rollingTime: "Past 5 Minutes",
      },
      null,
      2,
    ),
  },
  "monitor-step-snmp-monitor": {
    title: "MonitorStepSnmpMonitor",
    description:
      "Configuration for an SNMP monitor step. Defines the SNMP device connection settings (version, hostname, authentication) and the OIDs to query. Used as the 'snmpMonitor' property on a MonitorStep when the monitor type is 'SNMP'. The criteria filters can then use 'SNMP OID Value', 'SNMP OID Exists', 'SNMP Response Time (in ms)', and 'SNMP Device Is Online' as CheckOn values.",
    isEnum: false,
    relatedTypes: [
      {
        name: "MonitorStep",
        path: "monitor-step",
        relationship: "Parent that holds this as snmpMonitor property",
      },
      {
        name: "CheckOn",
        path: "check-on",
        relationship: "Use SNMP-specific CheckOn values with SNMP monitors",
      },
    ],
    properties: [
      {
        name: "snmpVersion",
        type: "string (enum)",
        required: true,
        description:
          "The SNMP protocol version. Possible values: 'V1', 'V2c', 'V3'. Use V2c for most devices, V3 for secure environments.",
      },
      {
        name: "hostname",
        type: "string",
        required: true,
        description:
          "The hostname or IP address of the SNMP device to monitor.",
      },
      {
        name: "port",
        type: "number",
        required: true,
        description: "The SNMP port. Default is 161.",
      },
      {
        name: "communityString",
        type: "string",
        required: false,
        description:
          "The SNMP community string for V1/V2c authentication. Typically 'public' for read-only access. Not used for V3.",
      },
      {
        name: "snmpV3Auth",
        type: "object",
        required: false,
        description:
          "SNMP V3 authentication settings. Required when snmpVersion is 'V3'. Contains: securityLevel ('noAuthNoPriv', 'authNoPriv', 'authPriv'), username (string), authProtocol ('MD5' or 'SHA'), authKey (string), privProtocol ('DES' or 'AES'), privKey (string).",
      },
      {
        name: "oids",
        type: "Array<object>",
        required: true,
        description:
          "Array of SNMP OIDs to query. Each object has: oid (string, e.g., '1.3.6.1.2.1.1.3.0'), name (optional string, human-readable name), description (optional string).",
      },
      {
        name: "timeout",
        type: "number",
        required: true,
        description:
          "Timeout for SNMP queries in milliseconds. Default is 5000 (5 seconds).",
      },
      {
        name: "retries",
        type: "number",
        required: true,
        description: "Number of retries for failed SNMP queries. Default is 3.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        "// Example 1: SNMP V2c (most common)": {
          snmpVersion: "V2c",
          hostname: "switch.example.com",
          port: 161,
          communityString: "public",
          oids: [
            {
              oid: "1.3.6.1.2.1.1.3.0",
              name: "sysUpTime",
              description: "System uptime",
            },
            {
              oid: "1.3.6.1.2.1.25.3.3.1.2",
              name: "cpuLoad",
              description: "CPU load percentage",
            },
          ],
          timeout: 5000,
          retries: 3,
        },
        "// Example 2: SNMP V3 (secure)": {
          snmpVersion: "V3",
          hostname: "router.example.com",
          port: 161,
          snmpV3Auth: {
            securityLevel: "authPriv",
            username: "monitor-user",
            authProtocol: "SHA",
            authKey: "auth-passphrase",
            privProtocol: "AES",
            privKey: "priv-passphrase",
          },
          oids: [
            {
              oid: "1.3.6.1.2.1.2.2.1.10.1",
              name: "ifInOctets",
              description: "Inbound traffic on interface 1",
            },
          ],
          timeout: 5000,
          retries: 3,
        },
      },
      null,
      2,
    ),
  },
  "monitor-step-dns-monitor": {
    title: "MonitorStepDnsMonitor",
    description:
      "Configuration for a DNS monitor step. Defines the domain to query, record type, optional custom DNS server, and timeout settings. Used as the 'dnsMonitor' property on a MonitorStep when the monitor type is 'DNS'. The criteria filters can then use 'DNS Is Online', 'DNS Response Time (in ms)', 'DNS Record Value', 'DNSSEC Is Valid', and 'DNS Record Exists' as CheckOn values.",
    isEnum: false,
    relatedTypes: [
      {
        name: "MonitorStep",
        path: "monitor-step",
        relationship: "Parent that holds this as dnsMonitor property",
      },
      {
        name: "CheckOn",
        path: "check-on",
        relationship: "Use DNS-specific CheckOn values with DNS monitors",
      },
    ],
    properties: [
      {
        name: "queryName",
        type: "string",
        required: true,
        description:
          "The domain name to query (e.g., 'example.com').",
      },
      {
        name: "recordType",
        type: "string (enum)",
        required: true,
        description:
          "The DNS record type to query. Possible values: 'A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'PTR', 'SRV', 'CAA'.",
      },
      {
        name: "hostname",
        type: "string",
        required: false,
        description:
          "Custom DNS server to use for the query (e.g., '8.8.8.8'). Leave empty to use system default DNS resolver.",
      },
      {
        name: "port",
        type: "number",
        required: false,
        description: "DNS port. Default is 53.",
      },
      {
        name: "timeout",
        type: "number",
        required: false,
        description:
          "Timeout for DNS queries in milliseconds. Default is 5000 (5 seconds).",
      },
      {
        name: "retries",
        type: "number",
        required: false,
        description: "Number of retries for failed DNS queries. Default is 3.",
      },
    ],
    values: [],
    jsonExample: JSON.stringify(
      {
        "// Example 1: Basic A record lookup": {
          queryName: "example.com",
          recordType: "A",
          timeout: 5000,
          retries: 3,
        },
        "// Example 2: MX record with custom DNS server": {
          queryName: "example.com",
          recordType: "MX",
          hostname: "8.8.8.8",
          port: 53,
          timeout: 5000,
          retries: 3,
        },
        "// Example 3: TXT record for SPF verification": {
          queryName: "example.com",
          recordType: "TXT",
          hostname: "1.1.1.1",
          timeout: 5000,
          retries: 3,
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

    // Linkify descriptions to create clickable type references
    const linkedProperties: Array<DataTypeProperty> = detail.properties.map(
      (prop: DataTypeProperty) => {
        return {
          ...prop,
          description: linkifyDescription(prop.description),
        };
      },
    );

    const linkedValues: Array<DataTypeValue> = detail.values.map(
      (val: DataTypeValue) => {
        return {
          ...val,
          description: linkifyDescription(val.description),
        };
      },
    );

    // Enrich related types with descriptions from the DataTypes registry
    const enrichedRelatedTypes: Array<RelatedType> = (
      detail.relatedTypes || []
    ).map((rt: RelatedType) => {
      const dtDoc: DataTypeDocumentation | undefined = DataTypesByPath[rt.path];
      const desc: string | undefined =
        rt.description || (dtDoc ? dtDoc.description : undefined);
      const result: RelatedType = {
        name: rt.name,
        path: rt.path,
        relationship: rt.relationship,
      };
      if (desc !== undefined) {
        result.description = desc;
      }
      return result;
    });

    // Extract _type wrapper from JSON example
    let jsonWrapperType: string = detail.title;
    try {
      const parsed: Record<string, unknown> = JSON.parse(
        detail.jsonExample,
      ) as Record<string, unknown>;
      if (parsed["_type"] && typeof parsed["_type"] === "string") {
        jsonWrapperType = parsed["_type"];
      }
    } catch {
      // ignore parse errors
    }

    const pageData: Dictionary<unknown> = {
      title: detail.title,
      description: linkifyDescription(detail.description),
      isEnum: detail.isEnum,
      properties: linkedProperties,
      values: linkedValues,
      jsonExample: detail.jsonExample,
      relatedTypes: enrichedRelatedTypes,
      typeHierarchy: detail.typeHierarchy || [],
      propertyCount: linkedProperties.length,
      valueCount: linkedValues.length,
      jsonWrapperType: jsonWrapperType,
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
