import IconProp from "../../Icon/IconProp";
import ProviderLogo from "../../ProviderLogo/ProviderLogo";
import {
  ConnectorField,
  ConnectorFieldOption,
} from "../Connectors/SecurityEventConnectorCatalog";
import { GOOGLE_SECOPS_SUPPORTED_REGIONS } from "../GoogleSecOpsRegion";
import SecurityEventDestinationProvider from "./SecurityEventDestinationProvider";

/*
 * Everything the product needs to know about a SIEM it sends to that is not
 * code: what to call it, what the form asks for (and which of it is a
 * secret), where its setup guide is, and what the SIEM calls one event.
 * Shared by the dashboard (the form, the table), the server (validation on
 * save) and the docs tests (the setup guide names every field).
 *
 * Fields use the connector catalog's shape, so a SIEM that can both be
 * read from and sent to asks for its settings the same way in both forms.
 */
export interface SecurityEventDestinationDefinition {
  provider: SecurityEventDestinationProvider;
  title: string;
  /*
   * How OneUptime sends to it, in a line under its name in the picker: what
   * tells one SIEM from another there. What is sent (detections, or every
   * event) is the form's last question, so it is not said four times.
   */
  description: string;
  // A mark of its own for the product, where a generic icon is all there is room for.
  icon: IconProp;
  // The product's official logo, beside its name in the picker and the table.
  logo: ProviderLogo;
  // The setup guide, a docs page and the heading on it.
  docsPath: string;
  configFields: Array<ConnectorField>;
  secretFields: Array<ConnectorField>;
  // What the SIEM calls one event it receives, as its own docs say it.
  sentRecordName: string;
  /*
   * The events OneUptime imported FROM this product, by the product name
   * the inbound connector stamps on them. They are never sent back: a SIEM
   * that receives its own alerts again would raise them again.
   */
  importedProductNames: Array<string>;
  // The most events, and bytes, one request carries.
  maxEventsPerRequest: number;
  maxBytesPerRequest: number;
}

export const GOOGLE_SECOPS_DESTINATION_DOCS_PATH: string =
  "/docs/integrations/google-secops#send-security-events-to-google-secops";
export const SPLUNK_DESTINATION_DOCS_PATH: string =
  "/docs/integrations/splunk#send-security-events-to-splunk";
export const MICROSOFT_SENTINEL_DESTINATION_DOCS_PATH: string =
  "/docs/integrations/microsoft-sentinel#send-security-events-to-microsoft-sentinel";
export const ELASTIC_SECURITY_DESTINATION_DOCS_PATH: string =
  "/docs/integrations/elastic-security#send-security-events-to-elastic-security";

// What a Splunk event's sourcetype is when the destination names none.
export const SPLUNK_DEFAULT_SOURCE_TYPE: string = "oneuptime:security";

/*
 * The custom table's stream a Sentinel destination sends to when it names
 * none: the one the setup guide's data collection rule declares.
 */
export const MICROSOFT_SENTINEL_DEFAULT_STREAM_NAME: string =
  "Custom-OneUptimeSecurityEvents_CL";

/*
 * The data stream an Elastic destination writes to when it names none:
 * logs-<dataset>-<namespace>, which Elasticsearch's built-in logs-*-*
 * template creates on the first write, ECS mapped.
 */
export const ELASTIC_DEFAULT_DATA_STREAM: string =
  "logs-oneuptime.security-default";

export const SecurityEventDestinationCatalog: Array<SecurityEventDestinationDefinition> =
  [
    {
      provider: SecurityEventDestinationProvider.GoogleSecOps,
      title: "Google SecOps",
      logo: ProviderLogo.GoogleSecurityOperations,
      description: "As UDM events, through the Chronicle API.",
      icon: IconProp.ViewfinderCircle,
      docsPath: GOOGLE_SECOPS_DESTINATION_DOCS_PATH,
      sentRecordName: "UDM event",
      // What the Google SecOps connector stamps on the alerts it imports.
      importedProductNames: ["Google SecOps"],
      /*
       * Chronicle's events:import takes a batch of UDM events per call; a
       * hundred small events stay far below its request size limit, and the
       * byte cap keeps a batch of large ones under it too.
       */
      maxEventsPerRequest: 100,
      maxBytesPerRequest: 900 * 1024,
      configFields: [
        {
          key: "region",
          title: "Region",
          description:
            "The Google SecOps regional endpoint that matches the location in your instance resource name.",
          type: "dropdown",
          required: true,
          placeholder: "Select a region",
          options: GOOGLE_SECOPS_SUPPORTED_REGIONS.map(
            (region: string): ConnectorFieldOption => {
              return { label: region, value: region };
            },
          ),
        },
        {
          key: "instanceResourceName",
          title: "Instance resource name",
          description:
            "The Chronicle instance resource name, from your SecOps SIEM Settings > Profile.",
          type: "text",
          required: true,
          placeholder:
            "projects/{project}/locations/{location}/instances/{instance}",
        },
      ],
      secretFields: [
        {
          key: "serviceAccountJson",
          title: "Service account JSON",
          description:
            "A Google Cloud service-account key (JSON) with a role that can import events (chronicle.events.import), such as Chronicle API Editor. Encrypted at rest and never returned by the API.",
          type: "json",
          required: true,
          placeholder: '{ "client_email": "...", "private_key": "..." }',
        },
      ],
    },
    {
      provider: SecurityEventDestinationProvider.Splunk,
      title: "Splunk",
      logo: ProviderLogo.Splunk,
      description:
        "Through its HTTP Event Collector (HEC), with CIM field names.",
      icon: IconProp.Search,
      docsPath: SPLUNK_DESTINATION_DOCS_PATH,
      sentRecordName: "event",
      // What the Splunk connector stamps on the notable events it imports.
      importedProductNames: ["Splunk Enterprise Security"],
      /*
       * HEC takes several events in one request, up to the collector's
       * max_content_length (1 MB by default on Splunk Enterprise).
       */
      maxEventsPerRequest: 500,
      maxBytesPerRequest: 800 * 1024,
      configFields: [
        {
          key: "hecUrl",
          title: "HEC URL",
          description:
            "The HTTP Event Collector's address: on Splunk Cloud https://http-inputs-<stack>.splunkcloud.com, on Splunk Enterprise port 8088.",
          type: "url",
          required: true,
          placeholder: "https://splunk.example.com:8088",
        },
        {
          key: "index",
          title: "Index",
          description:
            "The index events are written to. Leave empty for the token's default index.",
          type: "text",
          required: false,
          placeholder: "security",
          isAdvanced: true,
        },
        {
          key: "sourceType",
          title: "Source type",
          description: `The sourcetype events carry. Leave empty for ${SPLUNK_DEFAULT_SOURCE_TYPE}.`,
          type: "text",
          required: false,
          placeholder: SPLUNK_DEFAULT_SOURCE_TYPE,
          isAdvanced: true,
        },
      ],
      secretFields: [
        {
          key: "hecToken",
          title: "HEC token",
          description:
            "An HTTP Event Collector token (Settings > Data inputs > HTTP Event Collector). Encrypted at rest and never returned by the API.",
          type: "password",
          required: true,
        },
      ],
    },
    {
      provider: SecurityEventDestinationProvider.MicrosoftSentinel,
      title: "Microsoft Sentinel",
      logo: ProviderLogo.MicrosoftSentinel,
      description:
        "To a workspace's custom table, through the Azure Monitor Logs Ingestion API.",
      icon: IconProp.ShieldCheck,
      docsPath: MICROSOFT_SENTINEL_DESTINATION_DOCS_PATH,
      sentRecordName: "log record",
      // What the Sentinel connector stamps on the incidents it imports.
      importedProductNames: ["Microsoft Sentinel"],
      // The Logs Ingestion API takes up to 1 MB in one call.
      maxEventsPerRequest: 500,
      maxBytesPerRequest: 900 * 1024,
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
            "The app registration given the Monitoring Metrics Publisher role on the data collection rule.",
          type: "text",
          required: true,
          placeholder: "00000000-0000-0000-0000-000000000000",
        },
        {
          key: "logsIngestionEndpoint",
          title: "Logs ingestion endpoint",
          description:
            "The data collection endpoint's (or rule's) logs ingestion URL, from its Overview page in the Azure portal.",
          type: "url",
          required: true,
          placeholder: "https://my-dce-abcd.eastus-1.ingest.monitor.azure.com",
        },
        {
          key: "dcrImmutableId",
          title: "Data collection rule immutable ID",
          description:
            "The immutable ID of the data collection rule that sends to your Sentinel workspace's custom table.",
          type: "text",
          required: true,
          placeholder: "dcr-00000000000000000000000000000000",
        },
        {
          key: "streamName",
          title: "Stream",
          description: `The data collection rule's input stream. Leave empty for ${MICROSOFT_SENTINEL_DEFAULT_STREAM_NAME}.`,
          type: "text",
          required: false,
          placeholder: MICROSOFT_SENTINEL_DEFAULT_STREAM_NAME,
          isAdvanced: true,
        },
        {
          key: "cloud",
          title: "Cloud",
          // The field starts on the public cloud (defaultValue below).
          description: "Which Azure cloud hosts the tenant and workspace.",
          type: "dropdown",
          // The sender reads anything but usgov as the public cloud.
          required: false,
          options: [
            { label: "Azure public cloud", value: "public" },
            { label: "Azure Government (US)", value: "usgov" },
          ],
          defaultValue: "public",
          isAdvanced: true,
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
      provider: SecurityEventDestinationProvider.ElasticSecurity,
      title: "Elastic Security",
      logo: ProviderLogo.Elastic,
      description:
        "As Elastic Common Schema (ECS) documents in an Elasticsearch data stream.",
      icon: IconProp.Database,
      docsPath: ELASTIC_SECURITY_DESTINATION_DOCS_PATH,
      sentRecordName: "document",
      // What the Elastic connector stamps on the alerts it imports.
      importedProductNames: ["Elastic Security"],
      // A bulk request well under the 100 MB http.max_content_length.
      maxEventsPerRequest: 500,
      maxBytesPerRequest: 2 * 1024 * 1024,
      configFields: [
        {
          key: "elasticsearchUrl",
          title: "Elasticsearch URL",
          description:
            "The Elasticsearch endpoint, on Elastic Cloud copied from the deployment's page, without a trailing path.",
          type: "url",
          required: true,
          placeholder: "https://my-deployment.es.us-east-1.aws.elastic.cloud",
        },
        {
          key: "dataStream",
          title: "Data stream",
          description: `The data stream documents are written to. Leave empty for ${ELASTIC_DEFAULT_DATA_STREAM}.`,
          type: "text",
          required: false,
          placeholder: ELASTIC_DEFAULT_DATA_STREAM,
          isAdvanced: true,
        },
      ],
      secretFields: [
        {
          key: "apiKey",
          title: "API key",
          description:
            "An Elasticsearch API key (the encoded value) that can create documents in the data stream. Encrypted at rest and never returned by the API.",
          type: "password",
          required: true,
        },
      ],
    },
  ];

export function getSecurityEventDestinationDefinition(
  provider: string | undefined,
): SecurityEventDestinationDefinition | undefined {
  return SecurityEventDestinationCatalog.find(
    (definition: SecurityEventDestinationDefinition): boolean => {
      return definition.provider === provider;
    },
  );
}

export function getSecurityEventDestinationTitle(
  provider: string | undefined,
): string {
  return (
    getSecurityEventDestinationDefinition(provider)?.title || provider || ""
  );
}
