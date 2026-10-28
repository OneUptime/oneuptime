import IconProp from "../Icon/IconProp";
import { JSONObject, JSONValue } from "../JSON";
import ProviderLogo from "../ProviderLogo/ProviderLogo";
import {
  AuditLogExportAzureAuthentication,
  AuditLogExportAzureCloud,
  AuditLogExportDestinationField,
  isAuditLogExportFieldShown,
  readAuditLogExportConfigValue,
} from "../AuditLog/Export/AuditLogExportDestinationCatalog";
import BackupDestinationType from "./BackupDestinationType";

/*
 * Everything the product needs to know about where backups can go that is
 * not code: the four kinds of storage (what each asks for, which of it is a
 * secret) and the recommended destinations the form offers - the products
 * people know (Amazon S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO,
 * Google Cloud Storage, Azure Blob Storage), each one of those storages.
 * Shared by the Enterprise UI (the form, the summary), the server
 * (validation on save, BackupSettingService) and the docs tests (the guide
 * names every field).
 *
 * A field has the audit log export's shape (AuditLogExportDestinationField:
 * a connector field with showWhen), so a backup destination is checked on
 * save by the same rules, and the S3 and Azure settings read the same in
 * both places.
 */

export type BackupDestinationField = AuditLogExportDestinationField;

export const BACKUP_DOCS_PATH: string = "/docs/installation/backups";

// Where backups go inside the bucket or container when no folder is named.
export const BACKUP_DEFAULT_FOLDER: string = "oneuptime/backups/";

// The S3 region a signature names when the storage expects none in particular.
export const BACKUP_DEFAULT_S3_REGION: string = "us-east-1";

// Cloud Storage's S3-compatible XML API, which an HMAC key signs for.
export const GOOGLE_CLOUD_STORAGE_S3_ENDPOINT: string =
  "https://storage.googleapis.com";

// The region Cloud Storage's XML API (and Cloudflare R2) take in a signature.
export const AUTO_S3_REGION: string = "auto";

export interface BackupDestinationDefinition {
  type: BackupDestinationType;
  title: string;
  configFields: Array<BackupDestinationField>;
  secretFields: Array<BackupDestinationField>;
}

/*
 * A recommended destination: a product someone already uses, and the
 * storage it is. The card picks both; the provider only changes what the
 * form suggests (an endpoint's shape, a region), never how OneUptime talks
 * to the storage.
 */
export enum BackupProvider {
  AmazonS3 = "amazon-s3",
  CloudflareR2 = "cloudflare-r2",
  BackblazeB2 = "backblaze-b2",
  Wasabi = "wasabi",
  MinIO = "minio",
  GoogleCloudStorage = "google-cloud-storage",
  AzureBlobStorage = "azure-blob-storage",
  OtherS3Compatible = "other-s3-compatible",
}

export interface BackupProviderDefinition {
  provider: BackupProvider;
  type: BackupDestinationType;
  title: string;
  // One line under the title on the card: what tells it from the others.
  description: string;
  icon: IconProp;
  /*
   * The storage's official logo, drawn in the icon's place wherever it is
   * named. None for "Other S3-compatible storage", which keeps its icon.
   */
  logo?: ProviderLogo | undefined;
  // The setup guide's heading for it.
  docsPath: string;
  // An S3-compatible provider's endpoint, as its console shows it.
  endpointPlaceholder?: string | undefined;
  endpointDescription?: string | undefined;
}

const folderField: BackupDestinationField = {
  key: "folder",
  title: "Folder",
  description: `Where backups go inside the bucket. Leave empty for ${BACKUP_DEFAULT_FOLDER}.`,
  type: "text",
  required: false,
  placeholder: BACKUP_DEFAULT_FOLDER,
  isAdvanced: true,
};

const bucketField: BackupDestinationField = {
  key: "bucket",
  title: "Bucket",
  description: "The bucket backups are written to. Keep it for backups only.",
  type: "text",
  required: true,
  placeholder: "oneuptime-backups",
};

const accessKeyIdField: BackupDestinationField = {
  key: "accessKeyId",
  title: "Access key ID",
  description:
    "An access key that may read, write, list and delete objects in the bucket.",
  type: "text",
  required: true,
};

const secretAccessKeyField: BackupDestinationField = {
  key: "secretAccessKey",
  title: "Secret access key",
  description:
    "The access key's secret. Encrypted at rest and never returned by the API.",
  type: "password",
  required: true,
};

export const BackupDestinationCatalog: Array<BackupDestinationDefinition> = [
  {
    type: BackupDestinationType.AmazonS3,
    title: "Amazon S3",
    configFields: [
      bucketField,
      {
        key: "region",
        title: "Region",
        description: "The bucket's region, such as us-east-1.",
        type: "text",
        required: true,
        placeholder: BACKUP_DEFAULT_S3_REGION,
        defaultValue: BACKUP_DEFAULT_S3_REGION,
      },
      accessKeyIdField,
      folderField,
    ],
    secretFields: [secretAccessKeyField],
  },
  {
    type: BackupDestinationType.S3Compatible,
    title: "S3-compatible storage",
    configFields: [
      {
        key: "endpoint",
        title: "Endpoint",
        description:
          "The storage's S3 address, such as https://minio.example.com:9000.",
        type: "url",
        required: true,
        placeholder: "https://s3.example.com",
      },
      bucketField,
      accessKeyIdField,
      {
        key: "region",
        title: "Region",
        description:
          "Only if the storage asks for one. Leave empty to read it from the endpoint, or us-east-1.",
        type: "text",
        required: false,
        placeholder: BACKUP_DEFAULT_S3_REGION,
        isAdvanced: true,
      },
      folderField,
    ],
    secretFields: [secretAccessKeyField],
  },
  {
    type: BackupDestinationType.GoogleCloudStorage,
    title: "Google Cloud Storage",
    configFields: [
      bucketField,
      {
        key: "accessKeyId",
        title: "HMAC access key",
        description:
          "An HMAC key of a service account with Storage Object Admin on the bucket (Cloud Storage > Settings > Interoperability).",
        type: "text",
        required: true,
        placeholder: "GOOG1E...",
      },
      folderField,
    ],
    secretFields: [
      {
        key: "secretAccessKey",
        title: "HMAC secret",
        description:
          "The HMAC key's secret. Encrypted at rest and never returned by the API.",
        type: "password",
        required: true,
      },
    ],
  },
  {
    type: BackupDestinationType.AzureBlobStorage,
    title: "Azure Blob Storage",
    configFields: [
      {
        key: "accountName",
        title: "Storage account",
        description: "The storage account's name, such as oneuptimebackups.",
        type: "text",
        required: true,
        placeholder: "oneuptimebackups",
      },
      {
        key: "container",
        title: "Container",
        description:
          "The container backups are written to. Keep it for backups only.",
        type: "text",
        required: true,
        placeholder: "oneuptime-backups",
      },
      {
        key: "authentication",
        title: "Sign in with",
        description:
          "A SAS token can be limited to this container. An access key opens the whole storage account.",
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
          "A SAS token with Read, Add, Create, Write, Delete and List on the container. Never returned by the API.",
        type: "password",
        required: true,
        placeholder: "sv=2022-11-02&ss=b&srt=co&sp=racwdl&...&sig=...",
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
];

/*
 * The recommended destinations, in the order the form offers them: the
 * cloud most people already have, the cheap S3-compatible stores, storage
 * you run yourself, then the other two clouds, and anything else with an
 * S3 API last.
 */
export const BackupProviderCatalog: Array<BackupProviderDefinition> = [
  {
    provider: BackupProvider.AmazonS3,
    type: BackupDestinationType.AmazonS3,
    title: "Amazon S3",
    description: "A bucket in your AWS account.",
    icon: IconProp.Archive,
    logo: ProviderLogo.AmazonS3,
    docsPath: `${BACKUP_DOCS_PATH}#amazon-s3`,
  },
  {
    provider: BackupProvider.CloudflareR2,
    type: BackupDestinationType.S3Compatible,
    title: "Cloudflare R2",
    description: "S3-compatible, with no fees for reading backups back.",
    icon: IconProp.Cloud,
    logo: ProviderLogo.Cloudflare,
    docsPath: `${BACKUP_DOCS_PATH}#cloudflare-r2`,
    endpointPlaceholder: "https://<account-id>.r2.cloudflarestorage.com",
    endpointDescription:
      "Your account's S3 API address, from R2 > the bucket > Settings.",
  },
  {
    provider: BackupProvider.BackblazeB2,
    type: BackupDestinationType.S3Compatible,
    title: "Backblaze B2",
    description: "Low-cost S3-compatible storage.",
    icon: IconProp.ServerStack,
    logo: ProviderLogo.Backblaze,
    docsPath: `${BACKUP_DOCS_PATH}#backblaze-b2`,
    endpointPlaceholder: "https://s3.us-west-004.backblazeb2.com",
    endpointDescription: "The bucket's S3 endpoint, shown on its Buckets page.",
  },
  {
    provider: BackupProvider.Wasabi,
    type: BackupDestinationType.S3Compatible,
    title: "Wasabi",
    description: "S3-compatible storage with no egress fees.",
    icon: IconProp.InboxStack,
    logo: ProviderLogo.Wasabi,
    docsPath: `${BACKUP_DOCS_PATH}#wasabi`,
    endpointPlaceholder: "https://s3.us-east-1.wasabisys.com",
    endpointDescription: "The service URL of the bucket's region.",
  },
  {
    provider: BackupProvider.MinIO,
    type: BackupDestinationType.S3Compatible,
    title: "MinIO",
    description: "S3-compatible storage you run yourself.",
    icon: IconProp.Server,
    logo: ProviderLogo.MinIO,
    docsPath: `${BACKUP_DOCS_PATH}#minio`,
    endpointPlaceholder: "https://minio.example.com:9000",
    endpointDescription:
      "Your MinIO server's S3 API address. OneUptime and ClickHouse must both reach it.",
  },
  {
    provider: BackupProvider.GoogleCloudStorage,
    type: BackupDestinationType.GoogleCloudStorage,
    title: "Google Cloud Storage",
    description: "A bucket in your Google Cloud project.",
    icon: IconProp.CloudArrowUp,
    logo: ProviderLogo.GoogleCloudStorage,
    docsPath: `${BACKUP_DOCS_PATH}#google-cloud-storage`,
  },
  {
    provider: BackupProvider.AzureBlobStorage,
    type: BackupDestinationType.AzureBlobStorage,
    title: "Azure Blob Storage",
    description: "A container in your Azure storage account.",
    icon: IconProp.CloudArrowDown,
    logo: ProviderLogo.AzureBlobStorage,
    docsPath: `${BACKUP_DOCS_PATH}#azure-blob-storage`,
  },
  {
    provider: BackupProvider.OtherS3Compatible,
    type: BackupDestinationType.S3Compatible,
    title: "Other S3-compatible storage",
    description:
      "Ceph, DigitalOcean Spaces, Hetzner and any storage with an S3 API.",
    icon: IconProp.Database,
    docsPath: `${BACKUP_DOCS_PATH}#other-s3-compatible-storage`,
    endpointPlaceholder: "https://s3.example.com",
  },
];

export function getBackupDestinationDefinition(
  type: BackupDestinationType | string | undefined | null,
): BackupDestinationDefinition | undefined {
  return BackupDestinationCatalog.find(
    (definition: BackupDestinationDefinition): boolean => {
      return definition.type === type;
    },
  );
}

export function getBackupProviderDefinition(
  provider: BackupProvider | string | undefined | null,
): BackupProviderDefinition | undefined {
  return BackupProviderCatalog.find(
    (definition: BackupProviderDefinition): boolean => {
      return definition.provider === provider;
    },
  );
}

/*
 * The provider a setting names, or - for settings saved without one, or
 * naming a provider of another storage - the first provider of its storage
 * (S3-compatible storage reads as Cloudflare R2's sibling "Other").
 */
export function resolveBackupProvider(data: {
  type: BackupDestinationType | string | undefined | null;
  provider: BackupProvider | string | undefined | null;
}): BackupProviderDefinition | undefined {
  const named: BackupProviderDefinition | undefined =
    getBackupProviderDefinition(data.provider);

  if (named && named.type === data.type) {
    return named;
  }

  if (data.type === BackupDestinationType.S3Compatible) {
    return getBackupProviderDefinition(BackupProvider.OtherS3Compatible);
  }

  return BackupProviderCatalog.find(
    (definition: BackupProviderDefinition): boolean => {
      return definition.type === data.type;
    },
  );
}

// What a destination is called: the provider's name when it has one.
export function getBackupDestinationTitle(data: {
  type: BackupDestinationType | string | undefined | null;
  provider?: BackupProvider | string | undefined | null;
}): string {
  return (
    resolveBackupProvider({
      type: data.type,
      provider: data.provider || null,
    })?.title ||
    getBackupDestinationDefinition(data.type)?.title ||
    ""
  );
}

// A config value as the form would read it, with the field's default when it holds none.
export function readBackupConfigValue(
  config: JSONObject | undefined | null,
  field: BackupDestinationField,
): JSONValue | undefined {
  return readAuditLogExportConfigValue(config, field);
}

// Whether a field applies to this config (showWhen), as the audit log export decides it.
export function isBackupFieldShown(data: {
  definition: BackupDestinationDefinition;
  field: BackupDestinationField;
  config: JSONObject | undefined | null;
}): boolean {
  return isAuditLogExportFieldShown(data);
}

/*
 * The region a signature for this S3-compatible endpoint names when the
 * setting names none, read from the endpoint's host the way each provider
 * spells it:
 *
 *   <account>.r2.cloudflarestorage.com      auto
 *   s3.<region>.backblazeb2.com             <region>
 *   s3.<region>.wasabisys.com               <region> (s3.wasabisys.com: us-east-1)
 *   <region>.digitaloceanspaces.com         <region>
 *   s3.<region>.amazonaws.com               <region>
 *
 * Anything else signs for us-east-1, which MinIO, Ceph and most others take.
 */
export function inferS3RegionFromEndpoint(endpoint: string): string {
  let host: string = "";

  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return BACKUP_DEFAULT_S3_REGION;
  }

  const labels: Array<string> = host.split(".");

  const endsWith: (suffix: string) => boolean = (suffix: string): boolean => {
    return host === suffix || host.endsWith(`.${suffix}`);
  };

  if (endsWith("r2.cloudflarestorage.com")) {
    return AUTO_S3_REGION;
  }

  if (
    (endsWith("backblazeb2.com") ||
      endsWith("wasabisys.com") ||
      endsWith("amazonaws.com")) &&
    labels[0] === "s3" &&
    labels.length >= 4 &&
    labels[1]
  ) {
    return labels[1];
  }

  if (endsWith("digitaloceanspaces.com") && labels.length === 3 && labels[0]) {
    return labels[0];
  }

  return BACKUP_DEFAULT_S3_REGION;
}
