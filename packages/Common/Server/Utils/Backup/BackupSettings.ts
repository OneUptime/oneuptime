import { createHash } from "crypto";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import BackupDestinationType, {
  isBackupDestinationType,
} from "../../../Types/Backup/BackupDestinationType";
import {
  AUTO_S3_REGION,
  BACKUP_DEFAULT_FOLDER,
  BackupDestinationDefinition,
  BackupDestinationField,
  BackupProvider,
  BackupProviderDefinition,
  GOOGLE_CLOUD_STORAGE_S3_ENDPOINT,
  getBackupDestinationDefinition,
  getBackupProviderDefinition,
  inferS3RegionFromEndpoint,
  isBackupFieldShown,
  readBackupConfigValue,
  resolveBackupProvider,
} from "../../../Types/Backup/BackupDestinationCatalog";
import { AuditLogExportAzureAuthentication } from "../../../Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import { Service as SecurityEventConnectionService } from "../../Services/SecurityEventConnectionService";
import AuditLogExportSettingsUtil, {
  describeFolderProblem,
  isAmazonS3BucketName,
  isAzureContainerName,
  isAzureStorageAccountName,
  isGoogleCloudStorageBucketName,
  isS3CompatibleBucketName,
  isS3RegionName,
} from "../AuditLog/Export/AuditLogExportSettings";
import DataSourceEgressGuard, {
  EgressGuardOptions,
} from "../DataSource/EgressGuard";

/*
 * The destination of the instance's backups, checked the way a save checks
 * it: the catalog's shape (SecurityEventConnectionService.validateFields,
 * as every connector and audit log export is held to), then each storage's
 * own rules - the bucket, region, storage account and container names an
 * audit log export is held to (AuditLogExportSettings), a folder without
 * "." or ".." - each refused with a sentence naming the field.
 *
 * Shared by BackupSettingService (save), and the Enterprise Edition's test
 * route and runner (the decrypted settings they connect with). Nothing
 * here opens a connection but the egress check.
 */

export interface BackupDestinationSettings {
  type: BackupDestinationType;
  provider: BackupProvider;
  config: JSONObject;
  secrets: JSONObject;
}

function hasControlOrSpace(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code <= 32 || code === 127) {
      return true;
    }
  }

  return false;
}

// The longest secret OneUptime keeps for a destination: far above any real key.
export const BACKUP_MAX_SECRET_LENGTH: number = 4096;

export default class BackupSettingsUtil {
  public static getDefinitionOrThrow(type: unknown): BackupDestinationDefinition {
    const definition: BackupDestinationDefinition | undefined =
      isBackupDestinationType(type)
        ? getBackupDestinationDefinition(type)
        : undefined;

    if (!definition) {
      throw new BadDataException(
        "Destination must be one of: Amazon S3, S3-compatible storage, Google Cloud Storage or Azure Blob Storage.",
      );
    }

    return definition;
  }

  /*
   * The provider a save keeps: the one named, when it is one of this
   * storage's; otherwise the storage's own (S3-compatible storage's is
   * Other S3-compatible storage).
   */
  public static getProvider(data: {
    type: BackupDestinationType;
    provider: unknown;
  }): BackupProvider {
    const named: BackupProviderDefinition | undefined =
      typeof data.provider === "string"
        ? getBackupProviderDefinition(data.provider)
        : undefined;

    if (data.provider && named && named.type !== data.type) {
      throw new BadDataException(
        `${named.title} is not ${this.getDefinitionOrThrow(data.type).title}. Choose the destination again.`,
      );
    }

    return resolveBackupProvider({
      type: data.type,
      provider: typeof data.provider === "string" ? data.provider : null,
    })!.provider;
  }

  /*
   * The catalog's shape, then the storage's own rules, on the settings as
   * a save keeps them: what it returns is what is stored and connected
   * with. With requireRequiredSecrets false the secrets may be partial (an
   * update that keeps the stored ones is checked once merged, with it true).
   */
  public static validate(data: {
    type: unknown;
    provider: unknown;
    config: JSONObject;
    secrets: JSONObject;
    requireRequiredSecrets: boolean;
  }): BackupDestinationSettings {
    const definition: BackupDestinationDefinition = this.getDefinitionOrThrow(
      data.type,
    );

    const normalized: { config: JSONObject; secrets: JSONObject } =
      AuditLogExportSettingsUtil.normalize({
        definition,
        config: data.config,
        secrets: data.secrets,
      });

    const shown: (
      fields: Array<BackupDestinationField>,
    ) => Array<BackupDestinationField> = (
      fields: Array<BackupDestinationField>,
    ): Array<BackupDestinationField> => {
      return fields.filter((field: BackupDestinationField): boolean => {
        return isBackupFieldShown({
          definition,
          field,
          config: normalized.config,
        });
      });
    };

    const configWithDefaults: JSONObject = { ...normalized.config };

    for (const field of definition.configFields) {
      if (
        configWithDefaults[field.key] === undefined &&
        field.defaultValue !== undefined
      ) {
        configWithDefaults[field.key] = field.defaultValue;
      }
    }

    SecurityEventConnectionService.validateFields({
      definition,
      fields: shown(definition.configFields),
      values: configWithDefaults,
      label: "Configuration",
      requireRequiredFields: true,
    });

    SecurityEventConnectionService.validateFields({
      definition,
      fields: shown(definition.secretFields),
      values: normalized.secrets,
      label: "Credentials",
      requireRequiredFields: data.requireRequiredSecrets,
    });

    const settings: BackupDestinationSettings = {
      type: definition.type,
      provider: this.getProvider({
        type: definition.type,
        provider: data.provider,
      }),
      config: normalized.config,
      secrets: normalized.secrets,
    };

    this.validateDestinationRules(settings);

    return settings;
  }

  // A config setting as text, with the field's default when it has none.
  public static readConfigText(
    settings: Pick<BackupDestinationSettings, "type" | "config">,
    key: string,
  ): string {
    const definition: BackupDestinationDefinition = this.getDefinitionOrThrow(
      settings.type,
    );
    const field: BackupDestinationField | undefined =
      definition.configFields.find(
        (candidate: BackupDestinationField): boolean => {
          return candidate.key === key;
        },
      );
    const value: JSONValue | undefined = field
      ? readBackupConfigValue(settings.config, field)
      : settings.config[key];

    if (value === undefined || value === null) {
      return "";
    }

    return typeof value === "string" ? value.trim() : String(value);
  }

  public static readSecretText(
    settings: Pick<BackupDestinationSettings, "secrets">,
    key: string,
  ): string {
    const value: JSONValue | undefined = settings.secrets[key];

    return typeof value === "string" ? value.trim() : "";
  }

  /*
   * The folder backups go to, as an object key starts: the setting without
   * slashes at its start and with one at its end, or the default folder.
   */
  public static getFolder(
    settings: Pick<BackupDestinationSettings, "config">,
  ): string {
    const raw: JSONValue | undefined = settings.config["folder"];
    let folder: string = typeof raw === "string" ? raw.trim() : "";

    while (folder.startsWith("/")) {
      folder = folder.slice(1);
    }

    while (folder.endsWith("//")) {
      folder = folder.slice(0, -1);
    }

    if (!folder) {
      return BACKUP_DEFAULT_FOLDER;
    }

    return folder.endsWith("/") ? folder : `${folder}/`;
  }

  /*
   * The S3 endpoint a destination of the S3 API is reached at: Amazon S3's
   * own (null: the client addresses the bucket's host), the storage's
   * endpoint, or Cloud Storage's XML API.
   */
  public static getS3Endpoint(
    settings: Pick<BackupDestinationSettings, "type" | "config">,
  ): string | null {
    switch (settings.type) {
      case BackupDestinationType.S3Compatible:
        return this.readConfigText(settings, "endpoint");
      case BackupDestinationType.GoogleCloudStorage:
        return GOOGLE_CLOUD_STORAGE_S3_ENDPOINT;
      default:
        return null;
    }
  }

  // The region an S3 signature names for this destination.
  public static getS3Region(
    settings: Pick<BackupDestinationSettings, "type" | "config">,
  ): string {
    switch (settings.type) {
      case BackupDestinationType.AmazonS3:
        return this.readConfigText(settings, "region");
      case BackupDestinationType.GoogleCloudStorage:
        return AUTO_S3_REGION;
      case BackupDestinationType.S3Compatible:
        return (
          this.readConfigText(settings, "region") ||
          inferS3RegionFromEndpoint(this.readConfigText(settings, "endpoint"))
        );
      default:
        return "";
    }
  }

  public static usesAzureSasToken(
    settings: Pick<BackupDestinationSettings, "type" | "config">,
  ): boolean {
    return (
      this.readConfigText(settings, "authentication") !==
      AuditLogExportAzureAuthentication.AccessKey
    );
  }

  /*
   * The egress policy for the destination: set up by a master admin, who
   * runs the network it points into, so it may reach private addresses
   * (a MinIO beside OneUptime) even where tenants may not. Loopback,
   * link-local and metadata addresses stay refused for everyone.
   */
  public static getEgressOptions(targetLabel: string): EgressGuardOptions {
    return { targetLabel, blockPrivateAddresses: false };
  }

  /*
   * The address a person typed (an S3-compatible endpoint) goes through the
   * egress policy every outbound connector uses, at save time, so a blocked
   * address is a form error rather than a backup that fails every night.
   */
  public static async assertTargetsAllowed(
    settings: BackupDestinationSettings,
  ): Promise<void> {
    if (settings.type !== BackupDestinationType.S3Compatible) {
      return;
    }

    await DataSourceEgressGuard.assertUrlAllowed(
      this.readConfigText(settings, "endpoint"),
      this.getEgressOptions("Backup destination endpoint"),
    );
  }

  /*
   * Where a destination keeps its backups, in words a person reads:
   * s3://bucket/folder/, an S3-compatible bucket on its endpoint's host,
   * gs://bucket/folder/, or https://account.blob.../container/folder/.
   * Never a credential.
   */
  public static describeLocation(
    settings: Pick<BackupDestinationSettings, "type" | "config">,
  ): string {
    const folder: string = this.getFolder(settings);

    switch (settings.type) {
      case BackupDestinationType.AmazonS3:
        return `s3://${this.readConfigText(settings, "bucket")}/${folder}`;
      case BackupDestinationType.S3Compatible: {
        let host: string = this.readConfigText(settings, "endpoint");

        try {
          host = new URL(host).host || host;
        } catch {
          // As typed.
        }

        return `${host}/${this.readConfigText(settings, "bucket")}/${folder}`;
      }
      case BackupDestinationType.GoogleCloudStorage:
        return `gs://${this.readConfigText(settings, "bucket")}/${folder}`;
      case BackupDestinationType.AzureBlobStorage:
        return `${this.readConfigText(settings, "accountName")}/${this.readConfigText(settings, "container")}/${folder}`;
      default:
        return folder;
    }
  }

  /*
   * Whether two settings point at the same place: the storage, its
   * address, the bucket or container and the folder - never a credential,
   * so a rotated key is still the same destination. Kept on every run, so
   * a backup made before the destination changed reads as being at a
   * previous destination.
   */
  public static getDestinationFingerprint(
    settings: Pick<BackupDestinationSettings, "type" | "config">,
  ): string {
    const parts: Array<string> = [settings.type, this.getFolder(settings)];

    switch (settings.type) {
      case BackupDestinationType.AmazonS3:
      case BackupDestinationType.GoogleCloudStorage:
        parts.push(this.readConfigText(settings, "bucket"));
        break;
      case BackupDestinationType.S3Compatible: {
        let endpoint: string = this.readConfigText(settings, "endpoint");

        try {
          const url: URL = new URL(endpoint);
          endpoint = `${url.protocol}//${url.host}${url.pathname}`.toLowerCase();
        } catch {
          endpoint = endpoint.toLowerCase();
        }

        parts.push(endpoint, this.readConfigText(settings, "bucket"));
        break;
      }
      case BackupDestinationType.AzureBlobStorage:
        parts.push(
          this.readConfigText(settings, "cloud"),
          this.readConfigText(settings, "accountName"),
          this.readConfigText(settings, "container"),
        );
        break;
    }

    return createHash("sha256").update(parts.join("\n")).digest("hex");
  }

  private static validateDestinationRules(
    settings: BackupDestinationSettings,
  ): void {
    const read: (key: string) => string = (key: string): string => {
      return this.readConfigText(settings, key);
    };

    const folderProblem: string | null = describeFolderProblem(read("folder"));

    if (folderProblem) {
      throw new BadDataException(folderProblem);
    }

    for (const key of Object.keys(settings.secrets)) {
      const value: string = this.readSecretText(settings, key);

      if (value.length > BACKUP_MAX_SECRET_LENGTH) {
        throw new BadDataException(
          "A credential is longer than any key a storage gives out. Paste it again.",
        );
      }
    }

    switch (settings.type) {
      case BackupDestinationType.AmazonS3:
      case BackupDestinationType.S3Compatible:
      case BackupDestinationType.GoogleCloudStorage: {
        const bucket: string = read("bucket");

        if (settings.type === BackupDestinationType.AmazonS3) {
          if (!isAmazonS3BucketName(bucket)) {
            throw new BadDataException(
              "Bucket must be an S3 bucket name: 3 to 63 lowercase letters, digits, dots and hyphens, starting and ending with a letter or digit.",
            );
          }

          if (!isS3RegionName(read("region"))) {
            throw new BadDataException(
              "Region must be a region name such as us-east-1: letters, digits and hyphens.",
            );
          }
        } else if (settings.type === BackupDestinationType.GoogleCloudStorage) {
          if (!isGoogleCloudStorageBucketName(bucket)) {
            throw new BadDataException(
              "Bucket must be a Cloud Storage bucket name: 3 to 63 lowercase letters, digits, hyphens, underscores and dots, starting and ending with a letter or digit.",
            );
          }
        } else {
          if (!isS3CompatibleBucketName(bucket)) {
            throw new BadDataException(
              "Bucket must be a bucket name, without slashes or spaces.",
            );
          }

          const region: string = read("region");

          if (region && !isS3RegionName(region)) {
            throw new BadDataException(
              "Region must be a region name such as us-east-1, or empty.",
            );
          }

          const endpoint: URL = new URL(read("endpoint"));

          // validateFields has refused a user name or password in it.
          if (endpoint.search || endpoint.hash) {
            throw new BadDataException(
              "Endpoint must be the storage's address without a query or a fragment, such as https://minio.example.com:9000.",
            );
          }
        }

        const accessKeyId: string = read("accessKeyId");

        if (accessKeyId.length > 128 || hasControlOrSpace(accessKeyId)) {
          throw new BadDataException(
            "Access key ID must be the key's ID, without spaces.",
          );
        }

        const secret: string = this.readSecretText(settings, "secretAccessKey");

        if (secret && hasControlOrSpace(secret)) {
          throw new BadDataException(
            "Secret access key cannot hold spaces or line breaks.",
          );
        }

        return;
      }

      case BackupDestinationType.AzureBlobStorage: {
        if (!isAzureStorageAccountName(read("accountName"))) {
          throw new BadDataException(
            "Storage account must be the account's name: 3 to 24 lowercase letters and digits.",
          );
        }

        if (!isAzureContainerName(read("container"))) {
          throw new BadDataException(
            "Container must be a container name: 3 to 63 lowercase letters, digits and hyphens, starting and ending with a letter or digit.",
          );
        }

        if (this.usesAzureSasToken(settings)) {
          const token: string = this.readSecretText(settings, "sasToken");

          if (token && !AuditLogExportSettingsUtil.isSasToken(token)) {
            throw new BadDataException(
              "SAS token must be a shared access signature, such as sv=...&sp=racwdl&...&sig=... - copy it from the storage account's Shared access signature page.",
            );
          }
        } else {
          const key: string = this.readSecretText(settings, "accountKey");

          if (key && !AuditLogExportSettingsUtil.isBase64(key)) {
            throw new BadDataException(
              "Access key must be one of the storage account's access keys, as the portal shows it.",
            );
          }
        }

        return;
      }
    }
  }
}
