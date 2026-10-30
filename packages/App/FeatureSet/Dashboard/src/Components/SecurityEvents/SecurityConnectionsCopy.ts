import SecurityLogFormat, {
  SecurityLogFormatGroup,
} from "Common/Types/SecurityEvent/SecurityLogFormat";
import {
  GOOGLE_WORKSPACE_DRIVE_KEY,
  MICROSOFT_365_AUDIT_KEY,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventDestinationScope from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import SecurityEventDestinationProvider from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
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
  [SecurityLogFormat.WindowsEvents]: {
    title: translationKey("Windows events"),
    description: translationKey(
      "Sign-ins, new processes, accounts and groups changed, services installed and logs cleared, from Windows, Sysmon and Microsoft Defender.",
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
  [SecurityLogFormat.GoogleCloudAudit]: {
    title: translationKey("Google Cloud audit logs"),
    description: translationKey(
      "Changes made in your Google Cloud projects, calls Google refused, and Google Workspace sign-ins shared with Google Cloud.",
    ),
  },
  [SecurityLogFormat.AzureActivity]: {
    title: translationKey("Azure activity and Entra ID logs"),
    description: translationKey(
      "Changes made in your Azure subscriptions, Defender for Cloud alerts, and Microsoft Entra ID sign-ins and directory changes.",
    ),
  },
  [SecurityLogFormat.Cef]: {
    title: translationKey("CEF"),
    description: translationKey(
      "Threats, blocked connections and sign-ins from firewalls, IDS, WAFs and other security products that send Common Event Format.",
    ),
  },
  [SecurityLogFormat.Leef]: {
    title: translationKey("LEEF"),
    description: translationKey(
      "The same from products that send Log Event Extended Format, as many do for IBM QRadar.",
    ),
  },
  [SecurityLogFormat.WebAttack]: {
    title: translationKey("Web attacks"),
    description: translationKey(
      "Requests in a web server's access log that try SQL injection, path traversal or Log4Shell.",
    ),
  },
};

/*
 * Where each kind of log comes from, as Your logs groups them: four places a
 * team knows instead of ten formats in a row.
 */
export const SECURITY_LOG_FORMAT_GROUP_TEXTS: Record<
  SecurityLogFormatGroup,
  string
> = {
  [SecurityLogFormatGroup.Servers]: translationKey("Servers"),
  [SecurityLogFormatGroup.Cloud]: translationKey("Cloud"),
  [SecurityLogFormatGroup.SecurityDevices]: translationKey("Security devices"),
  [SecurityLogFormatGroup.Applications]: translationKey("Applications"),
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
 * Each SIEM's line under its name in the Send to your SIEM picker, by the
 * catalog's provider: how OneUptime sends to it. The picker draws the
 * catalog's own words; these only put them in the locale files. A SIEM's
 * name is a name and is never translated.
 */
export const SECURITY_EVENT_DESTINATION_TEXTS: Record<
  SecurityEventDestinationProvider,
  string
> = {
  [SecurityEventDestinationProvider.GoogleSecOps]: translationKey(
    "As UDM events, through the Chronicle API.",
  ),
  [SecurityEventDestinationProvider.Splunk]: translationKey(
    "Through its HTTP Event Collector (HEC), with CIM field names.",
  ),
  [SecurityEventDestinationProvider.MicrosoftSentinel]: translationKey(
    "To a workspace's custom table, through the Azure Monitor Logs Ingestion API.",
  ),
  [SecurityEventDestinationProvider.ElasticSecurity]: translationKey(
    "As Elastic Common Schema (ECS) documents in an Elasticsearch data stream.",
  ),
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
      "Closing a security case closes its Google SecOps alerts too, with the case's verdict and closing note. The connection's service account needs the Chronicle API Editor role.",
    ),
  },
  [MICROSOFT_365_AUDIT_KEY]: {
    title: translationKey("Microsoft 365 audit log"),
    description: translationKey(
      "Also import Exchange, SharePoint, OneDrive and Teams activity. The app registration needs the ActivityFeed.Read permission of the Office 365 Management APIs.",
    ),
  },
  [GOOGLE_WORKSPACE_DRIVE_KEY]: {
    title: translationKey("Drive activity"),
    description: translationKey(
      "Also import files shared outside the organization, made public or downloaded in Google Drive.",
    ),
  },
};
