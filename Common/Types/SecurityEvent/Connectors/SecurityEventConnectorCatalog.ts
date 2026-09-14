import IconProp from "../../Icon/IconProp";
import SecurityEventConnectorProvider from "./SecurityEventConnectorProvider";

/*
 * Everything the product needs to know about a provider that is NOT code:
 * what to call it, which fields its connection form asks for, which of
 * those are secrets, where its docs live, and how it attributes the
 * events it imports. Shared by the dashboard (form generation, table
 * labels, provider picker), the server (validation of config and secrets
 * on create/update) and the docs tests (every provider has a page that
 * names every field).
 *
 * Field keys are the keys stored in SecurityEventConnection.config
 * (non-secret, readable) and SecurityEventConnection.secrets (encrypted,
 * write-only) respectively. Connectors read their settings by these keys.
 */

export type SecurityEventConnectorCategory =
  | "SIEM"
  | "EDR / XDR"
  | "Cloud security"
  | "Identity";

export const SecurityEventConnectorCategories: Array<SecurityEventConnectorCategory> =
  ["SIEM", "EDR / XDR", "Cloud security", "Identity"];

export type ConnectorFieldType =
  | "text"
  | "url"
  | "password"
  | "number"
  | "toggle"
  | "dropdown";

export interface ConnectorFieldOption {
  label: string;
  value: string;
}

export interface ConnectorField {
  key: string;
  title: string;
  description: string;
  type: ConnectorFieldType;
  required: boolean;
  placeholder?: string | undefined;
  options?: Array<ConnectorFieldOption> | undefined;
  defaultValue?: string | boolean | number | undefined;
}

export interface SecurityEventConnectorDefinition {
  provider: SecurityEventConnectorProvider;
  title: string;
  // Stored on every imported event; also the dedupe scope.
  vendorName: string;
  productName: string;
  description: string;
  category: SecurityEventConnectorCategory;
  icon: IconProp;
  // Docs path under /docs, e.g. "/docs/integrations/microsoft-sentinel".
  docsPath: string;
  defaultPollIntervalInMinutes: number;
  configFields: Array<ConnectorField>;
  secretFields: Array<ConnectorField>;
  /*
   * Whether the provider distinguishes alerting from non-alerting records
   * so the "alerts only" toggle on the connection means something.
   */
  supportsAlertingOnlyToggle: boolean;
  // What one imported record is, in the customer's own vocabulary.
  importedRecordName: string;
  /*
   * How far before the saved cursor each poll starts. The creation
   * timestamp a source filters on is not always the moment the record
   * became readable: AWS Security Hub filters on the provider's CreatedAt,
   * which can precede delivery to Security Hub by many minutes, and Okta
   * documents that bounded System Log requests can omit delayed events.
   * Records re-read inside the overlap are dropped by the id dedupe, so a
   * generous overlap costs requests, never duplicates.
   */
  cursorOverlapInMinutes: number;
}

const MICROSOFT_CLOUD_OPTIONS: Array<ConnectorFieldOption> = [
  { label: "Azure public cloud", value: "public" },
  { label: "Azure Government (US)", value: "usgov" },
];

export const SecurityEventConnectorCatalog: Array<SecurityEventConnectorDefinition> =
  [
    {
      provider: SecurityEventConnectorProvider.MicrosoftSentinel,
      title: "Microsoft Sentinel",
      vendorName: "Microsoft",
      productName: "Microsoft Sentinel",
      description:
        "Import Sentinel incidents from a Log Analytics workspace as Incident Finding events.",
      category: "SIEM",
      icon: IconProp.ShieldCheck,
      docsPath: "/docs/integrations/microsoft-sentinel",
      defaultPollIntervalInMinutes: 5,
      supportsAlertingOnlyToggle: false,
      importedRecordName: "incident",
      cursorOverlapInMinutes: 1,
      configFields: [
        {
          key: "tenantId",
          title: "Directory (tenant) ID",
          description:
            "The Microsoft Entra tenant that owns the app registration.",
          type: "text",
          required: true,
          placeholder: "00000000-0000-0000-0000-000000000000",
        },
        {
          key: "clientId",
          title: "Application (client) ID",
          description:
            "The app registration granted the Microsoft Sentinel Reader role on the workspace.",
          type: "text",
          required: true,
          placeholder: "00000000-0000-0000-0000-000000000000",
        },
        {
          key: "subscriptionId",
          title: "Subscription ID",
          description: "The Azure subscription that contains the workspace.",
          type: "text",
          required: true,
        },
        {
          key: "resourceGroup",
          title: "Resource group",
          description: "The resource group of the Log Analytics workspace.",
          type: "text",
          required: true,
        },
        {
          key: "workspaceName",
          title: "Workspace name",
          description:
            "The Log Analytics workspace Microsoft Sentinel is enabled on.",
          type: "text",
          required: true,
        },
        {
          key: "cloud",
          title: "Cloud",
          description: "Which Azure cloud hosts the tenant and workspace.",
          type: "dropdown",
          required: true,
          options: MICROSOFT_CLOUD_OPTIONS,
          defaultValue: "public",
        },
      ],
      secretFields: [
        {
          key: "clientSecret",
          title: "Client secret",
          description:
            "A client secret of the app registration. Encrypted at rest and never returned by the API.",
          type: "password",
          required: true,
        },
      ],
    },
    {
      provider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      title: "Microsoft Defender XDR",
      vendorName: "Microsoft",
      productName: "Microsoft Defender XDR",
      description:
        "Import Defender XDR alerts through the Microsoft Graph security API as Detection Finding events.",
      category: "EDR / XDR",
      icon: IconProp.ShieldExclamation,
      docsPath: "/docs/integrations/microsoft-defender-xdr",
      defaultPollIntervalInMinutes: 5,
      supportsAlertingOnlyToggle: false,
      importedRecordName: "alert",
      cursorOverlapInMinutes: 1,
      configFields: [
        {
          key: "tenantId",
          title: "Directory (tenant) ID",
          description:
            "The Microsoft Entra tenant that owns the app registration.",
          type: "text",
          required: true,
          placeholder: "00000000-0000-0000-0000-000000000000",
        },
        {
          key: "clientId",
          title: "Application (client) ID",
          description:
            "The app registration granted the SecurityAlert.Read.All application permission.",
          type: "text",
          required: true,
          placeholder: "00000000-0000-0000-0000-000000000000",
        },
        {
          key: "cloud",
          title: "Cloud",
          description: "Which Azure cloud hosts the tenant.",
          type: "dropdown",
          required: true,
          options: MICROSOFT_CLOUD_OPTIONS,
          defaultValue: "public",
        },
      ],
      secretFields: [
        {
          key: "clientSecret",
          title: "Client secret",
          description:
            "A client secret of the app registration. Encrypted at rest and never returned by the API.",
          type: "password",
          required: true,
        },
      ],
    },
    {
      provider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
      title: "CrowdStrike Falcon",
      vendorName: "CrowdStrike",
      productName: "Falcon",
      description:
        "Import Falcon alerts (endpoint, identity and cloud detections) as Detection Finding events.",
      category: "EDR / XDR",
      icon: IconProp.Bolt,
      docsPath: "/docs/integrations/crowdstrike-falcon",
      defaultPollIntervalInMinutes: 5,
      supportsAlertingOnlyToggle: false,
      importedRecordName: "alert",
      cursorOverlapInMinutes: 1,
      configFields: [
        {
          key: "clientId",
          title: "Client ID",
          description:
            "The Falcon API client ID. The client needs the Alerts: Read scope.",
          type: "text",
          required: true,
        },
        {
          key: "cloud",
          title: "Falcon cloud",
          description:
            "The CrowdStrike cloud your customer ID (CID) is hosted in; it decides the API hostname.",
          type: "dropdown",
          required: true,
          options: [
            { label: "US-1 (api.crowdstrike.com)", value: "us-1" },
            { label: "US-2 (api.us-2.crowdstrike.com)", value: "us-2" },
            { label: "EU-1 (api.eu-1.crowdstrike.com)", value: "eu-1" },
            {
              label: "US-GOV-1 (api.laggar.gcw.crowdstrike.com)",
              value: "us-gov-1",
            },
          ],
          defaultValue: "us-1",
        },
      ],
      secretFields: [
        {
          key: "clientSecret",
          title: "Client secret",
          description:
            "The Falcon API client secret. Encrypted at rest and never returned by the API.",
          type: "password",
          required: true,
        },
      ],
    },
    {
      provider: SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
      title: "Splunk Enterprise Security",
      vendorName: "Splunk",
      productName: "Splunk Enterprise Security",
      description:
        "Import notable events from Splunk Enterprise Security (or any saved search) as Detection Finding events.",
      category: "SIEM",
      icon: IconProp.Search,
      docsPath: "/docs/integrations/splunk",
      defaultPollIntervalInMinutes: 5,
      supportsAlertingOnlyToggle: false,
      importedRecordName: "notable event",
      cursorOverlapInMinutes: 1,
      configFields: [
        {
          key: "url",
          title: "Splunk management URL",
          description:
            "The REST API base URL of the search head, usually on port 8089.",
          type: "url",
          required: true,
          placeholder: "https://splunk.example.com:8089",
        },
        {
          key: "searchString",
          title: "Search",
          description:
            "The SPL that selects the events to import. The connector adds the time range itself; do not include earliest or latest.",
          type: "text",
          required: false,
          placeholder: "index=notable",
          defaultValue: "index=notable",
        },
        {
          key: "username",
          title: "Username",
          description:
            "Only when authenticating with a password instead of an authentication token.",
          type: "text",
          required: false,
        },
      ],
      secretFields: [
        {
          key: "apiToken",
          title: "Authentication token",
          description:
            "A Splunk authentication token (Settings > Tokens). Leave empty when using username and password.",
          type: "password",
          required: false,
        },
        {
          key: "password",
          title: "Password",
          description:
            "The password for the username above. Leave empty when using an authentication token.",
          type: "password",
          required: false,
        },
      ],
    },
    {
      provider: SecurityEventConnectorProvider.ElasticSecurity,
      title: "Elastic Security",
      vendorName: "Elastic",
      productName: "Elastic Security",
      description:
        "Import detection alerts from Elastic Security through the Kibana detections API as Detection Finding events.",
      category: "SIEM",
      icon: IconProp.ShieldCheck,
      docsPath: "/docs/integrations/elastic-security",
      defaultPollIntervalInMinutes: 5,
      supportsAlertingOnlyToggle: false,
      importedRecordName: "alert",
      cursorOverlapInMinutes: 1,
      configFields: [
        {
          key: "kibanaUrl",
          title: "Kibana URL",
          description: "The base URL of Kibana, without a trailing path.",
          type: "url",
          required: true,
          placeholder: "https://kibana.example.com",
        },
        {
          key: "space",
          title: "Kibana space",
          description:
            "The space that holds the detection rules. Leave empty for the default space.",
          type: "text",
          required: false,
        },
      ],
      secretFields: [
        {
          key: "apiKey",
          title: "API key",
          description:
            "A Kibana API key (the base64 encoded id:key value) with read access to detection alerts. Encrypted at rest and never returned by the API.",
          type: "password",
          required: true,
        },
      ],
    },
    {
      provider: SecurityEventConnectorProvider.AwsSecurityHub,
      title: "AWS Security Hub",
      vendorName: "Amazon Web Services",
      productName: "AWS Security Hub",
      description:
        "Import Security Hub findings (GuardDuty, Inspector, Macie, IAM Access Analyzer and partner products) as Detection and Compliance Finding events.",
      category: "Cloud security",
      icon: IconProp.Cloud,
      docsPath: "/docs/integrations/aws-security-hub",
      defaultPollIntervalInMinutes: 5,
      supportsAlertingOnlyToggle: false,
      importedRecordName: "finding",
      cursorOverlapInMinutes: 30,
      configFields: [
        {
          key: "region",
          title: "Region",
          description:
            "The AWS region of the Security Hub administrator or aggregation account.",
          type: "text",
          required: true,
          placeholder: "us-east-1",
        },
        {
          key: "accessKeyId",
          title: "Access key ID",
          description:
            "An IAM access key with the securityhub:GetFindings permission.",
          type: "text",
          required: true,
          placeholder: "AKIA...",
        },
      ],
      secretFields: [
        {
          key: "secretAccessKey",
          title: "Secret access key",
          description:
            "The secret access key for the access key ID above. Encrypted at rest and never returned by the API.",
          type: "password",
          required: true,
        },
        {
          key: "sessionToken",
          title: "Session token",
          description:
            "Only for temporary credentials. Leave empty for a long-lived access key.",
          type: "password",
          required: false,
        },
      ],
    },
    {
      provider: SecurityEventConnectorProvider.OktaSystemLog,
      title: "Okta System Log",
      vendorName: "Okta",
      productName: "Okta System Log",
      description:
        "Import authentication, MFA, account and policy events from the Okta System Log as OCSF identity events.",
      category: "Identity",
      icon: IconProp.Key,
      docsPath: "/docs/integrations/okta",
      defaultPollIntervalInMinutes: 5,
      supportsAlertingOnlyToggle: false,
      importedRecordName: "log event",
      cursorOverlapInMinutes: 15,
      configFields: [
        {
          key: "orgUrl",
          title: "Okta organization URL",
          description: "Your Okta org URL, without a trailing path.",
          type: "url",
          required: true,
          placeholder: "https://acme.okta.com",
        },
        {
          key: "filter",
          title: "Event filter",
          description:
            "Optional Okta System Log filter expression. Leave empty to import the security-relevant event families the connector selects by default.",
          type: "text",
          required: false,
          placeholder: 'eventType sw "user.session" or eventType sw "security"',
        },
      ],
      secretFields: [
        {
          key: "apiToken",
          title: "API token",
          description:
            "An Okta API token (SSWS) for a read-only administrator. Encrypted at rest and never returned by the API.",
          type: "password",
          required: true,
        },
      ],
    },
  ];

export function getSecurityEventConnectorDefinition(
  provider: string | undefined,
): SecurityEventConnectorDefinition | undefined {
  return SecurityEventConnectorCatalog.find(
    (definition: SecurityEventConnectorDefinition): boolean => {
      return definition.provider === provider;
    },
  );
}

export function getSecurityEventConnectorTitle(
  provider: string | undefined,
): string {
  return getSecurityEventConnectorDefinition(provider)?.title || provider || "";
}
