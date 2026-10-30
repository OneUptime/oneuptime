import { CloudProvider } from "../Cloud/CloudPlatform";
import IconProp from "../Icon/IconProp";
import ProviderLogo from "../ProviderLogo/ProviderLogo";

/*
 * EVERYTHING ABOUT A CLOUD CONNECTION THAT IS NOT CODE.
 *
 * A cloud connection is OneUptime reading one cloud account the way an
 * OpenTelemetry Collector's cloud receivers would - Amazon CloudWatch,
 * Azure Monitor, Google Cloud Monitoring - with no collector to run: the
 * customer creates read-only access in their cloud's own browser shell
 * with one command, pastes what it printed, and OneUptime lists the
 * account's resources and reads their key metrics on a schedule.
 *
 * Shared by the dashboard (Cloud > Connect: the tiles, the guided form,
 * the list), the server (validating what a form saves, the connector that
 * reads the cloud) and the docs tests (every field the form asks for is
 * named in the guide).
 *
 * Field keys are the keys stored in CloudConnection.config (readable) and
 * CloudConnection.secrets (encrypted, never read back). Connectors read
 * their settings by these keys.
 *
 * The words here are shown as written in the dashboard and translated
 * there: this folder is one of the extractor's source roots
 * (Dashboard/scripts/i18n/ExtractStrings.ts), which reads the title,
 * description, summary, explanation, hint, label and placeholder of every
 * entry. The shells' names are product names, the same in every language.
 */

/*
 * How OneUptime signs in to the cloud. One per connection, fixed by what
 * the customer pasted.
 */
export enum CloudConnectionAuthMethod {
  /*
   * AWS: an IAM role in the customer's account that OneUptime's own AWS
   * identity assumes, with an external id only this project's connections
   * use. Nothing secret is stored. Offered only when this OneUptime has an
   * AWS identity of its own (CLOUD_CONNECT_AWS_ACCESS_KEY_ID).
   */
  AwsRole = "aws-role",
  // AWS: an access key of an IAM user that can only read.
  AwsAccessKey = "aws-access-key",
  // Azure: an app registration (service principal) and its client secret.
  AzureClientSecret = "azure-client-secret",
  // Google Cloud: a service account's JSON key.
  GcpServiceAccountKey = "gcp-service-account-key",
}

export type CloudConnectionFieldType =
  | "text"
  | "password"
  | "dropdown"
  | "json";

export interface CloudConnectionFieldOption {
  label: string;
  value: string;
}

export interface CloudConnectionField {
  key: string;
  title: string;
  description: string;
  type: CloudConnectionFieldType;
  required: boolean;
  placeholder?: string | undefined;
  options?: Array<CloudConnectionFieldOption> | undefined;
  defaultValue?: string | undefined;
  /*
   * Folded under "More fields" on the form: a setting most people leave as
   * it is (the regions, how often, the Azure cloud).
   */
  isAdvanced?: boolean | undefined;
  /*
   * Never shown on the form: a value the pasted output fills in, kept like
   * any other setting (an Azure client secret's expiry).
   */
  isHidden?: boolean | undefined;
  /*
   * The sign-in methods the field belongs to; every method when absent.
   * A field of another method is neither asked for nor stored.
   */
  authMethods?: Array<CloudConnectionAuthMethod> | undefined;
}

export interface CloudConnectionAuthMethodDefinition {
  method: CloudConnectionAuthMethod;
  // How the choice is offered when a cloud has two: "IAM role".
  title: string;
  description: string;
  // What the command does, said above it.
  hint: string;
}

export interface CloudConnectionDefinition {
  provider: CloudProvider;
  title: string;
  // One line on the tile: what connecting it brings in.
  description: string;
  // What arrives, in the reader's words: shown on the form and the list.
  summary: string;
  // What OneUptime may do with the access it is given, said under the command.
  explanation: string;
  icon: IconProp;
  // The cloud's official logo, on its tile, its form and its row of the list.
  logo: ProviderLogo;
  /*
   * The guide: a section of the cloud accounts page, e.g.
   * "/docs/telemetry/cloud-accounts#amazon-web-services". The anchor is the
   * English heading's (DocsLinksResolve holds it to the page).
   */
  docsPath: string;
  // The cloud's own browser terminal the setup command is run in.
  shellTitle: string;
  shellUrl: string;
  authMethods: Array<CloudConnectionAuthMethodDefinition>;
  configFields: Array<CloudConnectionField>;
  secretFields: Array<CloudConnectionField>;
  // The telemetry service a new connection's metrics belong to.
  defaultServiceName: string;
  // How often metrics are read unless the connection says otherwise.
  defaultReadIntervalInMinutes: number;
}

// The setting that says how often a connection's metrics are read.
export const READ_INTERVAL_FIELD_KEY: string = "readIntervalInMinutes";

/*
 * The setting that says whether a connection reads the one account its
 * command was run in, or every account of the organization
 * (CloudConnectionSetupScope). Chosen on the form's first step, where it
 * decides which command is shown.
 */
export const READ_SCOPE_FIELD_KEY: string = "readScope";

/*
 * Where an Azure connection keeps when its client secret expires, read from
 * the endDateTime its setup command prints with the secret.
 */
export const AZURE_SECRET_EXPIRES_AT_KEY: string = "clientSecretExpiresAt";

// The intervals a connection may be read at, in minutes.
export const CLOUD_CONNECTION_READ_INTERVALS: Array<number> = [
  5, 10, 15, 30, 60,
];

/*
 * The setting that records what Data Security may read of the connection's
 * accounts, as its setup command granted it (CloudConnectionSetupCommands):
 * nothing ("off", every connection until it is changed), how their data
 * stores are set up ("configuration": who can reach each one, how it is
 * encrypted and backed up - still never data), or that and samples of the
 * stores' content to find sensitive data in them ("content").
 */
export const DATA_SECURITY_FIELD_KEY: string = "dataSecurity";

export type CloudConnectionDataSecurityLevel =
  | "off"
  | "configuration"
  | "content";

export const CLOUD_CONNECTION_DATA_SECURITY_LEVELS: ReadonlyArray<CloudConnectionDataSecurityLevel> =
  ["off", "configuration", "content"];

// A connection's level: its setting when it is one of the levels, else off.
export function getCloudConnectionDataSecurityLevel(
  value: unknown,
): CloudConnectionDataSecurityLevel {
  return (
    CLOUD_CONNECTION_DATA_SECURITY_LEVELS.find(
      (level: CloudConnectionDataSecurityLevel): boolean => {
        return level === value;
      },
    ) || "off"
  );
}

/*
 * Folded with the other settings most people leave alone: a connection
 * reads no data store until someone opts in, and the command shown changes
 * with the choice.
 */
function dataSecurityField(): CloudConnectionField {
  return {
    key: DATA_SECURITY_FIELD_KEY,
    title: "Data security",
    description:
      "Lets Data Security read your buckets and databases: how they are set up, or that and samples of their content to find sensitive data. The command changes with it.",
    type: "dropdown",
    required: false,
    options: [
      { label: "Off", value: "off" },
      { label: "Configuration only", value: "configuration" },
      { label: "Configuration and content samples", value: "content" },
    ],
    defaultValue: "off",
    isAdvanced: true,
  };
}

/*
 * The setting that records whether the connection may also close a data
 * store's exposure, as its setup command granted it: a person on the
 * store's issue, or a Security Operations playbook, blocks a store's public
 * access and revokes its sharing (DataSecurityResponse) - the only writes
 * a connection is ever given, granted on their own and off until someone
 * picks "block".
 */
export const DATA_SECURITY_RESPONSE_FIELD_KEY: string = "dataSecurityResponse";

export type CloudConnectionDataSecurityResponse = "off" | "block";

export const CLOUD_CONNECTION_DATA_SECURITY_RESPONSES: ReadonlyArray<CloudConnectionDataSecurityResponse> =
  ["off", "block"];

// Whether a connection's setting lets playbooks close an exposure: "block" alone does.
export function isCloudConnectionDataSecurityResponseOn(
  value: unknown,
): boolean {
  return value === "block";
}

function dataSecurityResponseField(): CloudConnectionField {
  return {
    key: DATA_SECURITY_RESPONSE_FIELD_KEY,
    title: "Data security response",
    description:
      "Lets Data Security block public access to a data store and revoke its sharing: from its issue, when a person asks, or in a playbook, each run approved by a person unless the playbook says otherwise. The command changes with it.",
    type: "dropdown",
    required: false,
    options: [
      { label: "Off", value: "off" },
      { label: "Block public access and sharing", value: "block" },
    ],
    defaultValue: "off",
    isAdvanced: true,
  };
}

function readIntervalField(defaultMinutes: number): CloudConnectionField {
  return {
    key: READ_INTERVAL_FIELD_KEY,
    title: "Read metrics every",
    description:
      "Reading less often costs fewer calls to your cloud's monitoring API.",
    type: "dropdown",
    required: true,
    options: [
      { label: "5 minutes", value: "5" },
      { label: "10 minutes", value: "10" },
      { label: "15 minutes", value: "15" },
      { label: "30 minutes", value: "30" },
      { label: "1 hour", value: "60" },
    ],
    defaultValue: String(defaultMinutes),
    isAdvanced: true,
  };
}

/*
 * The two choices, and the line under the title, in the cloud's own words:
 * an AWS account of an organization, an Azure subscription of a tenant, a
 * Google Cloud project of an organization. Each choice is written as a
 * label, so the Dashboard's string extraction finds it and the form shows
 * it in the reader's language.
 */
function readScopeField(data: {
  one: { label: string };
  every: { label: string };
  description: string;
  authMethods?: Array<CloudConnectionAuthMethod> | undefined;
}): CloudConnectionField {
  return {
    key: READ_SCOPE_FIELD_KEY,
    title: "What to read",
    description: data.description,
    type: "dropdown",
    required: false,
    options: [
      { label: data.one.label, value: "account" },
      { label: data.every.label, value: "organization" },
    ],
    defaultValue: "account",
    authMethods: data.authMethods,
  };
}

export const CloudConnectionCatalog: Array<CloudConnectionDefinition> = [
  {
    provider: CloudProvider.AWS,
    title: "Amazon Web Services",
    logo: ProviderLogo.Aws,
    description:
      "EC2, RDS, Lambda, load balancers and more, read from CloudWatch.",
    summary:
      "Every resource in every region you use, with its key metrics and what changed.",
    explanation:
      "OneUptime can only read: metrics, resources and how they are set up, changes and health events. Never data or secrets.",
    icon: IconProp.Cloud,
    docsPath: "/docs/telemetry/cloud-accounts#amazon-web-services",
    shellTitle: "AWS CloudShell",
    shellUrl: "https://console.aws.amazon.com/cloudshell/home",
    authMethods: [
      {
        method: CloudConnectionAuthMethod.AwsRole,
        title: "IAM role",
        description:
          "Recommended. Nothing secret is stored: OneUptime signs in with a role you can delete at any time.",
        hint: "Run this in AWS CloudShell. It creates a role that can only read, and prints the role's ARN.",
      },
      {
        method: CloudConnectionAuthMethod.AwsAccessKey,
        title: "Access key",
        description:
          "An IAM user's access key. Use it when a role is not possible.",
        hint: "Run this in AWS CloudShell. It creates a user that can only read, and prints its access key.",
      },
    ],
    configFields: [
      {
        key: "roleArn",
        title: "Role ARN",
        description: "The role the command created.",
        type: "text",
        required: true,
        placeholder: "arn:aws:iam::123456789012:role/OneUptimeReadOnly",
        authMethods: [CloudConnectionAuthMethod.AwsRole],
      },
      {
        key: "accessKeyId",
        title: "Access key ID",
        description: "The access key ID the command printed.",
        type: "text",
        required: true,
        placeholder: "AKIA...",
        authMethods: [CloudConnectionAuthMethod.AwsAccessKey],
      },
      readScopeField({
        one: { label: "This account" },
        every: { label: "Every account in the organization" },
        description:
          "One account, or every account of the organization. The command changes with it.",
        authMethods: [CloudConnectionAuthMethod.AwsRole],
      }),
      {
        key: "regions",
        title: "Regions",
        description:
          "Leave empty to read every region you use, or list regions separated by commas.",
        type: "text",
        required: false,
        placeholder: "us-east-1, eu-west-1",
        isAdvanced: true,
      },
      readIntervalField(10),
      dataSecurityField(),
      dataSecurityResponseField(),
    ],
    secretFields: [
      {
        key: "secretAccessKey",
        title: "Secret access key",
        description:
          "The secret the command printed. Stored encrypted and never shown again.",
        type: "password",
        required: true,
        authMethods: [CloudConnectionAuthMethod.AwsAccessKey],
      },
    ],
    defaultServiceName: "Amazon Web Services",
    defaultReadIntervalInMinutes: 10,
  },
  {
    provider: CloudProvider.Azure,
    title: "Microsoft Azure",
    logo: ProviderLogo.Azure,
    description:
      "Virtual machines, App Service, SQL, storage and more, read from Azure Monitor.",
    summary:
      "Every resource in the subscriptions the app can read, with its key metrics and what changed.",
    explanation:
      "OneUptime can only read: resources, metrics and the activity log. Never data or secrets.",
    icon: IconProp.Cloud,
    docsPath: "/docs/telemetry/cloud-accounts#microsoft-azure",
    shellTitle: "Azure Cloud Shell",
    shellUrl: "https://shell.azure.com",
    authMethods: [
      {
        method: CloudConnectionAuthMethod.AzureClientSecret,
        title: "App registration",
        description: "An app with the Monitoring Reader role.",
        hint: "Run this in Azure Cloud Shell. It creates an app that can only read, and prints its details.",
      },
    ],
    configFields: [
      {
        key: "tenantId",
        title: "Directory (tenant) ID",
        description: "The tenant value the command printed.",
        type: "text",
        required: true,
        placeholder: "00000000-0000-0000-0000-000000000000",
      },
      {
        key: "clientId",
        title: "Application (client) ID",
        description: "The appId value the command printed.",
        type: "text",
        required: true,
        placeholder: "00000000-0000-0000-0000-000000000000",
      },
      readScopeField({
        one: { label: "This subscription" },
        every: { label: "Every subscription in the tenant" },
        description:
          "One subscription, or every subscription of the tenant. The command changes with it.",
      }),
      {
        key: "subscriptionIds",
        title: "Subscriptions",
        description:
          "Leave empty to read every subscription the app can read, or list subscription IDs separated by commas.",
        type: "text",
        required: false,
        placeholder: "00000000-0000-0000-0000-000000000000",
        isAdvanced: true,
      },
      {
        key: "cloud",
        title: "Cloud",
        description: "Which Azure cloud the tenant is in.",
        type: "dropdown",
        required: true,
        options: [
          { label: "Azure public cloud", value: "public" },
          { label: "Azure Government (US)", value: "usgov" },
        ],
        defaultValue: "public",
        isAdvanced: true,
      },
      readIntervalField(5),
      dataSecurityField(),
      dataSecurityResponseField(),
      {
        key: AZURE_SECRET_EXPIRES_AT_KEY,
        title: "Client secret expires",
        description:
          "When the client secret stops working, as the setup command printed it.",
        type: "text",
        required: false,
        isHidden: true,
      },
    ],
    secretFields: [
      {
        key: "clientSecret",
        title: "Client secret",
        description:
          "The password value the command printed. Stored encrypted and never shown again.",
        type: "password",
        required: true,
      },
    ],
    defaultServiceName: "Microsoft Azure",
    defaultReadIntervalInMinutes: 5,
  },
  {
    provider: CloudProvider.GCP,
    title: "Google Cloud",
    logo: ProviderLogo.GoogleCloud,
    description:
      "Compute Engine, Cloud SQL, Cloud Run, buckets and more, read from Cloud Monitoring.",
    summary:
      "Every resource in your projects, with its key metrics and what changed.",
    explanation:
      "OneUptime can only read: metrics, resources and the audit log. Never data or secrets.",
    icon: IconProp.Cloud,
    docsPath: "/docs/telemetry/cloud-accounts#google-cloud",
    shellTitle: "Google Cloud Shell",
    shellUrl: "https://shell.cloud.google.com/?show=terminal",
    authMethods: [
      {
        method: CloudConnectionAuthMethod.GcpServiceAccountKey,
        title: "Service account",
        description:
          "A service account with the Monitoring Viewer, Cloud Asset Viewer and Logs Viewer roles.",
        hint: "Run this in Cloud Shell, in the project to monitor. It creates a service account that can only read, and prints its key.",
      },
    ],
    configFields: [
      readScopeField({
        one: { label: "This project" },
        every: { label: "Every project in the organization" },
        description:
          "One project, or every project of the organization. The command changes with it.",
      }),
      {
        key: "projectIds",
        title: "Projects",
        description:
          "Leave empty to read the service account's own project, or list project IDs separated by commas.",
        type: "text",
        required: false,
        placeholder: "my-project-123456",
        isAdvanced: true,
      },
      readIntervalField(5),
      dataSecurityField(),
      dataSecurityResponseField(),
    ],
    secretFields: [
      {
        key: "serviceAccountJson",
        title: "Service account key (JSON)",
        description:
          "The key the command printed. Stored encrypted and never shown again.",
        type: "json",
        required: true,
        placeholder: '{ "client_email": "...", "private_key": "..." }',
      },
    ],
    defaultServiceName: "Google Cloud",
    defaultReadIntervalInMinutes: 5,
  },
];

/*
 * Settings OneUptime writes on save from what was pasted, for the list to
 * show (never secrets): the service account's email and its project.
 */
export const CLOUD_CONNECTION_DERIVED_CONFIG_KEYS: Array<string> = [
  "authMethod",
  "clientEmail",
  "keyProjectId",
];

export function isCloudConnectionProvider(
  value: unknown,
): value is CloudProvider {
  return (
    typeof value === "string" &&
    (Object.values(CloudProvider) as Array<string>).includes(value)
  );
}

export function getCloudConnectionDefinition(
  provider: string | undefined | null,
): CloudConnectionDefinition | undefined {
  return CloudConnectionCatalog.find(
    (definition: CloudConnectionDefinition): boolean => {
      return definition.provider === provider;
    },
  );
}

export function getCloudConnectionTitle(
  provider: string | undefined | null,
): string {
  return getCloudConnectionDefinition(provider)?.title || provider || "";
}

export function isCloudConnectionAuthMethod(
  value: unknown,
): value is CloudConnectionAuthMethod {
  return (
    typeof value === "string" &&
    (Object.values(CloudConnectionAuthMethod) as Array<string>).includes(value)
  );
}

/*
 * The sign-in method of a connection: the one its settings name when the
 * cloud offers it, else the cloud's first.
 */
export function getCloudConnectionAuthMethod(
  definition: CloudConnectionDefinition,
  value: unknown,
): CloudConnectionAuthMethod {
  const offered: Array<CloudConnectionAuthMethod> = definition.authMethods.map(
    (
      method: CloudConnectionAuthMethodDefinition,
    ): CloudConnectionAuthMethod => {
      return method.method;
    },
  );

  if (isCloudConnectionAuthMethod(value) && offered.includes(value)) {
    return value;
  }

  return offered[0]!;
}

export function getCloudConnectionAuthMethodDefinition(
  definition: CloudConnectionDefinition,
  method: CloudConnectionAuthMethod,
): CloudConnectionAuthMethodDefinition | undefined {
  return definition.authMethods.find(
    (candidate: CloudConnectionAuthMethodDefinition): boolean => {
      return candidate.method === method;
    },
  );
}

// The fields of a list that belong to a sign-in method.
export function getCloudConnectionFieldsForMethod(
  fields: Array<CloudConnectionField>,
  method: CloudConnectionAuthMethod,
): Array<CloudConnectionField> {
  return fields.filter((field: CloudConnectionField): boolean => {
    return !field.authMethods || field.authMethods.includes(method);
  });
}

/*
 * How often a connection's metrics are read: its own setting when it is
 * one of the offered intervals, else its cloud's default.
 */
export function getCloudConnectionReadIntervalInMinutes(
  definition: CloudConnectionDefinition,
  value: unknown,
): number {
  const minutes: number = Number(value);

  if (CLOUD_CONNECTION_READ_INTERVALS.includes(minutes)) {
    return minutes;
  }

  return definition.defaultReadIntervalInMinutes;
}

// Runs of whitespace: one class, one repeat, read in linear time.
const WHITESPACE_RUN_REGEX: RegExp = /\s+/;

/*
 * A comma (or whitespace) separated list a form holds: trimmed, without
 * empty or repeated entries, in the order written.
 */
export function splitCloudConnectionList(value: unknown): Array<string> {
  if (typeof value !== "string") {
    return [];
  }

  const seen: Set<string> = new Set<string>();
  const items: Array<string> = [];

  for (const part of value.split(",")) {
    for (const piece of part.trim().split(WHITESPACE_RUN_REGEX)) {
      const item: string = piece.trim();

      if (item && !seen.has(item)) {
        seen.add(item);
        items.push(item);
      }
    }
  }

  return items;
}
