import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import DomainLookupMethod from "Common/Types/Monitor/DomainMonitor/DomainLookupMethod";
import MonitorStep, { MonitorStepType } from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import { formatDictionaryValueForDisplay } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";

/*
 * WHY THIS FILE EXISTS
 *
 * The monitor "Criteria" page renders a read-only view of the monitor step
 * next to the criteria. That view used to be a chain of `if (monitorType ===
 * ...)` branches inside the viewer component, and it only covered a third of
 * the monitor types we ship. For every other type — Metrics, all nine
 * infrastructure/telemetry types, DNS, Exceptions, Network Device, SSL
 * Certificate — the branch chain fell through, the field list stayed empty,
 * and the page showed a "Monitor Details" heading with nothing under it. The
 * configuration was there, and the edit modal showed it; the page just never
 * had a branch that could render it.
 *
 * Adding branches to a component is how it got that way, so the mapping from
 * "monitor step" to "what the page shows" lives here instead: a pure function
 * over plain data with no React, no fetches and no rendering, which the test
 * suite can hold to every monitor type at once.
 *
 * Rows carry a `valueType` rather than a UI FieldType so this file never
 * imports the component layer's rendering. The viewer translates them.
 * `formatDictionaryValueForDisplay` is the one import from under
 * `Common/UI`: a pure string function with no React in it, shared so the
 * criteria page names filter operators exactly the way the log viewer's
 * chips do.
 */

export enum MonitorStepViewValueType {
  Text = "Text",
  Number = "Number",
  Port = "Port",
  Boolean = "Boolean",
  ArrayOfText = "ArrayOfText",
  DictionaryOfStrings = "DictionaryOfStrings",
  JSON = "JSON",
  JavaScript = "JavaScript",
  Code = "Code",
  /*
   * Value is an array of telemetry service id strings. The viewer resolves
   * them to service names/colors — this module stays free of API calls.
   */
  TelemetryServices = "TelemetryServices",
  // Value is a single network device id string, resolved the same way.
  NetworkDevice = "NetworkDevice",
}

export type MonitorStepViewValue =
  | string
  | number
  | boolean
  | Array<string>
  | Dictionary<string>
  | JSONObject
  | undefined;

export interface MonitorStepViewRow {
  key: string;
  title: string;
  description: string;
  valueType: MonitorStepViewValueType;
  value: MonitorStepViewValue;
  // Shown by the viewer when `value` is empty.
  placeholder: string;
}

type OptionalRow = MonitorStepViewRow | null;

/*
 * An empty value means "nothing configured". Rows built through
 * `optional()` are dropped in that case so a Kubernetes monitor scoped to a
 * whole cluster doesn't render five blank filter rows; rows built directly
 * are always kept so a missing destination shows its placeholder instead of
 * silently vanishing.
 */
const isEmptyValue: (value: MonitorStepViewValue) => boolean = (
  value: MonitorStepViewValue,
): boolean => {
  if (value === undefined || value === null || value === "") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }

  return false;
};

const optional: (row: MonitorStepViewRow) => OptionalRow = (
  row: MonitorStepViewRow,
): OptionalRow => {
  if (isEmptyValue(row.value)) {
    return null;
  }

  return row;
};

const compact: (rows: Array<OptionalRow>) => Array<MonitorStepViewRow> = (
  rows: Array<OptionalRow>,
): Array<MonitorStepViewRow> => {
  return rows.filter((row: OptionalRow): row is MonitorStepViewRow => {
    return row !== null;
  });
};

const toText: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return String(value);
};

const toMilliseconds: (value: number | undefined) => string | undefined = (
  value: number | undefined,
): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return `${value} ms`;
};

const toDuration: (seconds: number | undefined) => string | undefined = (
  seconds: number | undefined,
): string | undefined => {
  if (!seconds) {
    return undefined;
  }

  return OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(seconds);
};

/*
 * Span statuses are persisted as the OTel numeric codes. "0" tells an
 * operator nothing, so they are named here rather than printed raw.
 */
const toSpanStatusText: (status: SpanStatus) => string = (
  status: SpanStatus,
): string => {
  switch (status) {
    case SpanStatus.Ok:
      return "Ok";
    case SpanStatus.Error:
      return "Error";
    default:
      return "Unset";
  }
};

/*
 * Attribute filters are typed as scalars, but only the implicit `=` actually
 * stores one. Since these rows gained an operator dropdown, every other
 * operator stores an operator instance (`Search`, `Includes`, `IsNull`, ...)
 * — see `buildDictionaryValue` — or, for a step read straight back from
 * storage, the `{_type, value}` JSON those serialize to.
 *
 * Emitting the raw object as a JSON row printed that wire shape at the
 * operator, so the criteria page showed
 * `{ "env": { "_type": "Search", "value": "web" } }` where it meant
 * `env: contains web`. The shared formatter names the operator instead, and
 * the row leaves here as a dictionary of strings so the viewer tabulates it
 * the way it already tabulates request headers.
 */
const toAttributeFilters: (
  attributes: Dictionary<string | number | boolean> | undefined,
) => Dictionary<string> | undefined = (
  attributes: Dictionary<string | number | boolean> | undefined,
): Dictionary<string> | undefined => {
  if (!attributes) {
    return undefined;
  }

  const filters: Dictionary<string> = {};

  for (const key of Object.keys(attributes)) {
    filters[key] = formatDictionaryValueForDisplay(attributes[key]);
  }

  return filters;
};

const safeMetricsViewConfig: (
  config: MetricsViewConfig | undefined | null,
) => MetricsViewConfig = (
  config: MetricsViewConfig | undefined | null,
): MetricsViewConfig => {
  return {
    queryConfigs: Array.isArray(config?.queryConfigs)
      ? (config.queryConfigs as Array<MetricQueryConfigData>)
      : [],
    formulaConfigs: Array.isArray(config?.formulaConfigs)
      ? (config.formulaConfigs as Array<MetricFormulaConfigData>)
      : [],
  };
};

export default class MonitorStepViewModel {
  /**
   * The metric view every metric-backed monitor type keeps under its own
   * step shape. Mirrors MonitorStep.getMetricsViewConfig but always returns
   * a renderable config rather than undefined.
   */
  public static getMetricsViewConfig(
    monitorStep: MonitorStep | undefined,
  ): MetricsViewConfig {
    return safeMetricsViewConfig(MonitorStep.getMetricsViewConfig(monitorStep));
  }

  /**
   * The rolling window a metric-backed monitor evaluates over. Each
   * telemetry step shape carries its own copy, so this reads whichever one
   * the step has.
   */
  public static getRollingTime(
    monitorStep: MonitorStep | undefined,
  ): RollingTime | undefined {
    const data: MonitorStepType | undefined = monitorStep?.data;

    if (!data) {
      return undefined;
    }

    return (
      data.metricMonitor?.rollingTime ||
      data.iotMonitor?.rollingTime ||
      data.kubernetesMonitor?.rollingTime ||
      data.dockerMonitor?.rollingTime ||
      data.dockerSwarmMonitor?.rollingTime ||
      data.hostMonitor?.rollingTime ||
      data.podmanMonitor?.rollingTime ||
      data.proxmoxMonitor?.rollingTime ||
      data.cephMonitor?.rollingTime
    );
  }

  /**
   * True when the monitor type's configuration is a metric view, and the
   * page should therefore render a live chart preview of it.
   */
  public static hasMetricPreview(monitorType: MonitorType): boolean {
    return [
      MonitorType.Metrics,
      MonitorType.Kubernetes,
      MonitorType.Docker,
      MonitorType.Host,
      MonitorType.Podman,
      MonitorType.Proxmox,
      MonitorType.DockerSwarm,
      MonitorType.Ceph,
      MonitorType.IoTDevice,
    ].includes(monitorType);
  }

  /**
   * Human-readable one-liners for the metrics a step queries, e.g.
   * "CPU Usage (container.cpu.usage · Avg)". Used both for the detail row
   * and by tests as the contract for "the page names the metric".
   */
  public static getMetricQueryTitles(
    metricsViewConfig: MetricsViewConfig | undefined,
  ): Array<string> {
    const config: MetricsViewConfig = safeMetricsViewConfig(metricsViewConfig);

    return config.queryConfigs
      .map((queryConfig: MetricQueryConfigData): string => {
        const metricName: string =
          toText(queryConfig.metricQueryData?.filterData?.metricName) || "";

        const aggregation: string =
          toText(queryConfig.metricQueryData?.filterData?.aggegationType) || "";

        const alias: string =
          toText(queryConfig.metricAliasData?.title) ||
          toText(queryConfig.metricAliasData?.legend) ||
          "";

        const core: string = aggregation
          ? `${metricName} · ${aggregation}`
          : metricName;

        if (!core) {
          return alias;
        }

        return alias ? `${alias} (${core})` : core;
      })
      .filter((title: string) => {
        return title.length > 0;
      });
  }

  /**
   * Formula expressions defined alongside the queries, e.g. "a / b * 100".
   */
  public static getMetricFormulaTitles(
    metricsViewConfig: MetricsViewConfig | undefined,
  ): Array<string> {
    const config: MetricsViewConfig = safeMetricsViewConfig(metricsViewConfig);

    return config.formulaConfigs
      .map((formulaConfig: MetricFormulaConfigData): string => {
        const formula: string =
          toText(formulaConfig.metricFormulaData?.metricFormula) || "";

        const alias: string =
          toText(formulaConfig.metricAliasData?.title) ||
          toText(formulaConfig.metricAliasData?.metricVariable) ||
          "";

        if (!formula) {
          return "";
        }

        return alias ? `${alias} (${formula})` : formula;
      })
      .filter((title: string) => {
        return title.length > 0;
      });
  }

  /**
   * Attribute keys the step groups its series by — the difference between
   * one incident for the fleet and one incident per host.
   */
  public static getMetricGroupByKeys(
    metricsViewConfig: MetricsViewConfig | undefined,
  ): Array<string> {
    const config: MetricsViewConfig = safeMetricsViewConfig(metricsViewConfig);

    const keys: Array<string> = [];

    for (const queryConfig of config.queryConfigs) {
      for (const key of queryConfig.metricQueryData?.groupByAttributeKeys ||
        []) {
        if (key && !keys.includes(key)) {
          keys.push(key);
        }
      }
    }

    return keys;
  }

  /**
   * Every row the monitor step view should show, in display order, for the
   * given monitor type. An empty array means the type has no step
   * configuration at all (Manual, Server, Incoming Request/Email) and the
   * viewer should not render the section.
   */
  public static getRows(input: {
    monitorStep: MonitorStep | undefined;
    monitorType: MonitorType;
  }): Array<MonitorStepViewRow> {
    const data: MonitorStepType | undefined = input.monitorStep?.data;

    if (!data) {
      return [];
    }

    const monitorType: MonitorType = input.monitorType;

    switch (monitorType) {
      case MonitorType.API:
        return MonitorStepViewModel.getApiRows(data);
      case MonitorType.Website:
        return MonitorStepViewModel.getWebsiteRows(data);
      case MonitorType.Ping:
      case MonitorType.IP:
        return MonitorStepViewModel.getPingRows(data, monitorType);
      case MonitorType.Port:
        return MonitorStepViewModel.getPortRows(data);
      case MonitorType.SSLCertificate:
        return MonitorStepViewModel.getSslCertificateRows(data);
      case MonitorType.CustomJavaScriptCode:
        return MonitorStepViewModel.getCustomCodeRows(data);
      case MonitorType.SyntheticMonitor:
        return MonitorStepViewModel.getSyntheticRows(data);
      case MonitorType.Domain:
        return MonitorStepViewModel.getDomainRows(data);
      case MonitorType.DNS:
        return MonitorStepViewModel.getDnsRows(data);
      case MonitorType.DNSSEC:
        return MonitorStepViewModel.getDnssecRows(data);
      case MonitorType.SQLQuery:
        return MonitorStepViewModel.getSqlRows(data);
      case MonitorType.Database:
        return MonitorStepViewModel.getDatabaseRows(data);
      case MonitorType.ExternalStatusPage:
        return MonitorStepViewModel.getExternalStatusPageRows(data);
      case MonitorType.Logs:
        return MonitorStepViewModel.getLogRows(data);
      case MonitorType.SecurityEvents:
        return MonitorStepViewModel.getSecurityEventsRows(data);
      case MonitorType.Traces:
        return MonitorStepViewModel.getTraceRows(data);
      case MonitorType.Exceptions:
        return MonitorStepViewModel.getExceptionRows(data);
      case MonitorType.NetworkDevice:
        return MonitorStepViewModel.getNetworkDeviceRows(data);
      case MonitorType.Metrics:
        return MonitorStepViewModel.getMetricRows(data);
      case MonitorType.Kubernetes:
        return MonitorStepViewModel.getKubernetesRows(data);
      case MonitorType.Docker:
        return MonitorStepViewModel.getDockerRows(data);
      case MonitorType.Podman:
        return MonitorStepViewModel.getPodmanRows(data);
      case MonitorType.Host:
        return MonitorStepViewModel.getHostRows(data);
      case MonitorType.Proxmox:
        return MonitorStepViewModel.getProxmoxRows(data);
      case MonitorType.DockerSwarm:
        return MonitorStepViewModel.getDockerSwarmRows(data);
      case MonitorType.Ceph:
        return MonitorStepViewModel.getCephRows(data);
      case MonitorType.IoTDevice:
        return MonitorStepViewModel.getIoTRows(data);
      default:
        // Manual, Server, Incoming Request/Email, Profiles: no step config.
        return [];
    }
  }

  private static getDestinationRow(
    data: MonitorStepType,
    title: string,
    description: string,
  ): MonitorStepViewRow {
    return {
      key: "monitorDestination",
      title: title,
      description: description,
      valueType: MonitorStepViewValueType.Text,
      value: toText(data.monitorDestination?.toString()),
      placeholder: "No data entered",
    };
  }

  /*
   * Per-step overrides on probe monitors. Both are optional and fall back to
   * platform defaults, so they only earn a row when the user set them.
   */
  private static getTimeoutAndRetryRows(
    data: MonitorStepType,
  ): Array<OptionalRow> {
    return [
      optional({
        key: "requestTimeoutInMs",
        title: "Request Timeout",
        description: "How long we wait for a response before failing a check.",
        valueType: MonitorStepViewValueType.Text,
        value: toMilliseconds(data.requestTimeoutInMs),
        placeholder: "Default",
      }),
      optional({
        key: "retryCount",
        title: "Retry Count",
        description: "How many times we retry a failed check.",
        valueType: MonitorStepViewValueType.Number,
        value: data.retryCount,
        placeholder: "Default",
      }),
    ];
  }

  /*
   * mTLS material is a secret. The page confirms whether one is configured
   * and never renders the certificate, the key or the passphrase.
   */
  private static getMutualTlsRows(data: MonitorStepType): Array<OptionalRow> {
    const hasCertificate: boolean = Boolean(
      data.tlsClientCertificate && data.tlsClientCertificate.trim(),
    );

    return [
      optional({
        key: "tlsClientCertificate",
        title: "Client Certificate (mTLS)",
        description:
          "A client certificate is configured for this check. The certificate and key are never displayed.",
        valueType: MonitorStepViewValueType.Text,
        value: hasCertificate ? "Configured" : undefined,
        placeholder: "Not configured",
      }),
    ];
  }

  private static getApiRows(data: MonitorStepType): Array<MonitorStepViewRow> {
    return compact([
      MonitorStepViewModel.getDestinationRow(
        data,
        "API URL",
        "URL of the API you want to monitor.",
      ),
      {
        key: "requestType",
        title: "Request Type",
        description: "Whats the type of the API request?",
        valueType: MonitorStepViewValueType.Text,
        value: toText(data.requestType),
        placeholder: "No data entered",
      },
      {
        key: "requestBody",
        title: "Request Body",
        description: "Request Body to send, if any.",
        valueType: MonitorStepViewValueType.JSON,
        value: data.requestBody,
        placeholder: "No data entered",
      },
      {
        key: "requestHeaders",
        title: "Request Headers",
        description: "Request Headers to send, if any.",
        valueType: MonitorStepViewValueType.DictionaryOfStrings,
        value: data.requestHeaders,
        placeholder: "No data entered",
      },
      {
        key: "doNotFollowRedirects",
        title: "Do Not Follow Redirects",
        description: "When set, we will not follow redirects.",
        valueType: MonitorStepViewValueType.Boolean,
        value: Boolean(data.doNotFollowRedirects),
        placeholder: "No",
      },
      {
        key: "allowSelfSignedCertificates",
        title: "Allow Self-Signed Certificates",
        description:
          "When set, TLS certificate validation is skipped (self-signed or untrusted certificates are accepted).",
        valueType: MonitorStepViewValueType.Boolean,
        value: Boolean(data.allowSelfSignedCertificates),
        placeholder: "No",
      },
      ...MonitorStepViewModel.getMutualTlsRows(data),
      ...MonitorStepViewModel.getTimeoutAndRetryRows(data),
    ]);
  }

  private static getWebsiteRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    return compact([
      MonitorStepViewModel.getDestinationRow(
        data,
        "Website URL",
        "URL of the website you want to monitor.",
      ),
      {
        key: "doNotFollowRedirects",
        title: "Do Not Follow Redirects",
        description: "Do not follow redirects.",
        valueType: MonitorStepViewValueType.Boolean,
        value: Boolean(data.doNotFollowRedirects),
        placeholder: "No",
      },
      {
        key: "allowSelfSignedCertificates",
        title: "Allow Self-Signed Certificates",
        description:
          "When set, TLS certificate validation is skipped (self-signed or untrusted certificates are accepted).",
        valueType: MonitorStepViewValueType.Boolean,
        value: Boolean(data.allowSelfSignedCertificates),
        placeholder: "No",
      },
      ...MonitorStepViewModel.getMutualTlsRows(data),
      ...MonitorStepViewModel.getTimeoutAndRetryRows(data),
    ]);
  }

  private static getPingRows(
    data: MonitorStepType,
    monitorType: MonitorType,
  ): Array<MonitorStepViewRow> {
    const isIp: boolean = monitorType === MonitorType.IP;

    return compact([
      MonitorStepViewModel.getDestinationRow(
        data,
        isIp ? "IP Address" : "Ping Hostname or IP Address",
        isIp
          ? "IP Address of the resource you would like us to ping."
          : "Hostname or IP Address of the resource you would like us to ping.",
      ),
      ...MonitorStepViewModel.getTimeoutAndRetryRows(data),
    ]);
  }

  private static getPortRows(data: MonitorStepType): Array<MonitorStepViewRow> {
    return compact([
      MonitorStepViewModel.getDestinationRow(
        data,
        "Ping Hostname or IP Address",
        "Hostname or IP Address of the resource you would like us to ping.",
      ),
      {
        key: "monitorDestinationPort",
        title: "Port",
        description: "Port of the resource you would like us to ping.",
        valueType: MonitorStepViewValueType.Port,
        value: toText(data.monitorDestinationPort?.toString()),
        placeholder: "No port entered",
      },
      ...MonitorStepViewModel.getTimeoutAndRetryRows(data),
    ]);
  }

  private static getSslCertificateRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    return compact([
      MonitorStepViewModel.getDestinationRow(
        data,
        "Website URL",
        "URL whose SSL certificate we monitor.",
      ),
      ...MonitorStepViewModel.getTimeoutAndRetryRows(data),
    ]);
  }

  private static getCustomCodeRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    return compact([
      {
        key: "customCode",
        title: "JavaScript Code",
        description: "JavaScript code to run.",
        valueType: MonitorStepViewValueType.JavaScript,
        value: data.customCode,
        placeholder: "No data entered",
      },
    ]);
  }

  private static getSyntheticRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    return compact([
      {
        key: "customCode",
        title: "JavaScript Code",
        description: "JavaScript code to run.",
        valueType: MonitorStepViewValueType.JavaScript,
        value: data.customCode,
        placeholder: "No data entered",
      },
      {
        key: "browserTypes",
        title: "Browser Types",
        description: "Browser types to run the synthetic monitor on.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: (data.browserTypes || []).map((browserType: string) => {
          return String(browserType);
        }),
        placeholder: "No data entered",
      },
      {
        key: "screenSizeTypes",
        title: "Screen Size Types",
        description: "Screen size types to run the synthetic monitor on.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: (data.screenSizeTypes || []).map((screenSizeType: string) => {
          return String(screenSizeType);
        }),
        placeholder: "No data entered",
      },
      {
        key: "retryCountOnError",
        title: "Retry Count on Error",
        description:
          "Number of times to retry the synthetic monitor if it fails.",
        valueType: MonitorStepViewValueType.Number,
        value: data.retryCountOnError,
        placeholder: "0",
      },
    ]);
  }

  private static getDomainRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    return compact([
      {
        key: "domainName",
        title: "Domain Name",
        description: "The domain name whose registration is being monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(data.domainMonitor?.domainName),
        placeholder: "No data entered",
      },
      {
        key: "lookupMethod",
        title: "Lookup Method",
        description: "The protocol used to read domain registration data.",
        valueType: MonitorStepViewValueType.Text,
        value:
          toText(data.domainMonitor?.lookupMethod) || DomainLookupMethod.Auto,
        placeholder: "No data entered",
      },
      optional({
        key: "domainTimeout",
        title: "Lookup Timeout",
        description: "How long we wait for the registry to answer.",
        valueType: MonitorStepViewValueType.Text,
        value: toMilliseconds(data.domainMonitor?.timeout),
        placeholder: "Default",
      }),
      optional({
        key: "domainRetries",
        title: "Retries",
        description: "How many times we retry a failed lookup.",
        valueType: MonitorStepViewValueType.Number,
        value: data.domainMonitor?.retries,
        placeholder: "Default",
      }),
    ]);
  }

  private static getDnsRows(data: MonitorStepType): Array<MonitorStepViewRow> {
    return compact([
      {
        key: "queryName",
        title: "Domain Name",
        description: "The name we resolve on every check.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(data.dnsMonitor?.queryName),
        placeholder: "No data entered",
      },
      {
        key: "recordType",
        title: "Record Type",
        description: "The DNS record type we query for.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(data.dnsMonitor?.recordType),
        placeholder: "No data entered",
      },
      {
        key: "dnsServer",
        title: "DNS Server",
        description: "The resolver we send the query to.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(data.dnsMonitor?.hostname),
        placeholder: "System default resolver",
      },
      optional({
        key: "dnsPort",
        title: "DNS Server Port",
        description: "The port the resolver listens on.",
        valueType: MonitorStepViewValueType.Port,
        value: toText(data.dnsMonitor?.port),
        placeholder: "53",
      }),
      optional({
        key: "dnsTimeout",
        title: "Query Timeout",
        description: "How long we wait for the resolver to answer.",
        valueType: MonitorStepViewValueType.Text,
        value: toMilliseconds(data.dnsMonitor?.timeout),
        placeholder: "Default",
      }),
      optional({
        key: "dnsRetries",
        title: "Retries",
        description: "How many times we retry a failed query.",
        valueType: MonitorStepViewValueType.Number,
        value: data.dnsMonitor?.retries,
        placeholder: "Default",
      }),
    ]);
  }

  private static getDnssecRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    return compact([
      {
        key: "dnssecDomainName",
        title: "Zone",
        description: "The zone being validated end-to-end via DNSSEC.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(data.dnssecMonitor?.domainName),
        placeholder: "No data entered",
      },
      {
        key: "dnssecResolvers",
        title: "Resolvers",
        description: "Validating resolvers queried for AD/SERVFAIL behavior.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: data.dnssecMonitor?.resolvers || [],
        placeholder: "No data entered",
      },
      optional({
        key: "checkNameserverConsistency",
        title: "Check Nameserver Consistency",
        description:
          "When set, primary and secondary nameservers must agree on the zone's records.",
        valueType: MonitorStepViewValueType.Boolean,
        value: data.dnssecMonitor?.checkNameserverConsistency,
        placeholder: "No",
      }),
      optional({
        key: "signatureExpiryWarningDays",
        title: "Signature Expiry Warning (days)",
        description:
          "How many days before an RRSIG expires we start warning about it.",
        valueType: MonitorStepViewValueType.Number,
        value: data.dnssecMonitor?.signatureExpiryWarningDays,
        placeholder: "Default",
      }),
    ]);
  }

  private static getSqlRows(data: MonitorStepType): Array<MonitorStepViewRow> {
    const sqlMonitor: MonitorStepType["sqlMonitor"] = data.sqlMonitor;

    const database: string | undefined = sqlMonitor?.host
      ? `${sqlMonitor.databaseType} · ${sqlMonitor.host}:${sqlMonitor.port}/${sqlMonitor.databaseName}`
      : undefined;

    return compact([
      {
        key: "sqlDatabase",
        title: "Database",
        description: "The database this monitor connects to.",
        valueType: MonitorStepViewValueType.Text,
        value: database,
        placeholder: "No data entered",
      },
      {
        key: "sqlQuery",
        title: "Query",
        description: "The read-only SQL query this monitor runs.",
        valueType: MonitorStepViewValueType.Code,
        value: toText(sqlMonitor?.query),
        placeholder: "No data entered",
      },
      optional({
        key: "sqlUsername",
        title: "Username",
        description: "The database user this monitor connects as.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(sqlMonitor?.username),
        placeholder: "No data entered",
      }),
      optional({
        key: "sqlWindowsAuthentication",
        title: "Windows Integrated Authentication",
        description:
          "When set, the probe authenticates as the identity it runs under instead of using a username and password.",
        valueType: MonitorStepViewValueType.Boolean,
        value: sqlMonitor?.useWindowsIntegratedAuthentication,
        placeholder: "No",
      }),
      optional({
        key: "sqlUseSsl",
        title: "Use SSL",
        description: "Whether the connection to the database is encrypted.",
        valueType: MonitorStepViewValueType.Boolean,
        value: sqlMonitor?.useSsl,
        placeholder: "No",
      }),
      optional({
        key: "sqlStatementTimeoutInMs",
        title: "Statement Timeout",
        description: "How long the query may run before it is cancelled.",
        valueType: MonitorStepViewValueType.Text,
        value: toMilliseconds(sqlMonitor?.statementTimeoutInMs),
        placeholder: "Default",
      }),
      optional({
        key: "sqlMaxRows",
        title: "Max Rows",
        description: "Upper bound on rows read back from the database.",
        valueType: MonitorStepViewValueType.Number,
        value: sqlMonitor?.maxRows,
        placeholder: "Default",
      }),
    ]);
  }

  /*
   * The password is deliberately absent, here and everywhere else this step
   * is rendered. It is often a {{monitorSecrets.name}} reference rather than
   * a literal, but naming the secret is still naming a credential, and this
   * page is visible to anyone who can read the monitor.
   */
  private static getDatabaseRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    const databaseMonitor: MonitorStepType["databaseMonitor"] =
      data.databaseMonitor;

    const database: string | undefined = databaseMonitor?.host
      ? `${databaseMonitor.databaseType} · ${databaseMonitor.host}:${databaseMonitor.port}/${databaseMonitor.databaseName}`
      : undefined;

    return compact([
      {
        key: "databaseConnection",
        title: "Database",
        description: "The database server this monitor collects health from.",
        valueType: MonitorStepViewValueType.Text,
        value: database,
        placeholder: "No data entered",
      },
      optional({
        key: "databaseUsername",
        title: "Username",
        description: "The database user this monitor connects as.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(databaseMonitor?.username),
        placeholder: "No data entered",
      }),
      optional({
        key: "databaseWindowsAuthentication",
        title: "Windows Integrated Authentication",
        description:
          "When set, the probe authenticates as the identity it runs under instead of using a username and password.",
        valueType: MonitorStepViewValueType.Boolean,
        value: databaseMonitor?.useWindowsIntegratedAuthentication,
        placeholder: "No",
      }),
      optional({
        key: "databaseUseSsl",
        title: "Use SSL",
        description: "Whether the connection to the database is encrypted.",
        valueType: MonitorStepViewValueType.Boolean,
        value: databaseMonitor?.useSsl,
        placeholder: "No",
      }),
      optional({
        key: "databaseRejectUnauthorizedSsl",
        title: "Verify Server Certificate",
        description:
          "Whether the database's TLS certificate must be signed by a trusted authority.",
        valueType: MonitorStepViewValueType.Boolean,
        value: databaseMonitor?.rejectUnauthorizedSsl,
        placeholder: "No",
      }),
      optional({
        key: "databaseConnectionTimeoutInMs",
        title: "Connection Timeout",
        description: "How long the probe waits to establish a connection.",
        valueType: MonitorStepViewValueType.Text,
        value: toMilliseconds(databaseMonitor?.connectionTimeoutInMs),
        placeholder: "Default",
      }),
      optional({
        key: "databaseStatementTimeoutInMs",
        title: "Statement Timeout",
        description:
          "How long one statistics query may run before that group is abandoned.",
        valueType: MonitorStepViewValueType.Text,
        value: toMilliseconds(databaseMonitor?.statementTimeoutInMs),
        placeholder: "Default",
      }),
      optional({
        key: "databaseMetricGroups",
        title: "Collected Metric Groups",
        description:
          "The groups of statistics this monitor collects. A group whose grant is missing is reported as unavailable, not as an outage.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: databaseMonitor?.enabledMetricGroups,
        placeholder: "All groups",
      }),
    ]);
  }

  private static getExternalStatusPageRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    return compact([
      {
        key: "statusPageUrl",
        title: "Status Page URL",
        description: "The URL of the external status page being monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(data.externalStatusPageMonitor?.statusPageUrl),
        placeholder: "No data entered",
      },
      {
        key: "statusPageProvider",
        title: "Provider",
        description: "How OneUptime reads this status page.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(data.externalStatusPageMonitor?.provider) || "Auto",
        placeholder: "Auto",
      },
      {
        key: "componentGroupName",
        title: "Component Group Filter",
        description:
          "If set, only components in this group are monitored and incidents elsewhere are ignored.",
        valueType: MonitorStepViewValueType.Text,
        value:
          toText(data.externalStatusPageMonitor?.componentGroupName) ||
          "All groups",
        placeholder: "All groups",
      },
      {
        key: "componentName",
        title: "Component Name Filter",
        description: "If set, only this specific component will be monitored.",
        valueType: MonitorStepViewValueType.Text,
        value:
          toText(data.externalStatusPageMonitor?.componentName) ||
          "All components",
        placeholder: "All components",
      },
    ]);
  }

  private static getLogRows(data: MonitorStepType): Array<MonitorStepViewRow> {
    const logMonitor: MonitorStepType["logMonitor"] = data.logMonitor;

    return compact([
      optional({
        key: "logBody",
        title: "Filter Log Message",
        description: "Filter by log message with this text:",
        valueType: MonitorStepViewValueType.Text,
        value: toText(logMonitor?.body),
        placeholder: "No log message entered",
      }),
      optional({
        key: "lastXSecondsOfLogs",
        title: "Monitor logs for the last (time)",
        description: "How many seconds of logs to monitor.",
        valueType: MonitorStepViewValueType.Text,
        value: toDuration(logMonitor?.lastXSecondsOfLogs),
        placeholder: "1 minute",
      }),
      optional({
        key: "severityTexts",
        title: "Log Severity",
        description: "Severity of the logs to monitor.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: (logMonitor?.severityTexts || []).map((severity: string) => {
          return String(severity);
        }),
        placeholder: "No severity entered",
      }),
      optional({
        key: "logAttributes",
        title: "Log Attributes",
        description: "Attributes of the logs to monitor.",
        valueType: MonitorStepViewValueType.DictionaryOfStrings,
        value: toAttributeFilters(logMonitor?.attributes),
        placeholder: "No attributes entered",
      }),
      optional({
        key: "logEntityKeys",
        title: "Inventory Items",
        description: "Hosts, pods or containers this monitor is scoped to.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: logMonitor?.entityKeys || [],
        placeholder: "No entities entered",
      }),
      optional({
        key: "logTelemetryServices",
        title: "Telemetry Services",
        description: "Telemetry services to monitor.",
        valueType: MonitorStepViewValueType.TelemetryServices,
        value: (logMonitor?.telemetryServiceIds || []).map(
          (serviceId: { toString: () => string }) => {
            return serviceId.toString();
          },
        ),
        placeholder: "No telemetry services entered",
      }),
    ]);
  }

  private static getSecurityEventsRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    const securityEventsMonitor: MonitorStepType["securityEventsMonitor"] =
      data.securityEventsMonitor;

    return compact([
      optional({
        key: "securityEventMessage",
        title: "Filter Event Message",
        description: "Filter by event message with this text:",
        valueType: MonitorStepViewValueType.Text,
        value: toText(securityEventsMonitor?.messageContains),
        placeholder: "No event message entered",
      }),
      optional({
        key: "lastXSecondsOfEvents",
        title: "Monitor security events for the last (time)",
        description: "How many seconds of security events to monitor.",
        valueType: MonitorStepViewValueType.Text,
        value: toDuration(securityEventsMonitor?.lastXSecondsOfEvents),
        placeholder: "1 minute",
      }),
      optional({
        key: "securityEventSeverityNames",
        title: "Event Severity",
        description: "OCSF severity of the security events to monitor.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: (securityEventsMonitor?.severityNames || []).map(
          (severity: OcsfSeverity) => {
            return String(severity);
          },
        ),
        placeholder: "No severity entered",
      }),
      optional({
        key: "securityEventClassNames",
        title: "Event Class",
        description: "OCSF event classes to monitor.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: (securityEventsMonitor?.classNames || []).map(
          (className: string) => {
            return String(className);
          },
        ),
        placeholder: "No event class entered",
      }),
      optional({
        key: "securityEventAttributes",
        title: "Event Attributes",
        description: "Attributes of the security events to monitor.",
        valueType: MonitorStepViewValueType.DictionaryOfStrings,
        value: toAttributeFilters(securityEventsMonitor?.attributes),
        placeholder: "No attributes entered",
      }),
      optional({
        key: "securityEventTelemetryServices",
        title: "Telemetry Services",
        description: "Telemetry services to monitor.",
        valueType: MonitorStepViewValueType.TelemetryServices,
        value: (securityEventsMonitor?.telemetryServiceIds || []).map(
          (serviceId: { toString: () => string }) => {
            return serviceId.toString();
          },
        ),
        placeholder: "No telemetry services entered",
      }),
    ]);
  }

  private static getTraceRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    const traceMonitor: MonitorStepType["traceMonitor"] = data.traceMonitor;

    return compact([
      optional({
        key: "spanName",
        title: "Filter Span Name",
        description: "Filter by span name with this text:",
        valueType: MonitorStepViewValueType.Text,
        value: toText(traceMonitor?.spanName),
        placeholder: "No span name entered",
      }),
      optional({
        key: "lastXSecondsOfSpans",
        title: "Monitor spans for the last (time)",
        description: "How many seconds of spans to monitor.",
        valueType: MonitorStepViewValueType.Text,
        value: toDuration(traceMonitor?.lastXSecondsOfSpans),
        placeholder: "1 minute",
      }),
      optional({
        key: "spanStatuses",
        title: "Span Status",
        description: "Status of the spans to monitor.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: (traceMonitor?.spanStatuses || []).map((status: SpanStatus) => {
          return toSpanStatusText(status);
        }),
        placeholder: "No span status entered. All statuses will be monitored.",
      }),
      optional({
        key: "spanAttributes",
        title: "Span Attributes",
        description: "Attributes of the spans to monitor.",
        valueType: MonitorStepViewValueType.DictionaryOfStrings,
        value: toAttributeFilters(traceMonitor?.attributes),
        placeholder: "No attributes entered",
      }),
      optional({
        key: "traceEntityKeys",
        title: "Inventory Items",
        description: "Hosts, pods or containers this monitor is scoped to.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: traceMonitor?.entityKeys || [],
        placeholder: "No entities entered",
      }),
      optional({
        key: "traceTelemetryServices",
        title: "Telemetry Services",
        description: "Telemetry services to monitor.",
        valueType: MonitorStepViewValueType.TelemetryServices,
        value: (traceMonitor?.telemetryServiceIds || []).map(
          (serviceId: { toString: () => string }) => {
            return serviceId.toString();
          },
        ),
        placeholder: "No telemetry services entered",
      }),
    ]);
  }

  private static getExceptionRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    const exceptionMonitor: MonitorStepType["exceptionMonitor"] =
      data.exceptionMonitor;

    return compact([
      optional({
        key: "exceptionMessage",
        title: "Filter Exception Message",
        description: "Filter by exception message with this text:",
        valueType: MonitorStepViewValueType.Text,
        value: toText(exceptionMonitor?.message),
        placeholder: "No message entered",
      }),
      optional({
        key: "exceptionTypes",
        title: "Exception Types",
        description: "Exception types this monitor watches.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: exceptionMonitor?.exceptionTypes || [],
        placeholder: "All exception types",
      }),
      {
        key: "lastXSecondsOfExceptions",
        title: "Monitor exceptions for the last (time)",
        description: "How much of the exception history each check reads.",
        valueType: MonitorStepViewValueType.Text,
        value: toDuration(exceptionMonitor?.lastXSecondsOfExceptions),
        placeholder: "1 minute",
      },
      {
        key: "includeResolved",
        title: "Include Resolved Exceptions",
        description:
          "Whether resolved exceptions still count towards criteria.",
        valueType: MonitorStepViewValueType.Boolean,
        value: Boolean(exceptionMonitor?.includeResolved),
        placeholder: "No",
      },
      {
        key: "includeArchived",
        title: "Include Archived Exceptions",
        description:
          "Whether archived exceptions still count towards criteria.",
        valueType: MonitorStepViewValueType.Boolean,
        value: Boolean(exceptionMonitor?.includeArchived),
        placeholder: "No",
      },
      optional({
        key: "exceptionEntityKeys",
        title: "Inventory Items",
        description: "Hosts, pods or containers this monitor is scoped to.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: exceptionMonitor?.entityKeys || [],
        placeholder: "No entities entered",
      }),
      optional({
        key: "exceptionTelemetryServices",
        title: "Telemetry Services",
        description: "Telemetry services to monitor.",
        valueType: MonitorStepViewValueType.TelemetryServices,
        value: (exceptionMonitor?.telemetryServiceIds || []).map(
          (serviceId: { toString: () => string }) => {
            return serviceId.toString();
          },
        ),
        placeholder: "No telemetry services entered",
      }),
    ]);
  }

  private static getNetworkDeviceRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    return compact([
      {
        key: "networkDeviceId",
        title: "Network Device",
        description:
          "The registered network device this monitor alerts on. Polling, credentials and health OIDs are configured on the device itself.",
        valueType: MonitorStepViewValueType.NetworkDevice,
        value: toText(data.networkDeviceMonitor?.networkDeviceId),
        placeholder: "No network device selected",
      },
    ]);
  }

  /*
   * Shared tail for every metric-backed monitor type: what is queried, how
   * it is grouped, and over which window. The chart preview the viewer
   * renders below the rows comes from the same config.
   */
  private static getMetricConfigRows(
    data: MonitorStepType,
    monitorStepData: {
      metricViewConfig?: MetricsViewConfig | undefined;
      rollingTime?: RollingTime | undefined;
    },
  ): Array<OptionalRow> {
    const metricsViewConfig: MetricsViewConfig = safeMetricsViewConfig(
      monitorStepData.metricViewConfig,
    );

    return [
      {
        key: "metricNames",
        title: "Metrics",
        description: "The metrics this monitor queries on every check.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: MonitorStepViewModel.getMetricQueryTitles(metricsViewConfig),
        placeholder: "No metrics selected",
      },
      optional({
        key: "metricFormulas",
        title: "Formulas",
        description: "Formulas evaluated over the queried metrics.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: MonitorStepViewModel.getMetricFormulaTitles(metricsViewConfig),
        placeholder: "No formulas",
      }),
      optional({
        key: "metricGroupBy",
        title: "Group By",
        description:
          "Attributes the series are split by — the monitor evaluates criteria per group.",
        valueType: MonitorStepViewValueType.ArrayOfText,
        value: MonitorStepViewModel.getMetricGroupByKeys(metricsViewConfig),
        placeholder: "Not grouped",
      }),
      {
        key: "rollingTime",
        title: "Time Range",
        description: "The rolling window each check evaluates over.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(monitorStepData.rollingTime),
        placeholder: RollingTime.Past1Minute,
      },
      optional({
        key: "metricTelemetryServices",
        title: "Telemetry Services",
        description: "Telemetry services this monitor is scoped to.",
        valueType: MonitorStepViewValueType.TelemetryServices,
        value: (data.metricMonitor?.telemetryServiceIds || []).map(
          (serviceId: { toString: () => string }) => {
            return serviceId.toString();
          },
        ),
        placeholder: "All services",
      }),
    ];
  }

  private static getMetricRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    return compact([
      ...MonitorStepViewModel.getMetricConfigRows(data, {
        metricViewConfig: data.metricMonitor?.metricViewConfig,
        rollingTime: data.metricMonitor?.rollingTime,
      }),
    ]);
  }

  private static getKubernetesRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    const kubernetesMonitor: MonitorStepType["kubernetesMonitor"] =
      data.kubernetesMonitor;

    return compact([
      {
        key: "clusterIdentifier",
        title: "Cluster",
        description: "The Kubernetes cluster this monitor watches.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(kubernetesMonitor?.clusterIdentifier),
        placeholder: "No cluster selected",
      },
      {
        key: "resourceScope",
        title: "Resource Scope",
        description: "The level of the cluster this monitor evaluates.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(kubernetesMonitor?.resourceScope),
        placeholder: "Cluster",
      },
      optional({
        key: "namespace",
        title: "Namespace",
        description: "Only resources in this namespace are monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(kubernetesMonitor?.resourceFilters?.namespace),
        placeholder: "All namespaces",
      }),
      optional({
        key: "workloadType",
        title: "Workload Type",
        description: "Only workloads of this kind are monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(kubernetesMonitor?.resourceFilters?.workloadType),
        placeholder: "All workload types",
      }),
      optional({
        key: "workloadName",
        title: "Workload Name",
        description: "Only this workload is monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(kubernetesMonitor?.resourceFilters?.workloadName),
        placeholder: "All workloads",
      }),
      optional({
        key: "nodeName",
        title: "Node Name",
        description: "Only this node is monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(kubernetesMonitor?.resourceFilters?.nodeName),
        placeholder: "All nodes",
      }),
      optional({
        key: "podName",
        title: "Pod Name",
        description: "Only this pod is monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(kubernetesMonitor?.resourceFilters?.podName),
        placeholder: "All pods",
      }),
      ...MonitorStepViewModel.getMetricConfigRows(data, {
        metricViewConfig: kubernetesMonitor?.metricViewConfig,
        rollingTime: kubernetesMonitor?.rollingTime,
      }),
    ]);
  }

  private static getDockerRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    const dockerMonitor: MonitorStepType["dockerMonitor"] = data.dockerMonitor;

    return compact([
      {
        key: "hostIdentifier",
        title: "Docker Host",
        description: "The Docker host this monitor watches.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(dockerMonitor?.hostIdentifier),
        placeholder: "No host selected",
      },
      optional({
        key: "containerName",
        title: "Container Name",
        description: "Only this container is monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(dockerMonitor?.containerFilters?.containerName),
        placeholder: "All containers",
      }),
      optional({
        key: "containerImage",
        title: "Container Image",
        description: "Only containers running this image are monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(dockerMonitor?.containerFilters?.containerImage),
        placeholder: "All images",
      }),
      optional({
        key: "containerHostName",
        title: "Host Name",
        description: "Only containers on this host are monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(dockerMonitor?.containerFilters?.hostName),
        placeholder: "All hosts",
      }),
      ...MonitorStepViewModel.getMetricConfigRows(data, {
        metricViewConfig: dockerMonitor?.metricViewConfig,
        rollingTime: dockerMonitor?.rollingTime,
      }),
    ]);
  }

  private static getPodmanRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    const podmanMonitor: MonitorStepType["podmanMonitor"] = data.podmanMonitor;

    return compact([
      {
        key: "hostIdentifier",
        title: "Podman Host",
        description: "The Podman host this monitor watches.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(podmanMonitor?.hostIdentifier),
        placeholder: "No host selected",
      },
      optional({
        key: "containerName",
        title: "Container Name",
        description: "Only this container is monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(podmanMonitor?.containerFilters?.containerName),
        placeholder: "All containers",
      }),
      optional({
        key: "containerImage",
        title: "Container Image",
        description: "Only containers running this image are monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(podmanMonitor?.containerFilters?.containerImage),
        placeholder: "All images",
      }),
      optional({
        key: "containerHostName",
        title: "Host Name",
        description: "Only containers on this host are monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(podmanMonitor?.containerFilters?.hostName),
        placeholder: "All hosts",
      }),
      ...MonitorStepViewModel.getMetricConfigRows(data, {
        metricViewConfig: podmanMonitor?.metricViewConfig,
        rollingTime: podmanMonitor?.rollingTime,
      }),
    ]);
  }

  private static getHostRows(data: MonitorStepType): Array<MonitorStepViewRow> {
    const hostMonitor: MonitorStepType["hostMonitor"] = data.hostMonitor;

    return compact([
      {
        key: "hostIdentifier",
        title: "Host",
        description: "The host this monitor watches.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(hostMonitor?.hostIdentifier),
        placeholder: "No host selected",
      },
      ...MonitorStepViewModel.getMetricConfigRows(data, {
        metricViewConfig: hostMonitor?.metricViewConfig,
        rollingTime: hostMonitor?.rollingTime,
      }),
    ]);
  }

  private static getProxmoxRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    const proxmoxMonitor: MonitorStepType["proxmoxMonitor"] =
      data.proxmoxMonitor;

    return compact([
      {
        key: "clusterIdentifier",
        title: "Cluster",
        description: "The Proxmox VE cluster this monitor watches.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(proxmoxMonitor?.clusterIdentifier),
        placeholder: "No cluster selected",
      },
      optional({
        key: "proxmoxScope",
        title: "Resource Scope",
        description: "The level of the cluster this monitor evaluates.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(proxmoxMonitor?.resourceFilters?.scope),
        placeholder: "Whole cluster",
      }),
      optional({
        key: "proxmoxNodeName",
        title: "Node Name",
        description: "Only this node's own series are monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(proxmoxMonitor?.resourceFilters?.nodeName),
        placeholder: "All nodes",
      }),
      optional({
        key: "proxmoxGuestId",
        title: "Guest",
        description: "Only this guest (VM or container) is monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(proxmoxMonitor?.resourceFilters?.guestId),
        placeholder: "All guests",
      }),
      optional({
        key: "proxmoxPveId",
        title: "Resource Id",
        description: "Only the resource with this Proxmox id is monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(proxmoxMonitor?.resourceFilters?.pveId),
        placeholder: "All resources",
      }),
      ...MonitorStepViewModel.getMetricConfigRows(data, {
        metricViewConfig: proxmoxMonitor?.metricViewConfig,
        rollingTime: proxmoxMonitor?.rollingTime,
      }),
    ]);
  }

  private static getDockerSwarmRows(
    data: MonitorStepType,
  ): Array<MonitorStepViewRow> {
    const dockerSwarmMonitor: MonitorStepType["dockerSwarmMonitor"] =
      data.dockerSwarmMonitor;

    return compact([
      {
        key: "clusterIdentifier",
        title: "Cluster",
        description: "The Docker Swarm cluster this monitor watches.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(dockerSwarmMonitor?.clusterIdentifier),
        placeholder: "No cluster selected",
      },
      optional({
        key: "swarmServiceName",
        title: "Service Name",
        description: "Only this Swarm service's tasks are monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(dockerSwarmMonitor?.resourceFilters?.serviceName),
        placeholder: "All services",
      }),
      optional({
        key: "swarmNodeName",
        title: "Node Name",
        description: "Only containers on this Swarm node are monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(dockerSwarmMonitor?.resourceFilters?.nodeName),
        placeholder: "All nodes",
      }),
      optional({
        key: "swarmContainerName",
        title: "Container Name",
        description: "Only this task's container is monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(dockerSwarmMonitor?.resourceFilters?.containerName),
        placeholder: "All containers",
      }),
      optional({
        key: "swarmContainerImage",
        title: "Container Image",
        description: "Only tasks running this image are monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(dockerSwarmMonitor?.resourceFilters?.containerImage),
        placeholder: "All images",
      }),
      ...MonitorStepViewModel.getMetricConfigRows(data, {
        metricViewConfig: dockerSwarmMonitor?.metricViewConfig,
        rollingTime: dockerSwarmMonitor?.rollingTime,
      }),
    ]);
  }

  private static getCephRows(data: MonitorStepType): Array<MonitorStepViewRow> {
    const cephMonitor: MonitorStepType["cephMonitor"] = data.cephMonitor;

    return compact([
      {
        key: "clusterIdentifier",
        title: "Cluster",
        description: "The Ceph cluster this monitor watches.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(cephMonitor?.clusterIdentifier),
        placeholder: "No cluster selected",
      },
      optional({
        key: "cephOsdId",
        title: "OSD",
        description: "Only this OSD daemon is monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(cephMonitor?.resourceFilters?.osdId),
        placeholder: "All OSDs",
      }),
      optional({
        key: "cephPoolId",
        title: "Pool Id",
        description: "Only this pool is monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(cephMonitor?.resourceFilters?.poolId),
        placeholder: "All pools",
      }),
      ...MonitorStepViewModel.getMetricConfigRows(data, {
        metricViewConfig: cephMonitor?.metricViewConfig,
        rollingTime: cephMonitor?.rollingTime,
      }),
    ]);
  }

  private static getIoTRows(data: MonitorStepType): Array<MonitorStepViewRow> {
    const iotMonitor: MonitorStepType["iotMonitor"] = data.iotMonitor;

    return compact([
      {
        key: "fleetIdentifier",
        title: "Fleet",
        description: "The IoT fleet this monitor watches.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(iotMonitor?.fleetIdentifier),
        placeholder: "No fleet selected",
      },
      optional({
        key: "iotScope",
        title: "Resource Scope",
        description: "The level of the fleet this monitor evaluates.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(iotMonitor?.resourceFilters?.scope),
        placeholder: "Whole fleet",
      }),
      optional({
        key: "iotDeviceId",
        title: "Device Id",
        description: "Only this device is monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(iotMonitor?.resourceFilters?.deviceId),
        placeholder: "All devices",
      }),
      optional({
        key: "iotDeviceType",
        title: "Device Type",
        description: "Only devices of this type are monitored.",
        valueType: MonitorStepViewValueType.Text,
        value: toText(iotMonitor?.resourceFilters?.deviceType),
        placeholder: "All device types",
      }),
      ...MonitorStepViewModel.getMetricConfigRows(data, {
        metricViewConfig: iotMonitor?.metricViewConfig,
        rollingTime: iotMonitor?.rollingTime,
      }),
    ]);
  }
}
