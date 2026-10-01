import { JSONObject } from "../../Types/JSON";
import { Hcl, HclExpression, HclObjectAttribute } from "./Hcl";
import {
  isJSONObject,
  isMonitorSecretReference,
  isSecretHeaderName,
  jsonencodeWithSecretVariables,
  TerraformVariableCollector,
  unwrapApiNumber,
  unwrapApiString,
} from "./TerraformValues";

/*
 * A monitor's steps as the provider's typed `monitor_steps` attribute.
 *
 * This is the provider's MonitorStepsFromAPI
 * (Scripts/TerraformProvider/StaticFiles/monitorsteps.go), ported field for
 * field: the provider stores exactly that conversion of the API's value in
 * its state, so configuration written from the same conversion matches the
 * state and `terraform plan` stays clean after an import. Like the provider:
 *
 *   - server-generated ids, `defaultMonitorStatusId` and the server-hydrated
 *     `snmpMonitor` are dropped, as is any key the schema does not model;
 *   - empty strings and empty lists or maps count as unset;
 *   - a filter's value is written as a string ("200", "99.5");
 *   - the per-monitor-type configuration objects (log_monitor, sql_monitor,
 *     ...) are raw JSON, written with jsonencode().
 *
 * Unlike the provider, secrets never reach the page: a TLS client key, its
 * passphrase, a credential header and any secret inside the raw JSON objects
 * are read from a Terraform variable instead (see TerraformVariableCollector).
 * Monitor secret references ({{monitorSecrets.name}}) are kept: they are not
 * the secret itself.
 */

const DESTINATION_TYPES: ReadonlyArray<string> = ["URL", "IP", "Hostname"];

// Per-monitor-type configuration objects: provider attribute, API key.
export const MONITOR_STEP_SUB_CONFIGS: ReadonlyArray<{
  attributeName: string;
  apiKey: string;
}> = [
  { attributeName: "log_monitor", apiKey: "logMonitor" },
  { attributeName: "trace_monitor", apiKey: "traceMonitor" },
  { attributeName: "metric_monitor", apiKey: "metricMonitor" },
  { attributeName: "exception_monitor", apiKey: "exceptionMonitor" },
  { attributeName: "profile_monitor", apiKey: "profileMonitor" },
  { attributeName: "network_device_monitor", apiKey: "networkDeviceMonitor" },
  { attributeName: "dns_monitor", apiKey: "dnsMonitor" },
  { attributeName: "domain_monitor", apiKey: "domainMonitor" },
  { attributeName: "dnssec_monitor", apiKey: "dnssecMonitor" },
  { attributeName: "sql_monitor", apiKey: "sqlMonitor" },
  { attributeName: "database_monitor", apiKey: "databaseMonitor" },
  {
    attributeName: "external_status_page_monitor",
    apiKey: "externalStatusPageMonitor",
  },
  { attributeName: "kubernetes_monitor", apiKey: "kubernetesMonitor" },
  { attributeName: "docker_monitor", apiKey: "dockerMonitor" },
  { attributeName: "host_monitor", apiKey: "hostMonitor" },
  { attributeName: "podman_monitor", apiKey: "podmanMonitor" },
  { attributeName: "proxmox_monitor", apiKey: "proxmoxMonitor" },
  { attributeName: "vmware_monitor", apiKey: "vmwareMonitor" },
  { attributeName: "docker_swarm_monitor", apiKey: "dockerSwarmMonitor" },
  { attributeName: "ceph_monitor", apiKey: "cephMonitor" },
  { attributeName: "iot_monitor", apiKey: "iotMonitor" },
];

// Filter options that are raw JSON, like the step sub-configs.
const FILTER_JSON_OPTIONS: ReadonlyArray<{
  attributeName: string;
  apiKey: string;
}> = [
  { attributeName: "metric_monitor_options", apiKey: "metricMonitorOptions" },
  { attributeName: "snmp_monitor_options", apiKey: "snmpMonitorOptions" },
  {
    attributeName: "database_monitor_options",
    apiKey: "databaseMonitorOptions",
  },
];

const INCIDENT_AND_ALERT_ID_LISTS: ReadonlyArray<{
  attributeName: string;
  apiKey: string;
}> = [
  { attributeName: "on_call_policy_ids", apiKey: "onCallPolicyIds" },
  { attributeName: "label_ids", apiKey: "labelIds" },
  { attributeName: "owner_team_ids", apiKey: "ownerTeamIds" },
  { attributeName: "owner_user_ids", apiKey: "ownerUserIds" },
];

export interface MonitorStepsHclContext {
  variables: TerraformVariableCollector;
  // Prefix of the variables secrets are read from, e.g. the resource's local name.
  variablePrefix: string;
  // How the monitor is called in variable descriptions.
  monitorLabel: string;
}

// `{_type: ..., value: {...}}` -> the inner object; anything else as it is.
function unwrapEnvelope(value: JSONObject): JSONObject {
  if (typeof value["_type"] === "string" && isJSONObject(value["value"])) {
    return value["value"] as JSONObject;
  }

  return value;
}

function apiBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function apiInteger(value: unknown): number | null {
  const number: number | null = unwrapApiNumber(value);

  return number === null ? null : Math.trunc(number);
}

// A filter value: strings as they are, numbers as JSON writes them.
function apiNumberOrString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }

  return null;
}

function apiStringList(value: unknown): Array<string> | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const strings: Array<string> = value
    .map((item: unknown): string | null => {
      return unwrapApiString(item);
    })
    .filter((item: string | null): item is string => {
      return item !== null;
    });

  return strings.length > 0 ? strings : null;
}

class AttributeList {
  public readonly attributes: Array<HclObjectAttribute> = [];

  public add(key: string, value: HclExpression | null): void {
    if (value) {
      this.attributes.push({ key, value });
    }
  }

  public addString(key: string, value: string | null): void {
    this.add(key, value === null ? null : Hcl.string(value));
  }

  public addBool(key: string, value: boolean | null): void {
    this.add(key, value === null ? null : Hcl.bool(value));
  }

  public addNumber(key: string, value: number | null): void {
    this.add(key, value === null ? null : Hcl.number(value));
  }

  public addStringList(key: string, value: Array<string> | null): void {
    this.add(
      key,
      value === null
        ? null
        : Hcl.tuple(
            value.map((item: string): HclExpression => {
              return Hcl.string(item);
            }),
          ),
    );
  }

  public toObject(): HclExpression {
    return Hcl.object(this.attributes);
  }
}

// A raw-JSON option: present only when the API holds an object for it.
function rawJsonOption(
  value: unknown,
  attributeName: string,
  context: MonitorStepsHclContext,
): HclExpression | null {
  if (!isJSONObject(value)) {
    return null;
  }

  return jsonencodeWithSecretVariables({
    value,
    variables: context.variables,
    variablePrefix: `${context.variablePrefix}_${attributeName}`,
    describe: (key: string): string => {
      return `The ${key} in the ${attributeName} settings of ${context.monitorLabel}.`;
    },
  });
}

/*
 * A secret string: read from a variable, unless it is a reference to a
 * monitor secret.
 */
function secretString(
  value: string | null,
  attributeName: string,
  description: string,
  context: MonitorStepsHclContext,
): HclExpression | null {
  if (value === null) {
    return null;
  }

  if (isMonitorSecretReference(value)) {
    return Hcl.string(value);
  }

  return context.variables.add(
    `${context.variablePrefix}_${attributeName}`,
    description,
  );
}

function filterToHcl(
  value: unknown,
  context: MonitorStepsHclContext,
): HclExpression | null {
  if (!isJSONObject(value)) {
    return null;
  }

  const filter: JSONObject = unwrapEnvelope(value);
  const attributes: AttributeList = new AttributeList();

  attributes.addString("check_on", unwrapApiString(filter["checkOn"]));
  attributes.addString("filter_type", unwrapApiString(filter["filterType"]));
  attributes.addString("value", apiNumberOrString(filter["value"]));
  attributes.addBool("evaluate_over_time", apiBool(filter["evaluateOverTime"]));

  const overTime: unknown = filter["evaluateOverTimeOptions"];

  if (isJSONObject(overTime)) {
    attributes.addNumber(
      "evaluate_over_time_minutes",
      apiInteger(overTime["timeValueInMinutes"]),
    );
    attributes.addString(
      "evaluate_over_time_type",
      unwrapApiString(overTime["evaluateOverTimeType"]),
    );
    attributes.addString(
      "evaluate_over_time_no_data_policy",
      unwrapApiString(overTime["onNoDataPolicy"]),
    );
  }

  const serverOptions: unknown = filter["serverMonitorOptions"];

  if (isJSONObject(serverOptions)) {
    attributes.addString("disk_path", unwrapApiString(serverOptions["diskPath"]));
  }

  for (const option of FILTER_JSON_OPTIONS) {
    attributes.add(
      option.attributeName,
      rawJsonOption(filter[option.apiKey], option.attributeName, context),
    );
  }

  return attributes.toObject();
}

function incidentOrAlertToHcl(
  value: unknown,
  kind: "incident" | "alert",
): HclExpression | null {
  if (!isJSONObject(value)) {
    return null;
  }

  const template: JSONObject = unwrapEnvelope(value);
  const attributes: AttributeList = new AttributeList();

  attributes.addString("title", unwrapApiString(template["title"]));
  attributes.addString("description", unwrapApiString(template["description"]));

  if (kind === "incident") {
    attributes.addString(
      "incident_severity_id",
      unwrapApiString(template["incidentSeverityId"]),
    );
    attributes.addBool(
      "auto_resolve_incident",
      apiBool(template["autoResolveIncident"]),
    );
  } else {
    attributes.addString(
      "alert_severity_id",
      unwrapApiString(template["alertSeverityId"]),
    );
    attributes.addBool("auto_resolve_alert", apiBool(template["autoResolveAlert"]));
  }

  attributes.addString(
    "remediation_notes",
    unwrapApiString(template["remediationNotes"]),
  );

  for (const list of INCIDENT_AND_ALERT_ID_LISTS) {
    attributes.addStringList(list.attributeName, apiStringList(template[list.apiKey]));
  }

  if (kind === "incident") {
    attributes.addBool(
      "show_incident_on_status_page",
      apiBool(template["showIncidentOnStatusPage"]),
    );
  }

  attributes.addBool("is_private", apiBool(template["isPrivate"]));

  return attributes.toObject();
}

function objectList(
  value: unknown,
  convert: (item: unknown) => HclExpression | null,
): HclExpression | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const items: Array<HclExpression> = value
    .map(convert)
    .filter((item: HclExpression | null): item is HclExpression => {
      return item !== null;
    });

  return items.length > 0 ? Hcl.tuple(items) : null;
}

function criteriaToHcl(
  value: unknown,
  context: MonitorStepsHclContext,
): HclExpression | null {
  if (!isJSONObject(value)) {
    return null;
  }

  const criteria: JSONObject = unwrapEnvelope(value);
  const attributes: AttributeList = new AttributeList();

  attributes.addString("name", unwrapApiString(criteria["name"]));
  attributes.addString("description", unwrapApiString(criteria["description"]));
  attributes.addString(
    "filter_condition",
    unwrapApiString(criteria["filterCondition"]),
  );
  attributes.addString(
    "monitor_status_id",
    unwrapApiString(criteria["monitorStatusId"]),
  );
  attributes.addBool(
    "change_monitor_status",
    apiBool(criteria["changeMonitorStatus"]),
  );
  attributes.addBool("create_incidents", apiBool(criteria["createIncidents"]));
  attributes.addBool("create_alerts", apiBool(criteria["createAlerts"]));
  attributes.addBool("is_enabled", apiBool(criteria["isEnabled"]));
  attributes.add(
    "incident_grouping",
    rawJsonOption(criteria["incidentGrouping"], "incident_grouping", context),
  );
  attributes.add(
    "filters",
    objectList(criteria["filters"], (item: unknown): HclExpression | null => {
      return filterToHcl(item, context);
    }),
  );
  attributes.add(
    "incidents",
    objectList(criteria["incidents"], (item: unknown): HclExpression | null => {
      return incidentOrAlertToHcl(item, "incident");
    }),
  );
  attributes.add(
    "alerts",
    objectList(criteria["alerts"], (item: unknown): HclExpression | null => {
      return incidentOrAlertToHcl(item, "alert");
    }),
  );

  return attributes.toObject();
}

function requestHeadersToHcl(
  value: unknown,
  context: MonitorStepsHclContext,
): HclExpression | null {
  if (!isJSONObject(value)) {
    return null;
  }

  const attributes: Array<HclObjectAttribute> = [];

  for (const name of Object.keys(value)) {
    const headerValue: unknown = value[name];

    // The provider keeps string values only (an empty one included).
    if (typeof headerValue !== "string") {
      continue;
    }

    if (
      headerValue.length > 0 &&
      isSecretHeaderName(name) &&
      !isMonitorSecretReference(headerValue)
    ) {
      attributes.push({
        key: name,
        value: context.variables.add(
          `${context.variablePrefix}_header_${name}`,
          `The ${name} header ${context.monitorLabel} sends.`,
        ),
      });
      continue;
    }

    attributes.push({ key: name, value: Hcl.string(headerValue) });
  }

  return attributes.length > 0 ? Hcl.object(attributes) : null;
}

function stepToHcl(
  value: unknown,
  context: MonitorStepsHclContext,
): HclExpression | null {
  if (!isJSONObject(value)) {
    return null;
  }

  const step: JSONObject = unwrapEnvelope(value);
  const attributes: AttributeList = new AttributeList();

  const destination: unknown = step["monitorDestination"];

  if (isJSONObject(destination)) {
    const destinationValue: string | null = unwrapApiString(
      destination["value"],
    );
    const destinationType: unknown = destination["_type"];

    if (
      destinationValue !== null &&
      typeof destinationType === "string" &&
      DESTINATION_TYPES.includes(destinationType)
    ) {
      attributes.addString("monitor_destination", destinationValue);
      attributes.addString("monitor_destination_type", destinationType);
    }
  }

  attributes.addNumber("port", apiInteger(step["monitorDestinationPort"]));
  attributes.addString("request_type", unwrapApiString(step["requestType"]));
  attributes.add(
    "request_headers",
    requestHeadersToHcl(step["requestHeaders"], context),
  );
  attributes.addString("request_body", unwrapApiString(step["requestBody"]));
  attributes.addBool(
    "do_not_follow_redirects",
    apiBool(step["doNotFollowRedirects"]),
  );
  attributes.addBool(
    "allow_self_signed_certificates",
    apiBool(step["allowSelfSignedCertificates"]),
  );
  attributes.addString(
    "tls_client_certificate",
    unwrapApiString(step["tlsClientCertificate"]),
  );
  attributes.add(
    "tls_client_key",
    secretString(
      unwrapApiString(step["tlsClientKey"]),
      "tls_client_key",
      `The TLS client key ${context.monitorLabel} uses.`,
      context,
    ),
  );
  attributes.add(
    "tls_client_key_passphrase",
    secretString(
      unwrapApiString(step["tlsClientKeyPassphrase"]),
      "tls_client_key_passphrase",
      `The passphrase of the TLS client key ${context.monitorLabel} uses.`,
      context,
    ),
  );
  attributes.addString("custom_code", unwrapApiString(step["customCode"]));
  attributes.addStringList(
    "screen_size_types",
    apiStringList(step["screenSizeTypes"]),
  );
  attributes.addStringList("browser_types", apiStringList(step["browserTypes"]));
  attributes.addNumber(
    "retry_count_on_error",
    apiInteger(step["retryCountOnError"]),
  );
  attributes.addNumber(
    "request_timeout_in_ms",
    apiInteger(step["requestTimeoutInMs"]),
  );
  attributes.addNumber("retry_count", apiInteger(step["retryCount"]));

  for (const subConfig of MONITOR_STEP_SUB_CONFIGS) {
    attributes.add(
      subConfig.attributeName,
      rawJsonOption(step[subConfig.apiKey], subConfig.attributeName, context),
    );
  }

  const criteria: unknown = step["monitorCriteria"];

  if (isJSONObject(criteria)) {
    attributes.add(
      "criteria",
      objectList(
        unwrapEnvelope(criteria)["monitorCriteriaInstanceArray"],
        (item: unknown): HclExpression | null => {
          return criteriaToHcl(item, context);
        },
      ),
    );
  }

  return attributes.toObject();
}

/*
 * The `monitor_steps` value for a monitor's API value, or null when the
 * monitor has no steps (or the value is not a MonitorSteps object), in which
 * case the attribute is left out and the provider keeps what the server has.
 */
export function monitorStepsToHcl(
  value: unknown,
  context: MonitorStepsHclContext,
): HclExpression | null {
  if (!isJSONObject(value)) {
    return null;
  }

  const inner: JSONObject = isJSONObject(value["value"])
    ? (value["value"] as JSONObject)
    : value;

  return objectList(
    inner["monitorStepsInstanceArray"],
    (item: unknown): HclExpression | null => {
      return stepToHcl(item, context);
    },
  );
}
