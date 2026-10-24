import IconProp from "../../Icon/IconProp";
import { JSONObject, JSONValue } from "../../JSON";
import { ConnectorField } from "../../SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import AuditLogExportDestinationType from "./AuditLogExportDestinationType";

/*
 * Everything the product needs to know about an audit log destination that
 * is not code: what to call it, what the form asks for (and which of it is
 * a secret), where its setup guide is, and how big one batch may be.
 * Shared by the Enterprise UI (the form, the table), the server (validation
 * on save, AuditLogExportService) and the docs tests (the guide names every
 * field).
 *
 * Fields use the connector catalog's shape (ConnectorField), so they are
 * checked on save by the same rules as a SIEM destination's.
 */

/*
 * A field of one destination. `showWhen` keeps a field to one choice of
 * another config field (Azure's SAS token only with SAS authentication):
 * the form shows it, and the server asks for it and keeps it, only while
 * that field holds one of the values.
 */
export interface AuditLogExportDestinationField extends ConnectorField {
  showWhen?:
    | {
        key: string;
        values: Array<string>;
      }
    | undefined;
  // A text field the form draws as several lines (a PEM certificate).
  isMultiline?: boolean | undefined;
}

export enum AuditLogExportDestinationKind {
  // One compressed NDJSON file per batch, in a bucket or a container.
  Files = "files",
  // Batches of entries, sent as they are recorded.
  Stream = "stream",
}

export interface AuditLogExportDestinationDefinition {
  type: AuditLogExportDestinationType;
  title: string;
  // One line under the title in the picker: what tells it from the others.
  description: string;
  icon: IconProp;
  kind: AuditLogExportDestinationKind;
  // The setup guide: a docs page and the heading on it.
  docsPath: string;
  configFields: Array<AuditLogExportDestinationField>;
  secretFields: Array<AuditLogExportDestinationField>;
  // The most entries, and bytes of NDJSON, one file or one request carries.
  maxEntriesPerBatch: number;
  maxBytesPerBatch: number;
}

export const AUDIT_LOG_EXPORT_DOCS_PATH: string =
  "/docs/configuration/audit-log-export";

// Where the files of a file destination go when it names no folder.
export const AUDIT_LOG_EXPORT_DEFAULT_FOLDER: string = "oneuptime/audit-logs/";

// The port a syslog destination uses when it names none: syslog over TLS (RFC 5425).
export const AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_PORT: number = 6514;

// The header a webhook's credential goes in when it names none.
export const AUDIT_LOG_EXPORT_DEFAULT_WEBHOOK_HEADER: string = "Authorization";

export enum AuditLogExportWebhookBodyFormat {
  // [ {...}, {...} ]: what Datadog's and most HTTP intakes take.
  JsonArray = "json-array",
  // One entry per line: what Sumo Logic, Splunk's raw HEC endpoint, Vector and Fluent Bit take.
  NdJson = "ndjson",
}

export enum AuditLogExportSyslogProtocol {
  Tls = "tls",
  Tcp = "tcp",
}

export enum AuditLogExportSyslogFraming {
  // Each message preceded by its length in bytes (RFC 5425, RFC 6587).
  OctetCounting = "octet-counting",
  // Each message followed by a line break, as older receivers read TCP.
  NewLine = "newline",
}

export enum AuditLogExportAzureAuthentication {
  SasToken = "sas",
  AccessKey = "access-key",
}

export enum AuditLogExportAzureCloud {
  Public = "public",
  UsGovernment = "usgov",
  China = "china",
}

const FILE_MAX_ENTRIES_PER_BATCH: number = 5000;
const FILE_MAX_BYTES_PER_BATCH: number = 16 * 1024 * 1024;

const folderField: AuditLogExportDestinationField = {
  key: "folder",
  title: "Folder",
  description: `Where the files go. Leave empty for ${AUDIT_LOG_EXPORT_DEFAULT_FOLDER}.`,
  type: "text",
  required: false,
  placeholder: AUDIT_LOG_EXPORT_DEFAULT_FOLDER,
  isAdvanced: true,
};

const accessKeyIdField: AuditLogExportDestinationField = {
  key: "accessKeyId",
  title: "Access key ID",
  description:
    "The ID of an access key that may write objects to the bucket (s3:PutObject).",
  type: "text",
  required: true,
};

const secretAccessKeyField: AuditLogExportDestinationField = {
  key: "secretAccessKey",
  title: "Secret access key",
  description:
    "The access key's secret. Encrypted at rest and never returned by the API.",
  type: "password",
  required: true,
};

export const AuditLogExportDestinationCatalog: Array<AuditLogExportDestinationDefinition> =
  [
    {
      type: AuditLogExportDestinationType.AmazonS3,
      title: "Amazon S3",
      description: "Compressed NDJSON files in an S3 bucket.",
      icon: IconProp.Archive,
      kind: AuditLogExportDestinationKind.Files,
      docsPath: `${AUDIT_LOG_EXPORT_DOCS_PATH}#amazon-s3`,
      maxEntriesPerBatch: FILE_MAX_ENTRIES_PER_BATCH,
      maxBytesPerBatch: FILE_MAX_BYTES_PER_BATCH,
      configFields: [
        {
          key: "bucket",
          title: "Bucket",
          description: "The bucket the files are written to.",
          type: "text",
          required: true,
          placeholder: "my-audit-logs",
        },
        {
          key: "region",
          title: "Region",
          description: "The bucket's region, such as us-east-1.",
          type: "text",
          required: true,
          placeholder: "us-east-1",
          defaultValue: "us-east-1",
        },
        accessKeyIdField,
        folderField,
      ],
      secretFields: [secretAccessKeyField],
    },
    {
      type: AuditLogExportDestinationType.S3Compatible,
      title: "S3-compatible storage",
      description:
        "Compressed NDJSON files on MinIO, Cloudflare R2, Backblaze B2, Wasabi or any storage with an S3 API.",
      icon: IconProp.InboxStack,
      kind: AuditLogExportDestinationKind.Files,
      docsPath: `${AUDIT_LOG_EXPORT_DOCS_PATH}#s3-compatible-storage`,
      maxEntriesPerBatch: FILE_MAX_ENTRIES_PER_BATCH,
      maxBytesPerBatch: FILE_MAX_BYTES_PER_BATCH,
      configFields: [
        {
          key: "endpoint",
          title: "Endpoint",
          description:
            "The storage's S3 address, such as https://minio.example.com:9000 or https://<account>.r2.cloudflarestorage.com.",
          type: "url",
          required: true,
          placeholder: "https://minio.example.com:9000",
        },
        {
          key: "bucket",
          title: "Bucket",
          description: "The bucket the files are written to.",
          type: "text",
          required: true,
          placeholder: "my-audit-logs",
        },
        {
          key: "region",
          title: "Region",
          description:
            "The region the storage expects: us-east-1 for MinIO and Wasabi's default, auto for Cloudflare R2.",
          type: "text",
          required: true,
          placeholder: "us-east-1",
          defaultValue: "us-east-1",
        },
        accessKeyIdField,
        folderField,
      ],
      secretFields: [secretAccessKeyField],
    },
    {
      type: AuditLogExportDestinationType.GoogleCloudStorage,
      title: "Google Cloud Storage",
      description: "Compressed NDJSON files in a Cloud Storage bucket.",
      icon: IconProp.Cloud,
      kind: AuditLogExportDestinationKind.Files,
      docsPath: `${AUDIT_LOG_EXPORT_DOCS_PATH}#google-cloud-storage`,
      maxEntriesPerBatch: FILE_MAX_ENTRIES_PER_BATCH,
      maxBytesPerBatch: FILE_MAX_BYTES_PER_BATCH,
      configFields: [
        {
          key: "bucket",
          title: "Bucket",
          description: "The bucket the files are written to.",
          type: "text",
          required: true,
          placeholder: "my-audit-logs",
        },
        folderField,
      ],
      secretFields: [
        {
          key: "serviceAccountJson",
          title: "Service account key",
          description:
            "A service account key (JSON) with the Storage Object Creator role on the bucket. Encrypted at rest and never returned by the API.",
          type: "json",
          required: true,
          placeholder: '{ "client_email": "...", "private_key": "..." }',
        },
      ],
    },
    {
      type: AuditLogExportDestinationType.AzureBlobStorage,
      title: "Azure Blob Storage",
      description: "Compressed NDJSON files in a Blob Storage container.",
      icon: IconProp.CloudArrowUp,
      kind: AuditLogExportDestinationKind.Files,
      docsPath: `${AUDIT_LOG_EXPORT_DOCS_PATH}#azure-blob-storage`,
      maxEntriesPerBatch: FILE_MAX_ENTRIES_PER_BATCH,
      maxBytesPerBatch: FILE_MAX_BYTES_PER_BATCH,
      configFields: [
        {
          key: "accountName",
          title: "Storage account",
          description: "The storage account's name, such as myauditlogs.",
          type: "text",
          required: true,
          placeholder: "myauditlogs",
        },
        {
          key: "container",
          title: "Container",
          description: "The container the files are written to.",
          type: "text",
          required: true,
          placeholder: "audit-logs",
        },
        {
          key: "authentication",
          title: "Sign in with",
          description:
            "A SAS token can be limited to writing to this container. An access key opens the whole storage account.",
          type: "dropdown",
          required: true,
          defaultValue: AuditLogExportAzureAuthentication.SasToken,
          options: [
            {
              label: "Shared access signature (SAS) token",
              value: AuditLogExportAzureAuthentication.SasToken,
            },
            {
              label: "Access key",
              value: AuditLogExportAzureAuthentication.AccessKey,
            },
          ],
        },
        {
          key: "cloud",
          title: "Cloud",
          description: "Which Azure cloud the storage account is in.",
          type: "dropdown",
          required: false,
          defaultValue: AuditLogExportAzureCloud.Public,
          isAdvanced: true,
          options: [
            {
              label: "Azure public cloud",
              value: AuditLogExportAzureCloud.Public,
            },
            {
              label: "Azure Government (US)",
              value: AuditLogExportAzureCloud.UsGovernment,
            },
            {
              label: "Azure China",
              value: AuditLogExportAzureCloud.China,
            },
          ],
        },
        folderField,
      ],
      secretFields: [
        {
          key: "sasToken",
          title: "SAS token",
          description:
            "A SAS token with Create and Write permission on the container. Encrypted at rest and never returned by the API.",
          type: "password",
          required: true,
          placeholder: "sv=2022-11-02&ss=b&srt=co&sp=cw&...&sig=...",
          showWhen: {
            key: "authentication",
            values: [AuditLogExportAzureAuthentication.SasToken],
          },
        },
        {
          key: "accountKey",
          title: "Access key",
          description:
            "One of the storage account's access keys. Encrypted at rest and never returned by the API.",
          type: "password",
          required: true,
          showWhen: {
            key: "authentication",
            values: [AuditLogExportAzureAuthentication.AccessKey],
          },
        },
      ],
    },
    {
      type: AuditLogExportDestinationType.Webhook,
      title: "Webhook",
      description:
        "Batches of entries sent to an HTTPS endpoint, such as a log shipper or a SIEM's HTTP intake.",
      icon: IconProp.Link,
      kind: AuditLogExportDestinationKind.Stream,
      docsPath: `${AUDIT_LOG_EXPORT_DOCS_PATH}#webhook`,
      maxEntriesPerBatch: 500,
      /*
       * Half of nginx's default 1 MB request limit (client_max_body_size),
       * which sits in front of many log shippers; a 413 splits a batch anyway.
       */
      maxBytesPerBatch: 512 * 1024,
      configFields: [
        {
          key: "url",
          title: "URL",
          description: "The address OneUptime posts batches of entries to.",
          type: "url",
          required: true,
          placeholder: "https://logs.example.com/oneuptime",
        },
        {
          key: "bodyFormat",
          title: "Body format",
          description:
            "A JSON array of entries, or one entry per line (NDJSON).",
          type: "dropdown",
          required: false,
          defaultValue: AuditLogExportWebhookBodyFormat.JsonArray,
          isAdvanced: true,
          options: [
            {
              label: "JSON array",
              value: AuditLogExportWebhookBodyFormat.JsonArray,
            },
            {
              label: "NDJSON (one entry per line)",
              value: AuditLogExportWebhookBodyFormat.NdJson,
            },
          ],
        },
        {
          key: "headerName",
          title: "Header name",
          description: `The header the credential is sent in. Leave empty for ${AUDIT_LOG_EXPORT_DEFAULT_WEBHOOK_HEADER}.`,
          type: "text",
          required: false,
          placeholder: AUDIT_LOG_EXPORT_DEFAULT_WEBHOOK_HEADER,
          isAdvanced: true,
        },
      ],
      secretFields: [
        {
          key: "headerValue",
          title: "Credential",
          description:
            "Sent with every request, such as Bearer <token>. Leave empty if the endpoint needs none. Never returned by the API.",
          type: "password",
          required: false,
          placeholder: "Bearer <token>",
        },
        {
          key: "signingSecret",
          title: "Signing secret",
          description:
            "When set, each request carries X-OneUptime-Signature: sha256=<HMAC-SHA256 of the body>, so the endpoint can check it.",
          type: "password",
          required: false,
          isAdvanced: true,
        },
      ],
    },
    {
      type: AuditLogExportDestinationType.Syslog,
      title: "Syslog",
      description:
        "One RFC 5424 message per entry to a syslog receiver, over TLS or TCP.",
      icon: IconProp.Terminal,
      kind: AuditLogExportDestinationKind.Stream,
      docsPath: `${AUDIT_LOG_EXPORT_DOCS_PATH}#syslog`,
      maxEntriesPerBatch: 500,
      maxBytesPerBatch: 4 * 1024 * 1024,
      configFields: [
        {
          key: "host",
          title: "Host",
          description: "The syslog receiver's host name or IP address.",
          type: "text",
          required: true,
          placeholder: "syslog.example.com",
        },
        {
          key: "port",
          title: "Port",
          description: `The receiver's port: ${AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_PORT} for syslog over TLS, often 514 or 601 over TCP.`,
          type: "number",
          required: true,
          placeholder: String(AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_PORT),
          defaultValue: AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_PORT,
        },
        {
          key: "protocol",
          title: "Protocol",
          description:
            "TLS encrypts the audit log on the way. TCP sends it as plain text.",
          type: "dropdown",
          required: true,
          defaultValue: AuditLogExportSyslogProtocol.Tls,
          options: [
            { label: "TLS", value: AuditLogExportSyslogProtocol.Tls },
            { label: "TCP", value: AuditLogExportSyslogProtocol.Tcp },
          ],
        },
        {
          key: "framing",
          title: "Framing",
          description:
            "How messages are separated: each preceded by its length (RFC 5425), or each on a line of its own.",
          type: "dropdown",
          required: false,
          defaultValue: AuditLogExportSyslogFraming.OctetCounting,
          isAdvanced: true,
          options: [
            {
              label: "Octet counting (RFC 5425)",
              value: AuditLogExportSyslogFraming.OctetCounting,
            },
            {
              label: "One message per line",
              value: AuditLogExportSyslogFraming.NewLine,
            },
          ],
        },
        {
          key: "caCertificate",
          title: "CA certificate",
          description:
            "Only for a receiver whose certificate a private CA signed: that CA's certificate (PEM).",
          type: "text",
          required: false,
          placeholder: "-----BEGIN CERTIFICATE-----",
          isAdvanced: true,
          isMultiline: true,
          showWhen: {
            key: "protocol",
            values: [AuditLogExportSyslogProtocol.Tls],
          },
        },
      ],
      secretFields: [],
    },
  ];

export function getAuditLogExportDestinationDefinition(
  type: AuditLogExportDestinationType | string | undefined | null,
): AuditLogExportDestinationDefinition | undefined {
  return AuditLogExportDestinationCatalog.find(
    (definition: AuditLogExportDestinationDefinition): boolean => {
      return definition.type === type;
    },
  );
}

export function getAuditLogExportDestinationTitle(
  type: AuditLogExportDestinationType | string | undefined | null,
): string {
  return getAuditLogExportDestinationDefinition(type)?.title || "";
}

// A config value as the form would read it, with the field's default when it holds none.
export function readAuditLogExportConfigValue(
  config: JSONObject | undefined | null,
  field: AuditLogExportDestinationField,
): JSONValue | undefined {
  const value: JSONValue | undefined = config
    ? (config[field.key] as JSONValue | undefined)
    : undefined;

  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return field.defaultValue;
  }

  return value;
}

/*
 * Whether a field applies to this config: always, unless it names another
 * field (showWhen) whose value - or that field's default - is not one of
 * the values it waits for.
 */
export function isAuditLogExportFieldShown(data: {
  definition: AuditLogExportDestinationDefinition;
  field: AuditLogExportDestinationField;
  config: JSONObject | undefined | null;
}): boolean {
  const condition: AuditLogExportDestinationField["showWhen"] =
    data.field.showWhen;

  if (!condition) {
    return true;
  }

  const controller: AuditLogExportDestinationField | undefined =
    data.definition.configFields.find(
      (candidate: AuditLogExportDestinationField): boolean => {
        return candidate.key === condition.key;
      },
    );

  const value: JSONValue | undefined = controller
    ? readAuditLogExportConfigValue(data.config, controller)
    : data.config
      ? (data.config[condition.key] as JSONValue | undefined)
      : undefined;

  return condition.values.includes(String(value ?? ""));
}
