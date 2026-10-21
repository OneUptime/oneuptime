import SecurityLogFormat from "Common/Types/SecurityEvent/SecurityLogFormat";
import SecurityEventDestinationScope from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words the Connections page shows for things defined in Common/Types -
 * the log formats "Your logs" recognizes, what a SIEM can be sent and the
 * Google SecOps form's fields - marked here so the extractor puts them in
 * the locale files (it does not read Common/Types/SecurityEvent). The
 * English is the same text the definitions carry, word for word; a test
 * holds the two together (App/Tests/Dashboard/SecurityConnectionsCopy).
 */

export interface SecurityConnectionsText {
  title: string;
  description: string;
}

export const SECURITY_LOG_FORMAT_TEXTS: Record<
  SecurityLogFormat,
  SecurityConnectionsText
> = {
  [SecurityLogFormat.SshSignIn]: {
    title: translationKey("SSH sign-ins"),
    description: translationKey(
      "Failed and successful SSH sign-ins from a server's auth log, journal or syslog.",
    ),
  },
  [SecurityLogFormat.Sudo]: {
    title: translationKey("sudo"),
    description: translationKey(
      "Commands run as another user, wrong sudo passwords and people not allowed to use sudo.",
    ),
  },
  [SecurityLogFormat.KubernetesAudit]: {
    title: translationKey("Kubernetes audit logs"),
    description: translationKey(
      "Changes to the cluster, shells opened in pods, secrets read and requests that were refused.",
    ),
  },
  [SecurityLogFormat.AwsCloudTrail]: {
    title: translationKey("AWS CloudTrail"),
    description: translationKey(
      "Console sign-ins, changes made in your AWS accounts and calls AWS refused.",
    ),
  },
  [SecurityLogFormat.WebAttack]: {
    title: translationKey("Web attacks"),
    description: translationKey(
      "Requests in a web server's access log that try SQL injection, path traversal or Log4Shell.",
    ),
  },
};

export const SECURITY_EVENT_DESTINATION_SCOPE_TEXTS: Record<
  SecurityEventDestinationScope,
  SecurityConnectionsText
> = {
  [SecurityEventDestinationScope.Detections]: {
    title: translationKey("Detections only"),
    description: translationKey(
      "What your detection rules and threat intel found, and the alerts your connected products raised.",
    ),
  },
  [SecurityEventDestinationScope.AllEvents]: {
    title: translationKey("All security events"),
    description: translationKey(
      "Every security event OneUptime receives, so your SIEM can search them too.",
    ),
  },
};

/*
 * The destination form's fields, by the catalog's field key. The form draws
 * the catalog's own title and description; these only put the same words
 * in the locale files.
 */
export const SECURITY_EVENT_DESTINATION_FIELD_TEXTS: Record<
  string,
  SecurityConnectionsText
> = {
  region: {
    title: translationKey("Region"),
    description: translationKey(
      "The Google SecOps regional endpoint that matches the location in your instance resource name.",
    ),
  },
  instanceResourceName: {
    title: translationKey("Instance resource name"),
    description: translationKey(
      "The Chronicle instance resource name, from your SecOps SIEM Settings > Profile.",
    ),
  },
  serviceAccountJson: {
    title: translationKey("Service account JSON"),
    description: translationKey(
      "A Google Cloud service-account key (JSON) with a role that can import events (chronicle.events.import), such as Chronicle API Editor. Encrypted at rest and never returned by the API.",
    ),
  },
  // Splunk's HTTP Event Collector.
  hecUrl: {
    title: translationKey("HEC URL"),
    description: translationKey(
      "The HTTP Event Collector's address: on Splunk Cloud https://http-inputs-<stack>.splunkcloud.com, on Splunk Enterprise port 8088.",
    ),
  },
  index: {
    title: translationKey("Index"),
    description: translationKey(
      "The index events are written to. Leave empty for the token's default index.",
    ),
  },
  sourceType: {
    title: translationKey("Source type"),
    description: translationKey(
      "The sourcetype events carry. Leave empty for oneuptime:security.",
    ),
  },
  hecToken: {
    title: translationKey("HEC token"),
    description: translationKey(
      "An HTTP Event Collector token (Settings > Data inputs > HTTP Event Collector). Encrypted at rest and never returned by the API.",
    ),
  },
  // Microsoft Sentinel, through the Azure Monitor Logs Ingestion API.
  tenantId: {
    title: translationKey("Directory (tenant) ID"),
    description: translationKey(
      "The Microsoft Entra tenant that owns the app registration.",
    ),
  },
  clientId: {
    title: translationKey("Application (client) ID"),
    description: translationKey(
      "The app registration given the Monitoring Metrics Publisher role on the data collection rule.",
    ),
  },
  logsIngestionEndpoint: {
    title: translationKey("Logs ingestion endpoint"),
    description: translationKey(
      "The data collection endpoint's (or rule's) logs ingestion URL, from its Overview page in the Azure portal.",
    ),
  },
  dcrImmutableId: {
    title: translationKey("Data collection rule immutable ID"),
    description: translationKey(
      "The immutable ID of the data collection rule that sends to your Sentinel workspace's custom table.",
    ),
  },
  streamName: {
    title: translationKey("Stream"),
    description: translationKey(
      "The data collection rule's input stream. Leave empty for Custom-OneUptimeSecurityEvents_CL.",
    ),
  },
  cloud: {
    title: translationKey("Cloud"),
    description: translationKey(
      "Which Azure cloud hosts the tenant and workspace.",
    ),
  },
  clientSecret: {
    title: translationKey("Client secret"),
    description: translationKey(
      "A client secret of the app registration. Encrypted at rest and never returned by the API.",
    ),
  },
  // Elasticsearch, in Elastic Common Schema.
  elasticsearchUrl: {
    title: translationKey("Elasticsearch URL"),
    description: translationKey(
      "The Elasticsearch endpoint, on Elastic Cloud copied from the deployment's page, without a trailing path.",
    ),
  },
  dataStream: {
    title: translationKey("Data stream"),
    description: translationKey(
      "The data stream documents are written to. Leave empty for logs-oneuptime.security-default.",
    ),
  },
  apiKey: {
    title: translationKey("API key"),
    description: translationKey(
      "An Elasticsearch API key (the encoded value) that can create documents in the data stream. Encrypted at rest and never returned by the API.",
    ),
  },
};

/*
 * The connection form's provider options (ConnectorField.isOption), by the
 * catalog's field key: asked on the form's last step with the connection's
 * other options. The form draws the catalog's own words; these only put
 * them in the locale files.
 */
export const SECURITY_EVENT_CONNECTION_OPTION_TEXTS: Record<
  string,
  SecurityConnectionsText
> = {
  closeAlertsWhenCaseCloses: {
    title: translationKey("Close alerts when their case closes"),
    description: translationKey(
      "Closing a security case closes its Google SecOps alerts too, with the verdict and closing note. The key needs the Chronicle API Editor role.",
    ),
  },
};
