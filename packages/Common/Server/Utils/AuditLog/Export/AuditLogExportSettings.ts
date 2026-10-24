import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import AuditLogExportDestinationType, {
  isAuditLogExportDestinationType,
} from "../../../../Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AUDIT_LOG_EXPORT_DEFAULT_FOLDER,
  AuditLogExportAzureAuthentication,
  AuditLogExportDestinationDefinition,
  AuditLogExportDestinationField,
  AuditLogExportSyslogProtocol,
  getAuditLogExportDestinationDefinition,
  isAuditLogExportFieldShown,
  readAuditLogExportConfigValue,
} from "../../../../Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import { Service as SecurityEventConnectionService } from "../../../Services/SecurityEventConnectionService";
import DataSourceEgressGuard, {
  EgressGuardOptions,
} from "../../DataSource/EgressGuard";
import GoogleSecOpsClient from "../../SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";

/*
 * The settings of one audit log export, checked the way a save checks them:
 * the catalog's shape first (SecurityEventConnectionService.validateFields,
 * the rules every connector and SIEM destination is held to), then each
 * destination's own rules - a bucket name S3 would refuse, a storage account
 * name Azure would refuse, a syslog port out of range - each refused with a
 * sentence naming the field and what it takes, so a mistake is a form error
 * and not a delivery that fails on every run.
 *
 * Shared by the service (create, update), the Enterprise Edition's test
 * route (settings never saved) and its exporter (the decrypted settings it
 * sends with). Kept free of any client: nothing here opens a connection but
 * the egress check.
 */

export interface AuditLogExportSettings {
  type: AuditLogExportDestinationType;
  config: JSONObject;
  secrets: JSONObject;
}

// The longest folder a file destination takes (the object key has room for the file name after it).
export const AUDIT_LOG_EXPORT_MAX_FOLDER_LENGTH: number = 512;

// Every character a header name may hold (RFC 9110's token).
const HEADER_NAME_PUNCTUATION: string = "!#$%&'*+-.^_`|~";

const SIGNING_SECRET_MIN_LENGTH: number = 8;

function isLowercaseLetterOrDigit(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "0" && char <= "9");
}

function isLetterOrDigit(char: string): boolean {
  return isLowercaseLetterOrDigit(char) || (char >= "A" && char <= "Z");
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

function hasControlCharacter(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 32 || code === 127) {
      return true;
    }
  }

  return false;
}

/*
 * Amazon S3's bucket names: 3 to 63 lowercase letters, digits, dots and
 * hyphens, from and to a letter or digit, never two dots in a row.
 */
export function isAmazonS3BucketName(value: string): boolean {
  if (value.length < 3 || value.length > 63) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const char: string = value.charAt(index);
    const isEdge: boolean = index === 0 || index === value.length - 1;

    if (isEdge && !isLowercaseLetterOrDigit(char)) {
      return false;
    }

    if (!isLowercaseLetterOrDigit(char) && char !== "." && char !== "-") {
      return false;
    }

    if (char === "." && value.charAt(index + 1) === ".") {
      return false;
    }
  }

  return true;
}

/*
 * A bucket on other S3-compatible storage: rules differ (MinIO and Ceph take
 * upper-case and underscores in older buckets), so only what can never be a
 * bucket in a path is refused: an empty name, a slash, a space.
 */
export function isS3CompatibleBucketName(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 255 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !hasControlOrSpace(value)
  );
}

// An S3 region as a signature names it: letters, digits, hyphens and underscores.
export function isS3RegionName(value: string): boolean {
  if (value.length < 1 || value.length > 50) {
    return false;
  }

  for (const char of value) {
    if (!isLetterOrDigit(char) && char !== "-" && char !== "_") {
      return false;
    }
  }

  return true;
}

/*
 * Google Cloud Storage's bucket names: 3 to 63 lowercase letters, digits,
 * hyphens, underscores and dots (up to 222 with dots), from and to a letter
 * or digit.
 */
export function isGoogleCloudStorageBucketName(value: string): boolean {
  const maxLength: number = value.includes(".") ? 222 : 63;

  if (value.length < 3 || value.length > maxLength) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const char: string = value.charAt(index);
    const isEdge: boolean = index === 0 || index === value.length - 1;

    if (isEdge && !isLowercaseLetterOrDigit(char)) {
      return false;
    }

    if (
      !isLowercaseLetterOrDigit(char) &&
      char !== "-" &&
      char !== "_" &&
      char !== "."
    ) {
      return false;
    }
  }

  return true;
}

// Azure's storage account names: 3 to 24 lowercase letters and digits.
export function isAzureStorageAccountName(value: string): boolean {
  if (value.length < 3 || value.length > 24) {
    return false;
  }

  for (const char of value) {
    if (!isLowercaseLetterOrDigit(char)) {
      return false;
    }
  }

  return true;
}

/*
 * Azure's container names: 3 to 63 lowercase letters, digits and hyphens,
 * from and to a letter or digit, never two hyphens in a row.
 */
export function isAzureContainerName(value: string): boolean {
  if (value.length < 3 || value.length > 63) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const char: string = value.charAt(index);
    const isEdge: boolean = index === 0 || index === value.length - 1;

    if (isEdge && !isLowercaseLetterOrDigit(char)) {
      return false;
    }

    if (!isLowercaseLetterOrDigit(char) && char !== "-") {
      return false;
    }

    if (char === "-" && value.charAt(index + 1) === "-") {
      return false;
    }
  }

  return true;
}

// A header name: one RFC 9110 token, no longer than 100 characters.
export function isHttpHeaderName(value: string): boolean {
  if (value.length < 1 || value.length > 100) {
    return false;
  }

  for (const char of value) {
    if (!isLetterOrDigit(char) && !HEADER_NAME_PUNCTUATION.includes(char)) {
      return false;
    }
  }

  return true;
}

/*
 * A host a syslog receiver answers at: a host name or an IP address, with
 * no scheme, no port and no path - those have fields of their own.
 */
export function isSyslogHost(value: string): boolean {
  if (value.length < 1 || value.length > 253 || hasControlOrSpace(value)) {
    return false;
  }

  if (value.includes("/") || value.includes("@") || value.includes("\\")) {
    return false;
  }

  // An IPv6 address holds colons; a host name with a port does not count.
  const colonCount: number = value.split(":").length - 1;

  return colonCount === 0 || colonCount >= 2;
}

/*
 * A folder inside a bucket, as typed: at most 512 characters, no control
 * characters, no backslashes, and no "." or ".." part, which some storage
 * would read as a path of its own.
 */
export function describeFolderProblem(value: string): string | null {
  if (value.length > AUDIT_LOG_EXPORT_MAX_FOLDER_LENGTH) {
    return `Folder can be at most ${AUDIT_LOG_EXPORT_MAX_FOLDER_LENGTH} characters long.`;
  }

  if (hasControlCharacter(value) || value.includes("\\")) {
    return "Folder cannot hold a backslash or a control character.";
  }

  for (const part of value.split("/")) {
    if (part === "." || part === "..") {
      return 'Folder cannot hold a "." or ".." part.';
    }
  }

  return null;
}

/*
 * The folder files go to, as the object key starts: the setting without
 * slashes at its start and with one at its end, or the default folder.
 */
export function getAuditLogExportFolder(config: JSONObject): string {
  const raw: JSONValue | undefined = config["folder"];
  let folder: string = typeof raw === "string" ? raw.trim() : "";

  while (folder.startsWith("/")) {
    folder = folder.slice(1);
  }

  while (folder.endsWith("//")) {
    folder = folder.slice(0, -1);
  }

  if (!folder) {
    return AUDIT_LOG_EXPORT_DEFAULT_FOLDER;
  }

  return folder.endsWith("/") ? folder : `${folder}/`;
}

export default class AuditLogExportSettingsUtil {
  public static getDefinitionOrThrow(
    type: unknown,
  ): AuditLogExportDestinationDefinition {
    const definition: AuditLogExportDestinationDefinition | undefined =
      isAuditLogExportDestinationType(type)
        ? getAuditLogExportDestinationDefinition(type)
        : undefined;

    if (!definition) {
      throw new BadDataException(
        "Destination must be one of: Amazon S3, S3-compatible storage, Google Cloud Storage, Azure Blob Storage, Webhook or Syslog.",
      );
    }

    return definition;
  }

  /*
   * What a save keeps: only the fields that apply to this config (an Azure
   * export signed in with a SAS token keeps no access key), with text
   * trimmed. A value left over from a choice no longer made is dropped
   * rather than refused, so switching Sign in with from one to the other
   * just works.
   */
  public static normalize(data: {
    definition: AuditLogExportDestinationDefinition;
    config: JSONObject;
    secrets: JSONObject;
  }): { config: JSONObject; secrets: JSONObject } {
    const keep: (
      fields: Array<AuditLogExportDestinationField>,
      values: JSONObject,
      config: JSONObject,
    ) => JSONObject = (
      fields: Array<AuditLogExportDestinationField>,
      values: JSONObject,
      config: JSONObject,
    ): JSONObject => {
      const kept: JSONObject = {};

      for (const key of Object.keys(values)) {
        const field: AuditLogExportDestinationField | undefined = fields.find(
          (candidate: AuditLogExportDestinationField): boolean => {
            return candidate.key === key;
          },
        );

        const value: JSONValue | undefined = values[key];

        if (
          field &&
          !isAuditLogExportFieldShown({
            definition: data.definition,
            field,
            config,
          })
        ) {
          continue;
        }

        if (value === undefined || value === null) {
          continue;
        }

        if (typeof value === "string") {
          const trimmed: string = value.trim();

          if (!trimmed) {
            continue;
          }

          kept[key] = trimmed;
          continue;
        }

        kept[key] = value;
      }

      return kept;
    };

    const config: JSONObject = keep(
      data.definition.configFields,
      data.config,
      data.config,
    );

    return {
      config,
      secrets: keep(data.definition.secretFields, data.secrets, config),
    };
  }

  /*
   * The catalog's shape, then the destination's own rules, on the settings
   * as a save keeps them (normalize): what it returns is what is stored and
   * sent with. With requireRequiredSecrets false the secrets may be partial
   * (an update that keeps the stored ones is checked once merged, with it
   * true).
   */
  public static validate(data: {
    type: unknown;
    config: JSONObject;
    secrets: JSONObject;
    requireRequiredSecrets: boolean;
  }): AuditLogExportSettings {
    const definition: AuditLogExportDestinationDefinition =
      this.getDefinitionOrThrow(data.type);

    const normalized: { config: JSONObject; secrets: JSONObject } =
      this.normalize({
        definition,
        config: data.config,
        secrets: data.secrets,
      });

    const shown: (
      fields: Array<AuditLogExportDestinationField>,
    ) => Array<AuditLogExportDestinationField> = (
      fields: Array<AuditLogExportDestinationField>,
    ): Array<AuditLogExportDestinationField> => {
      return fields.filter((field: AuditLogExportDestinationField): boolean => {
        return isAuditLogExportFieldShown({
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

    const settings: AuditLogExportSettings = {
      type: definition.type,
      config: normalized.config,
      secrets: normalized.secrets,
    };

    this.validateDestinationRules(definition, settings, {
      requireRequiredSecrets: data.requireRequiredSecrets,
    });

    return settings;
  }

  // A config setting as text, with the field's default when it has none.
  public static readConfigText(
    settings: AuditLogExportSettings,
    key: string,
  ): string {
    const definition: AuditLogExportDestinationDefinition =
      this.getDefinitionOrThrow(settings.type);
    const field: AuditLogExportDestinationField | undefined =
      definition.configFields.find(
        (candidate: AuditLogExportDestinationField): boolean => {
          return candidate.key === key;
        },
      );
    const value: JSONValue | undefined = field
      ? readAuditLogExportConfigValue(settings.config, field)
      : settings.config[key];

    if (value === undefined || value === null) {
      return "";
    }

    return typeof value === "string" ? value.trim() : String(value);
  }

  public static readSecretText(
    settings: AuditLogExportSettings,
    key: string,
  ): string {
    const value: JSONValue | undefined = settings.secrets[key];

    return typeof value === "string" ? value.trim() : "";
  }

  /*
   * The egress policy for this export's targets. An instance export is set
   * up by a master admin, who runs the network it points into, so it may
   * reach private addresses even where tenants may not (OneUptime Cloud).
   * Loopback, link-local and metadata addresses are refused for everyone.
   */
  public static getEgressOptions(data: {
    isInstanceExport: boolean;
    targetLabel: string;
  }): EgressGuardOptions {
    return {
      targetLabel: data.targetLabel,
      ...(data.isInstanceExport ? { blockPrivateAddresses: false } : {}),
    };
  }

  /*
   * The addresses a person typed (an S3-compatible endpoint, a webhook URL,
   * a syslog host) go through the egress policy every outbound connector
   * uses, at save time, so a blocked address is a form error rather than a
   * delivery that fails on every run. The exporter's own connections go
   * through it again.
   */
  public static async assertTargetsAllowed(
    settings: AuditLogExportSettings,
    options: { isInstanceExport: boolean },
  ): Promise<void> {
    const definition: AuditLogExportDestinationDefinition =
      this.getDefinitionOrThrow(settings.type);

    for (const field of definition.configFields) {
      if (field.type !== "url") {
        continue;
      }

      const value: string = this.readConfigText(settings, field.key);

      if (!value) {
        continue;
      }

      await DataSourceEgressGuard.assertUrlAllowed(
        value,
        this.getEgressOptions({
          isInstanceExport: options.isInstanceExport,
          targetLabel: field.title,
        }),
      );
    }

    if (settings.type === AuditLogExportDestinationType.Syslog) {
      await DataSourceEgressGuard.assertHostnameAllowed(
        this.readConfigText(settings, "host"),
        this.getEgressOptions({
          isInstanceExport: options.isInstanceExport,
          targetLabel: "Syslog",
        }),
      );
    }
  }

  private static validateDestinationRules(
    definition: AuditLogExportDestinationDefinition,
    settings: AuditLogExportSettings,
    options: { requireRequiredSecrets: boolean },
  ): void {
    const read: (key: string) => string = (key: string): string => {
      return this.readConfigText(settings, key);
    };

    const folderProblem: string | null = definition.configFields.some(
      (field: AuditLogExportDestinationField): boolean => {
        return field.key === "folder";
      },
    )
      ? describeFolderProblem(read("folder"))
      : null;

    if (folderProblem) {
      throw new BadDataException(folderProblem);
    }

    switch (settings.type) {
      case AuditLogExportDestinationType.AmazonS3:
      case AuditLogExportDestinationType.S3Compatible: {
        const isAmazon: boolean =
          settings.type === AuditLogExportDestinationType.AmazonS3;
        const bucket: string = read("bucket");

        if (
          isAmazon
            ? !isAmazonS3BucketName(bucket)
            : !isS3CompatibleBucketName(bucket)
        ) {
          throw new BadDataException(
            isAmazon
              ? "Bucket must be an S3 bucket name: 3 to 63 lowercase letters, digits, dots and hyphens, starting and ending with a letter or digit."
              : "Bucket must be a bucket name, without slashes or spaces.",
          );
        }

        if (!isS3RegionName(read("region"))) {
          throw new BadDataException(
            "Region must be a region name such as us-east-1: letters, digits and hyphens.",
          );
        }

        const accessKeyId: string = read("accessKeyId");

        if (accessKeyId.length > 128 || hasControlOrSpace(accessKeyId)) {
          throw new BadDataException(
            "Access key ID must be the key's ID, without spaces.",
          );
        }

        if (!isAmazon) {
          const endpoint: URL = new URL(read("endpoint"));

          if (endpoint.search || endpoint.hash) {
            throw new BadDataException(
              "Endpoint must be the storage's address without a query or a fragment, such as https://minio.example.com:9000.",
            );
          }
        }

        return;
      }

      case AuditLogExportDestinationType.GoogleCloudStorage: {
        if (!isGoogleCloudStorageBucketName(read("bucket"))) {
          throw new BadDataException(
            "Bucket must be a Cloud Storage bucket name: 3 to 63 lowercase letters, digits, hyphens, underscores and dots, starting and ending with a letter or digit.",
          );
        }

        const key: string = this.readSecretText(settings, "serviceAccountJson");

        if (key || options.requireRequiredSecrets) {
          GoogleSecOpsClient.parseServiceAccountJson(key);
        }

        return;
      }

      case AuditLogExportDestinationType.AzureBlobStorage: {
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

        if (
          read("authentication") === AuditLogExportAzureAuthentication.SasToken
        ) {
          const token: string = this.readSecretText(settings, "sasToken");

          if (token && !this.isSasToken(token)) {
            throw new BadDataException(
              "SAS token must be a shared access signature, such as sv=...&sp=cw&...&sig=... - copy it from the storage account's Shared access signature page.",
            );
          }
        } else {
          const key: string = this.readSecretText(settings, "accountKey");

          if (key && !this.isBase64(key)) {
            throw new BadDataException(
              "Access key must be one of the storage account's access keys, as the portal shows it.",
            );
          }
        }

        return;
      }

      case AuditLogExportDestinationType.Webhook: {
        const headerName: string = read("headerName");

        if (headerName && !isHttpHeaderName(headerName)) {
          throw new BadDataException(
            "Header name must be a header name such as Authorization or X-Api-Key: letters, digits and hyphens.",
          );
        }

        const headerValue: string = this.readSecretText(
          settings,
          "headerValue",
        );

        if (hasControlCharacter(headerValue)) {
          throw new BadDataException(
            "Credential cannot hold a line break or a control character.",
          );
        }

        const signingSecret: string = this.readSecretText(
          settings,
          "signingSecret",
        );

        if (signingSecret && signingSecret.length < SIGNING_SECRET_MIN_LENGTH) {
          throw new BadDataException(
            `Signing secret must be at least ${SIGNING_SECRET_MIN_LENGTH} characters long.`,
          );
        }

        return;
      }

      case AuditLogExportDestinationType.Syslog: {
        if (!isSyslogHost(read("host"))) {
          throw new BadDataException(
            "Host must be a host name or an IP address, without a scheme or a port, such as syslog.example.com.",
          );
        }

        const port: number = Number(read("port"));

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new BadDataException(
            "Port must be a whole number from 1 to 65535.",
          );
        }

        const certificate: string = read("caCertificate");

        if (
          read("protocol") === AuditLogExportSyslogProtocol.Tls &&
          certificate &&
          !certificate.includes("-----BEGIN CERTIFICATE-----")
        ) {
          throw new BadDataException(
            "CA certificate must be a PEM certificate, starting with -----BEGIN CERTIFICATE-----.",
          );
        }

        return;
      }
    }
  }

  // A SAS token holds a signature (sig=) among its query parameters.
  private static isSasToken(value: string): boolean {
    const token: string = value.startsWith("?") ? value.slice(1) : value;

    if (hasControlOrSpace(token)) {
      return false;
    }

    return token.split("&").some((part: string): boolean => {
      return part.startsWith("sig=") && part.length > 4;
    });
  }

  private static isBase64(value: string): boolean {
    if (value.length < 16 || value.length % 4 !== 0) {
      return false;
    }

    for (let index: number = 0; index < value.length; index++) {
      const char: string = value.charAt(index);
      const isPadding: boolean = char === "=" && index >= value.length - 2;

      if (
        !isLetterOrDigit(char) &&
        char !== "+" &&
        char !== "/" &&
        !isPadding
      ) {
        return false;
      }
    }

    return true;
  }
}
