import SecuritySeverity from "../SecuritySeverity";
import ComplianceFramework from "./ComplianceFramework";
import DataCategory from "./DataCategory";
import DataSensitivity from "./DataSensitivity";
import {
  DataStoreFamily,
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
  getDataStoreKindInfo,
} from "./DataStoreKind";
import {
  DataStoreExposure,
  DataStorePostureFacts,
  getDataStoreExposure,
  tlsVersionNumber,
} from "./DataStorePosture";
import DataStoreEnvironment, { isNonProduction } from "./DataStoreEnvironment";

/*
 * EVERY CHECK DATA SECURITY RUNS ON A STORE, AND WHAT A FAILING ONE MEANS.
 *
 * A check reads the facts about one store - its configuration
 * (DataStorePosture.ts), what was found in it, who can reach it, where it
 * lives - and passes, fails, or cannot tell. A failing check opens one
 * issue on that store. Each check says:
 *
 *  - what it is, in the sentence an issue is titled with, and why it
 *    matters, in one more;
 *  - how bad a failure is for each level of sensitivity
 *    (`severityBySensitivity`): a public bucket of card numbers is
 *    Critical, a public bucket of website images is no issue at all (null);
 *  - the framework requirements it is evidence for, which is how
 *    Compliance scores frameworks;
 *  - how to fix it on each cloud: the console steps, the CLI command and
 *    the Terraform, with {placeholders} the issue page fills in.
 *
 * Kept free of anything server-only: the Dashboard lists, explains and
 * renders these, so what a page says is what the check did. Ids are stored
 * on issues and never renamed.
 */

export enum DataSecurityCheckGroup {
  Exposure = "Exposure",
  Encryption = "Encryption",
  Recovery = "Recovery",
  Visibility = "Visibility",
  Access = "Access",
  Hygiene = "Data hygiene",
  Telemetry = "Telemetry",
  Residency = "Residency",
  AI = "AI",
}

export const ALL_DATA_SECURITY_CHECK_GROUPS: ReadonlyArray<DataSecurityCheckGroup> =
  [
    DataSecurityCheckGroup.Exposure,
    DataSecurityCheckGroup.Encryption,
    DataSecurityCheckGroup.Recovery,
    DataSecurityCheckGroup.Visibility,
    DataSecurityCheckGroup.Access,
    DataSecurityCheckGroup.Hygiene,
    DataSecurityCheckGroup.Telemetry,
    DataSecurityCheckGroup.Residency,
    DataSecurityCheckGroup.AI,
  ];

export enum DataSecurityCheckStatus {
  Pass = "Pass",
  Fail = "Fail",
  Unknown = "Unknown",
  NotApplicable = "Not applicable",
}

/*
 * Everything a check may read about one store. Built by the server from the
 * store's row, its findings, its access entries and the project's rules;
 * tests build it by hand.
 */
export interface DataStoreCheckInput {
  kind: DataStoreKind;
  name: string;
  region?: string | undefined;
  environment: DataStoreEnvironment;
  sensitivity: DataSensitivity;
  // Data types found with at least Medium confidence.
  dataTypeIds: ReadonlyArray<string>;
  dataCategories: ReadonlyArray<DataCategory>;
  posture: DataStorePostureFacts;
  isPublicByDesign: boolean;
  hasOwner: boolean;
  lastActivityAt?: Date | null | undefined;
  // How many identities can read the store, when access was read.
  readerCount?: number | null | undefined;
  // A production store this one holds copies of, by fingerprint.
  copiedFromProductionStoreName?: string | null | undefined;
  // Telemetry: confident data types no scrub rule covers.
  unscrubbedDataTypeIds?: ReadonlyArray<string> | undefined;
  // AI providers this store's data was confirmed to reach.
  aiProvidersReached?: ReadonlyArray<string> | undefined;
  // Tagged as training or retrieval data for AI.
  isAiData?: boolean | undefined;
  // Residency rules the store's region or replicas break.
  residencyViolations?:
    | ReadonlyArray<{ ruleName: string; region: string }>
    | undefined;
  // Password columns whose values are not password hashes.
  plaintextPasswordFields?: ReadonlyArray<string> | undefined;
  now?: Date | undefined;
}

export interface DataSecurityCheckResult {
  status: DataSecurityCheckStatus;
  // One sentence of evidence for the issue: what the check saw.
  evidence?: string | undefined;
  // A severity the evidence itself sets, overriding the sensitivity map.
  severity?: SecuritySeverity | undefined;
}

export interface FrameworkRequirementRef {
  framework: ComplianceFramework;
  requirement: string;
}

export interface CheckRemediation {
  steps: ReadonlyArray<string>;
  cli?: string | undefined;
  terraform?: string | undefined;
}

export interface DataSecurityCheckInfo {
  id: string;
  group: DataSecurityCheckGroup;
  // The issue's title: what is wrong, in a few words.
  title: string;
  description: string;
  whyItMatters: string;
  severityBySensitivity: Readonly<
    Record<DataSensitivity, SecuritySeverity | null>
  >;
  // Families or kinds the check applies to; every store when absent.
  families?: ReadonlyArray<DataStoreFamily> | undefined;
  kinds?: ReadonlyArray<DataStoreKind> | undefined;
  requirements: ReadonlyArray<FrameworkRequirementRef>;
  // How to fix it: by kind first, then by provider, then for any store.
  remediation: Readonly<
    Partial<Record<DataStoreKind | DataStoreProvider | "default", CheckRemediation>>
  >;
  evaluate: (input: DataStoreCheckInput) => DataSecurityCheckResult;
}

const S: typeof SecuritySeverity = SecuritySeverity;

function severities(
  restricted: SecuritySeverity | null,
  confidential: SecuritySeverity | null,
  internal: SecuritySeverity | null,
  publicLevel: SecuritySeverity | null,
): Readonly<Record<DataSensitivity, SecuritySeverity | null>> {
  return {
    [DataSensitivity.Restricted]: restricted,
    [DataSensitivity.Confidential]: confidential,
    [DataSensitivity.Internal]: internal,
    [DataSensitivity.Public]: publicLevel,
  };
}

const PASS: DataSecurityCheckResult = { status: DataSecurityCheckStatus.Pass };
const UNKNOWN: DataSecurityCheckResult = {
  status: DataSecurityCheckStatus.Unknown,
};
const NOT_APPLICABLE: DataSecurityCheckResult = {
  status: DataSecurityCheckStatus.NotApplicable,
};

function fail(evidence: string, severity?: SecuritySeverity): DataSecurityCheckResult {
  return { status: DataSecurityCheckStatus.Fail, evidence, severity };
}

/*
 * A check of one fact: fails when the fact equals `failWhen`, cannot tell
 * when the reader could not read it, and does not apply when the store's
 * kind has no such fact.
 */
function factIs(
  value: boolean | null | undefined,
  failWhen: boolean,
  evidence: string,
): DataSecurityCheckResult {
  if (value === undefined) {
    return NOT_APPLICABLE;
  }

  if (value === null) {
    return UNKNOWN;
  }

  return value === failWhen ? fail(evidence) : PASS;
}

function r(
  framework: ComplianceFramework,
  requirement: string,
): FrameworkRequirementRef {
  return { framework, requirement };
}

const CF: typeof ComplianceFramework = ComplianceFramework;
const G: typeof DataSecurityCheckGroup = DataSecurityCheckGroup;
const FAM: typeof DataStoreFamily = DataStoreFamily;
const K: typeof DataStoreKind = DataStoreKind;
const P: typeof DataStoreProvider = DataStoreProvider;

const STORING_FAMILIES: ReadonlyArray<DataStoreFamily> = [
  FAM.ObjectStorage,
  FAM.Database,
  FAM.Warehouse,
  FAM.Search,
  FAM.Cache,
  FAM.FileSystem,
  FAM.Snapshot,
];

const DATABASE_FAMILIES: ReadonlyArray<DataStoreFamily> = [
  FAM.Database,
  FAM.Warehouse,
  FAM.Search,
  FAM.Cache,
];

// Access requirements every exposure check is evidence for.
const ACCESS_REQUIREMENTS: ReadonlyArray<FrameworkRequirementRef> = [
  r(CF.GDPR, "Art. 32"),
  r(CF.CCPA, "1798.150"),
  r(CF.HIPAA, "164.312(a)(1)"),
  r(CF.PCIDSS, "7.2"),
  r(CF.SOC2, "CC6.1"),
  r(CF.ISO27001, "A.5.15"),
  r(CF.NISTCSF, "PR.AA-05"),
  r(CF.LGPD, "Art. 46"),
  r(CF.DPDP, "Sec. 8(5)"),
];

const AT_REST_REQUIREMENTS: ReadonlyArray<FrameworkRequirementRef> = [
  r(CF.GDPR, "Art. 32"),
  r(CF.HIPAA, "164.312(a)(2)(iv)"),
  r(CF.PCIDSS, "3.5.1"),
  r(CF.SOC2, "CC6.1"),
  r(CF.ISO27001, "A.8.24"),
  r(CF.NISTCSF, "PR.DS-01"),
  r(CF.LGPD, "Art. 46"),
  r(CF.DPDP, "Sec. 8(5)"),
];

const IN_TRANSIT_REQUIREMENTS: ReadonlyArray<FrameworkRequirementRef> = [
  r(CF.GDPR, "Art. 32"),
  r(CF.HIPAA, "164.312(e)(1)"),
  r(CF.PCIDSS, "4.2.1"),
  r(CF.SOC2, "CC6.7"),
  r(CF.ISO27001, "A.8.24"),
  r(CF.NISTCSF, "PR.DS-02"),
];

const RECOVERY_REQUIREMENTS: ReadonlyArray<FrameworkRequirementRef> = [
  r(CF.GDPR, "Art. 32"),
  r(CF.HIPAA, "164.308(a)(7)"),
  r(CF.SOC2, "A1.2"),
  r(CF.ISO27001, "A.8.13"),
  r(CF.NISTCSF, "PR.DS-11"),
];

const LOGGING_REQUIREMENTS: ReadonlyArray<FrameworkRequirementRef> = [
  r(CF.GDPR, "Art. 32"),
  r(CF.HIPAA, "164.312(b)"),
  r(CF.PCIDSS, "10.2"),
  r(CF.SOC2, "CC7.2"),
  r(CF.ISO27001, "A.8.15"),
  r(CF.NISTCSF, "DE.CM-09"),
];

const MINIMISATION_REQUIREMENTS: ReadonlyArray<FrameworkRequirementRef> = [
  r(CF.GDPR, "Art. 5(1)(c)"),
  r(CF.GDPR, "Art. 25"),
  r(CF.CCPA, "1798.100(c)"),
  r(CF.ISO27001, "A.5.34"),
  r(CF.ISO27001, "A.8.11"),
  r(CF.LGPD, "Art. 6"),
  r(CF.DPDP, "Sec. 8(7)"),
];

const LEAKAGE_REQUIREMENTS: ReadonlyArray<FrameworkRequirementRef> = [
  r(CF.GDPR, "Art. 32"),
  r(CF.ISO27001, "A.8.12"),
  r(CF.SOC2, "CC6.1"),
  r(CF.NISTCSF, "PR.DS-01"),
];

function isSecretType(dataTypeId: string): boolean {
  return (
    dataTypeId.endsWith("-key") ||
    dataTypeId.endsWith("-token") ||
    dataTypeId.endsWith("-secret") ||
    [
      "private-key",
      "password-in-url",
      "connection-string-password",
      "authorization-header",
      "generic-secret",
      "json-web-token",
      "slack-webhook-url",
      "aws-access-key-id",
    ].includes(dataTypeId)
  );
}

export const DATA_SECURITY_CHECKS: ReadonlyArray<DataSecurityCheckInfo> = [
  // Exposure.
  {
    id: "public-read",
    group: G.Exposure,
    title: "Anyone on the internet can read it",
    description:
      "The store's policy, ACL or IAM bindings let anyone read its data without signing in.",
    whyItMatters:
      "Public stores are found by automated scanners within hours, and everything in them should be treated as already copied.",
    severityBySensitivity: severities(S.Critical, S.Critical, S.High, S.Low),
    families: [FAM.ObjectStorage, FAM.Warehouse, FAM.Search],
    requirements: ACCESS_REQUIREMENTS,
    remediation: {
      [K.AwsS3Bucket]: {
        steps: [
          "Open the bucket in the S3 console and choose Permissions.",
          "Under Block public access, choose Edit, turn on all four settings and save.",
          "Remove any bucket policy statement whose Principal is \"*\" without a restricting condition, and any ACL grant to Everyone or Authenticated users.",
        ],
        cli: "aws s3api put-public-access-block --bucket {name} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
        terraform:
          'resource "aws_s3_bucket_public_access_block" "{name}" {\n  bucket                  = "{name}"\n  block_public_acls       = true\n  ignore_public_acls      = true\n  block_public_policy     = true\n  restrict_public_buckets = true\n}',
      },
      [K.AzureStorageAccount]: {
        steps: [
          "Open the storage account in the Azure portal and choose Configuration.",
          "Set Allow Blob anonymous access to Disabled and save.",
          "Set each container's access level to Private.",
        ],
        cli: "az storage account update --name {name} --allow-blob-public-access false",
        terraform:
          'resource "azurerm_storage_account" "{name}" {\n  # ...\n  allow_nested_items_to_be_public = false\n}',
      },
      [K.GcpStorageBucket]: {
        steps: [
          "Open the bucket in the Cloud console and choose Permissions.",
          "Remove the allUsers and allAuthenticatedUsers principals.",
          "Turn on Prevent public access.",
        ],
        cli: "gcloud storage buckets update gs://{name} --public-access-prevention",
        terraform:
          'resource "google_storage_bucket" "{name}" {\n  # ...\n  public_access_prevention = "enforced"\n}',
      },
      [K.GcpBigQueryDataset]: {
        steps: [
          "Open the dataset in BigQuery and choose Sharing, then Permissions.",
          "Remove allUsers and allAuthenticatedUsers.",
        ],
        cli: "bq show --format=prettyjson {name} > dataset.json  # remove the allUsers / allAuthenticatedUsers entries, then: bq update --source dataset.json {name}",
      },
      default: {
        steps: [
          "Remove every grant to anonymous or all-authenticated principals.",
          "If the store must serve public files, move them to a store marked public by design that holds nothing else.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      if (input.isPublicByDesign) {
        return PASS;
      }

      return factIs(
        input.posture.publicRead,
        true,
        input.posture.publicReason ||
          "Its access settings let anyone read it without signing in.",
      );
    },
  },
  {
    id: "public-write",
    group: G.Exposure,
    title: "Anyone on the internet can change it",
    description:
      "The store's policy, ACL or IAM bindings let anyone write or delete its data.",
    whyItMatters:
      "Anyone can plant malware, replace files your apps serve, or delete everything in it.",
    severityBySensitivity: severities(S.Critical, S.Critical, S.Critical, S.High),
    families: [FAM.ObjectStorage, FAM.Warehouse, FAM.Search],
    requirements: ACCESS_REQUIREMENTS,
    remediation: {
      [K.AwsS3Bucket]: {
        steps: [
          "Remove bucket policy statements and ACL grants that give s3:PutObject, s3:DeleteObject or WRITE to everyone.",
          "Turn on all four Block public access settings.",
        ],
        cli: "aws s3api put-public-access-block --bucket {name} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
      },
      default: {
        steps: [
          "Remove every write or delete grant to anonymous or all-authenticated principals.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return factIs(
        input.posture.publicWrite,
        true,
        "Its access settings let anyone write to it without signing in.",
      );
    },
  },
  {
    id: "public-access-not-blocked",
    group: G.Exposure,
    title: "Public access is not blocked",
    description:
      "S3 Block Public Access is not fully on for the bucket or its account, so one policy change can make it public.",
    whyItMatters:
      "Most public-bucket breaches start as a single mistaken policy edit; the block stops that edit from taking effect.",
    severityBySensitivity: severities(S.High, S.Medium, S.Low, null),
    kinds: [K.AwsS3Bucket],
    requirements: ACCESS_REQUIREMENTS,
    remediation: {
      [K.AwsS3Bucket]: {
        steps: [
          "Open the bucket in the S3 console and choose Permissions.",
          "Under Block public access, choose Edit, turn on all four settings and save.",
        ],
        cli: "aws s3api put-public-access-block --bucket {name} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
        terraform:
          'resource "aws_s3_bucket_public_access_block" "{name}" {\n  bucket                  = "{name}"\n  block_public_acls       = true\n  ignore_public_acls      = true\n  block_public_policy     = true\n  restrict_public_buckets = true\n}',
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      if (input.isPublicByDesign) {
        return PASS;
      }

      return factIs(
        input.posture.blockPublicAccess,
        false,
        "Block Public Access is off, or only partly on, for the bucket and its account.",
      );
    },
  },
  {
    id: "internet-reachable",
    group: G.Exposure,
    title: "The database accepts connections from the internet",
    description:
      "The database has a public endpoint or public network access turned on.",
    whyItMatters:
      "A reachable database is one leaked or guessed password away from a breach, and is probed for weak credentials constantly.",
    severityBySensitivity: severities(S.High, S.High, S.Medium, S.Low),
    families: DATABASE_FAMILIES,
    requirements: ACCESS_REQUIREMENTS,
    remediation: {
      [K.AwsRdsInstance]: {
        steps: [
          "Open the instance in the RDS console and choose Modify.",
          "Under Connectivity, set Public access to Not publicly accessible.",
          "Apply immediately or in the next maintenance window.",
        ],
        cli: "aws rds modify-db-instance --db-instance-identifier {name} --no-publicly-accessible --apply-immediately --region {region}",
        terraform:
          'resource "aws_db_instance" "{name}" {\n  # ...\n  publicly_accessible = false\n}',
      },
      [K.AwsRedshiftCluster]: {
        steps: ["Modify the cluster and turn off Publicly accessible."],
        cli: "aws redshift modify-cluster --cluster-identifier {name} --no-publicly-accessible --region {region}",
      },
      [K.AzureSqlDatabase]: {
        steps: [
          "Open the SQL server in the Azure portal and choose Networking.",
          "Set Public network access to Disable and use a private endpoint.",
        ],
        cli: "az sql server update --name {name} --resource-group <group> --enable-public-network false",
      },
      [K.GcpCloudSqlInstance]: {
        steps: [
          "Open the instance in the Cloud console and choose Connections.",
          "Turn off Public IP, and turn on Private IP.",
        ],
        cli: "gcloud sql instances patch {name} --no-assign-ip",
      },
      default: {
        steps: [
          "Turn off the public endpoint, and reach the database through a private network or a bastion.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return factIs(
        input.posture.publicNetworkAccess,
        true,
        "Its network settings accept connections from the internet.",
      );
    },
  },
  {
    id: "open-to-all-addresses",
    group: G.Exposure,
    title: "Its firewall lets in every address",
    description:
      "A firewall rule or authorized network allows 0.0.0.0/0 or the whole address range.",
    whyItMatters:
      "An allow-everything rule removes the network as a layer of defence; only the password stands between the internet and the data.",
    severityBySensitivity: severities(S.Critical, S.Critical, S.High, S.Medium),
    families: DATABASE_FAMILIES,
    requirements: ACCESS_REQUIREMENTS,
    remediation: {
      [K.AzureSqlDatabase]: {
        steps: [
          "Open the SQL server's Networking page and delete the rule that allows 0.0.0.0 to 255.255.255.255.",
          "Add rules only for the addresses that need access, or use a private endpoint.",
        ],
        cli: "az sql server firewall-rule delete --server {name} --resource-group <group> --name <rule>",
      },
      [K.GcpCloudSqlInstance]: {
        steps: [
          "Open the instance's Connections page and remove the 0.0.0.0/0 authorized network.",
        ],
        cli: "gcloud sql instances patch {name} --authorized-networks=<your-cidr>",
      },
      default: {
        steps: [
          "Replace the allow-everything rule with the specific addresses or networks that need access.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return factIs(
        input.posture.openToAllAddresses,
        true,
        "A firewall rule allows connections from every address.",
      );
    },
  },
  {
    id: "snapshot-public",
    group: G.Exposure,
    title: "A snapshot of it can be restored by anyone",
    description:
      "A database snapshot is shared publicly, so any cloud account can restore a full copy.",
    whyItMatters:
      "A public snapshot is a complete copy of the database, handed to anyone who looks.",
    severityBySensitivity: severities(S.Critical, S.Critical, S.Critical, S.High),
    families: [FAM.Database, FAM.Snapshot],
    requirements: ACCESS_REQUIREMENTS,
    remediation: {
      [P.Aws]: {
        steps: [
          "Open the snapshot in the RDS console, choose Actions, then Share snapshot.",
          "Set DB snapshot visibility to Private and save.",
        ],
        cli: "aws rds modify-db-snapshot-attribute --db-snapshot-identifier <snapshot> --attribute-name restore --values-to-remove all --region {region}",
      },
      default: {
        steps: ["Make the snapshot private."],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return factIs(
        input.posture.snapshotPublic,
        true,
        "At least one snapshot is shared with all accounts.",
      );
    },
  },
  {
    id: "snapshot-shared-externally",
    group: G.Exposure,
    title: "A snapshot of it is shared with other accounts",
    description:
      "A database snapshot is shared with accounts outside your connected ones.",
    whyItMatters:
      "Whoever controls that account can restore a full copy of the data, outside every control you have.",
    severityBySensitivity: severities(S.High, S.High, S.Medium, S.Low),
    families: [FAM.Database, FAM.Snapshot],
    requirements: ACCESS_REQUIREMENTS,
    remediation: {
      [P.Aws]: {
        steps: [
          "Open the snapshot in the RDS console, choose Actions, then Share snapshot, and remove the accounts that should not have it.",
        ],
        cli: "aws rds modify-db-snapshot-attribute --db-snapshot-identifier <snapshot> --attribute-name restore --values-to-remove <account-id> --region {region}",
      },
      default: { steps: ["Stop sharing the snapshot with outside accounts."] },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      const shared: ReadonlyArray<string> =
        input.posture.snapshotSharedWith || [];

      if (input.posture.snapshotSharedWith === undefined) {
        return NOT_APPLICABLE;
      }

      return shared.length > 0
        ? fail(`Shared with ${shared.slice(0, 5).join(", ")}.`)
        : PASS;
    },
  },
  {
    id: "shared-with-external-accounts",
    group: G.Exposure,
    title: "Accounts outside your organization can reach it",
    description:
      "The store's policy grants access to accounts, tenants or projects that are not connected to OneUptime.",
    whyItMatters:
      "Access you cannot see the other side of: a vendor's compromised account becomes your breach.",
    severityBySensitivity: severities(S.High, S.High, S.Medium, S.Low),
    families: STORING_FAMILIES,
    requirements: ACCESS_REQUIREMENTS,
    remediation: {
      [K.AwsS3Bucket]: {
        steps: [
          "Open the bucket policy and remove, or narrow with conditions, every statement whose Principal is another account.",
        ],
      },
      default: {
        steps: [
          "Review each outside principal, and remove the ones that do not need access.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      if (input.posture.sharedWithExternal === undefined) {
        return NOT_APPLICABLE;
      }

      const shared: ReadonlyArray<string> = input.posture.sharedWithExternal;

      return shared.length > 0
        ? fail(`Shared with ${shared.slice(0, 5).join(", ")}.`)
        : PASS;
    },
  },

  // Encryption.
  {
    id: "not-encrypted-at-rest",
    group: G.Encryption,
    title: "Its data is not encrypted at rest",
    description: "Storage encryption is turned off.",
    whyItMatters:
      "Disks, backups and snapshots of an unencrypted store can be read by anyone who gets hold of them.",
    severityBySensitivity: severities(S.High, S.Medium, S.Low, null),
    families: STORING_FAMILIES,
    requirements: AT_REST_REQUIREMENTS,
    remediation: {
      [K.AwsRdsInstance]: {
        steps: [
          "RDS cannot encrypt an existing instance in place: take a snapshot, copy it with encryption on, and restore the copy.",
          "Point applications at the restored instance, then delete the old one.",
        ],
        cli: "aws rds copy-db-snapshot --source-db-snapshot-identifier <snapshot> --target-db-snapshot-identifier <snapshot>-encrypted --kms-key-id alias/aws/rds --region {region}",
      },
      [K.AwsRedshiftCluster]: {
        steps: ["Modify the cluster and turn on database encryption."],
        cli: "aws redshift modify-cluster --cluster-identifier {name} --encrypted --region {region}",
      },
      default: { steps: ["Turn on encryption at rest for the store."] },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return factIs(
        input.posture.encryptedAtRest,
        false,
        "Encryption at rest is off.",
      );
    },
  },
  {
    id: "no-customer-managed-key",
    group: G.Encryption,
    title: "Restricted data is not under your own key",
    description:
      "The store holds Restricted data but is encrypted with the provider's default key, not a customer-managed one.",
    whyItMatters:
      "With your own key you can revoke access to every copy at once and see each use of it in your audit log.",
    severityBySensitivity: severities(S.Medium, null, null, null),
    families: STORING_FAMILIES,
    requirements: AT_REST_REQUIREMENTS,
    remediation: {
      [K.AwsS3Bucket]: {
        steps: [
          "Create a KMS key, then set the bucket's default encryption to SSE-KMS with that key.",
        ],
        cli: 'aws s3api put-bucket-encryption --bucket {name} --server-side-encryption-configuration \'{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms","KMSMasterKeyID":"<key-arn>"},"BucketKeyEnabled":true}]}\'',
      },
      default: {
        steps: ["Encrypt the store with a key you manage in your key service."],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return factIs(
        input.posture.customerManagedKey,
        false,
        "It is encrypted with the provider's default key.",
      );
    },
  },
  {
    id: "encryption-in-transit-not-enforced",
    group: G.Encryption,
    title: "Unencrypted connections are allowed",
    description: "The store accepts connections that do not use TLS.",
    whyItMatters:
      "Data sent without TLS can be read and changed by anyone on the network path.",
    severityBySensitivity: severities(S.High, S.Medium, S.Low, null),
    families: STORING_FAMILIES,
    requirements: IN_TRANSIT_REQUIREMENTS,
    remediation: {
      [K.AwsS3Bucket]: {
        steps: [
          "Add a bucket policy statement that denies every request where aws:SecureTransport is false.",
        ],
        terraform:
          'data "aws_iam_policy_document" "{name}_tls" {\n  statement {\n    effect    = "Deny"\n    actions   = ["s3:*"]\n    resources = ["arn:aws:s3:::{name}", "arn:aws:s3:::{name}/*"]\n    principals {\n      type        = "*"\n      identifiers = ["*"]\n    }\n    condition {\n      test     = "Bool"\n      variable = "aws:SecureTransport"\n      values   = ["false"]\n    }\n  }\n}',
      },
      [K.AzureStorageAccount]: {
        steps: ["Turn on Secure transfer required for the storage account."],
        cli: "az storage account update --name {name} --https-only true",
      },
      [K.GcpCloudSqlInstance]: {
        steps: ["Require SSL connections on the instance."],
        cli: "gcloud sql instances patch {name} --ssl-mode=ENCRYPTED_ONLY",
      },
      default: { steps: ["Require TLS for every connection to the store."] },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return factIs(
        input.posture.encryptionInTransitEnforced,
        false,
        "It accepts connections without TLS.",
      );
    },
  },
  {
    id: "weak-tls",
    group: G.Encryption,
    title: "It accepts TLS older than 1.2",
    description: "The minimum TLS version is 1.0 or 1.1.",
    whyItMatters:
      "TLS 1.0 and 1.1 have known weaknesses, and PCI DSS has not allowed them since 2018.",
    severityBySensitivity: severities(S.Medium, S.Medium, S.Low, null),
    families: STORING_FAMILIES,
    requirements: IN_TRANSIT_REQUIREMENTS,
    remediation: {
      [K.AzureStorageAccount]: {
        steps: ["Set the storage account's Minimum TLS version to 1.2."],
        cli: "az storage account update --name {name} --min-tls-version TLS1_2",
      },
      default: { steps: ["Set the minimum TLS version to 1.2 or later."] },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      if (input.posture.minimumTlsVersion === undefined) {
        return NOT_APPLICABLE;
      }

      if (input.posture.minimumTlsVersion === null) {
        return UNKNOWN;
      }

      return tlsVersionNumber(input.posture.minimumTlsVersion) < 1.2
        ? fail(`The minimum TLS version is ${input.posture.minimumTlsVersion}.`)
        : PASS;
    },
  },

  // Recovery.
  {
    id: "no-backups",
    group: G.Recovery,
    title: "It has no backups, or keeps them under 7 days",
    description:
      "Automated backups are off, or kept for fewer than 7 days.",
    whyItMatters:
      "Ransomware, a bad migration or a deleted table is permanent without a backup to restore.",
    severityBySensitivity: severities(S.High, S.Medium, S.Low, null),
    families: [FAM.Database, FAM.Warehouse],
    requirements: RECOVERY_REQUIREMENTS,
    remediation: {
      [K.AwsRdsInstance]: {
        steps: ["Modify the instance and set the backup retention period to at least 7 days."],
        cli: "aws rds modify-db-instance --db-instance-identifier {name} --backup-retention-period 7 --apply-immediately --region {region}",
        terraform:
          'resource "aws_db_instance" "{name}" {\n  # ...\n  backup_retention_period = 7\n}',
      },
      default: { steps: ["Turn on automated backups and keep them for at least 7 days."] },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      if (input.posture.backupsEnabled === false) {
        return fail("Automated backups are off.");
      }

      if (
        typeof input.posture.backupRetentionDays === "number" &&
        input.posture.backupRetentionDays < 7
      ) {
        return fail(
          `Backups are kept for ${input.posture.backupRetentionDays} day(s).`,
        );
      }

      if (
        input.posture.backupsEnabled === undefined &&
        input.posture.backupRetentionDays === undefined
      ) {
        return NOT_APPLICABLE;
      }

      if (
        input.posture.backupsEnabled === null &&
        input.posture.backupRetentionDays === null
      ) {
        return UNKNOWN;
      }

      return PASS;
    },
  },
  {
    id: "no-point-in-time-recovery",
    group: G.Recovery,
    title: "Point-in-time recovery is off",
    description:
      "The table or database cannot be restored to a moment before a mistake.",
    whyItMatters:
      "Daily backups lose a day of data; point-in-time recovery restores to the second before the damage.",
    severityBySensitivity: severities(S.Medium, S.Low, null, null),
    kinds: [K.AwsDynamoDbTable, K.AzureCosmosDbAccount],
    requirements: RECOVERY_REQUIREMENTS,
    remediation: {
      [K.AwsDynamoDbTable]: {
        steps: ["Open the table's Backups tab and turn on point-in-time recovery."],
        cli: "aws dynamodb update-continuous-backups --table-name {name} --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true --region {region}",
        terraform:
          'resource "aws_dynamodb_table" "{name}" {\n  # ...\n  point_in_time_recovery {\n    enabled = true\n  }\n}',
      },
      default: { steps: ["Turn on point-in-time recovery."] },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return factIs(
        input.posture.pointInTimeRecovery,
        false,
        "Point-in-time recovery is off.",
      );
    },
  },
  {
    id: "deletion-protection-off",
    group: G.Recovery,
    title: "It can be deleted in one step",
    description: "Deletion protection is off.",
    whyItMatters:
      "One wrong command or compromised credential deletes the whole database.",
    severityBySensitivity: severities(S.Medium, S.Low, null, null),
    families: [FAM.Database, FAM.Warehouse],
    requirements: RECOVERY_REQUIREMENTS,
    remediation: {
      [K.AwsRdsInstance]: {
        steps: ["Modify the instance and turn on Deletion protection."],
        cli: "aws rds modify-db-instance --db-instance-identifier {name} --deletion-protection --region {region}",
      },
      [K.AwsDynamoDbTable]: {
        steps: ["Turn on deletion protection for the table."],
        cli: "aws dynamodb update-table --table-name {name} --deletion-protection-enabled --region {region}",
      },
      default: { steps: ["Turn on deletion protection."] },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return factIs(
        input.posture.deletionProtection,
        false,
        "Deletion protection is off.",
      );
    },
  },
  {
    id: "deleted-data-not-recoverable",
    group: G.Recovery,
    title: "Deleted or overwritten files cannot be recovered",
    description: "Versioning and soft delete are both off.",
    whyItMatters:
      "Ransomware that overwrites objects, or a script that deletes them, leaves nothing to restore.",
    severityBySensitivity: severities(S.Medium, S.Low, null, null),
    families: [FAM.ObjectStorage],
    requirements: RECOVERY_REQUIREMENTS,
    remediation: {
      [K.AwsS3Bucket]: {
        steps: ["Turn on Bucket Versioning in the bucket's Properties."],
        cli: "aws s3api put-bucket-versioning --bucket {name} --versioning-configuration Status=Enabled",
      },
      [K.AzureStorageAccount]: {
        steps: ["Turn on soft delete for blobs and containers."],
        cli: "az storage account blob-service-properties update --account-name {name} --enable-delete-retention true --delete-retention-days 14",
      },
      [K.GcpStorageBucket]: {
        steps: ["Turn on Object Versioning or a soft delete policy."],
        cli: "gcloud storage buckets update gs://{name} --versioning",
      },
      default: { steps: ["Turn on versioning or soft delete."] },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      const { versioning, softDelete } = input.posture;

      if (versioning === undefined && softDelete === undefined) {
        return NOT_APPLICABLE;
      }

      if (versioning === true || softDelete === true) {
        return PASS;
      }

      if (versioning === null || softDelete === null) {
        return UNKNOWN;
      }

      return fail("Versioning and soft delete are off.");
    },
  },

  // Visibility.
  {
    id: "access-not-logged",
    group: G.Visibility,
    title: "Nobody would know who read it",
    description:
      "Reads of the store are not logged: no access logs, no data-access audit logs.",
    whyItMatters:
      "After a breach you cannot say what was taken or whose data it was, which most breach laws require you to tell.",
    severityBySensitivity: severities(S.High, S.Medium, S.Low, null),
    families: STORING_FAMILIES,
    requirements: LOGGING_REQUIREMENTS,
    remediation: {
      [K.AwsS3Bucket]: {
        steps: [
          "Turn on server access logging in the bucket's Properties, or CloudTrail data events for the bucket.",
        ],
        cli: 'aws s3api put-bucket-logging --bucket {name} --bucket-logging-status \'{"LoggingEnabled":{"TargetBucket":"<log-bucket>","TargetPrefix":"{name}/"}}\'',
      },
      [K.AzureStorageAccount]: {
        steps: [
          "Add a diagnostic setting for the blob service that sends StorageRead logs to a Log Analytics workspace.",
        ],
      },
      [K.GcpStorageBucket]: {
        steps: ["Turn on Data Access audit logs for Cloud Storage."],
      },
      default: { steps: ["Turn on access or audit logging for reads."] },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return factIs(
        input.posture.accessLogging,
        false,
        "Reads of the store are not logged.",
      );
    },
  },

  // Access.
  {
    id: "shared-key-access",
    group: G.Access,
    title: "Anyone with the account key can read everything",
    description:
      "The storage account allows shared key access, which bypasses Microsoft Entra ID and leaves no per-person audit trail.",
    whyItMatters:
      "An account key is a password to every container, and leaks with every copied connection string.",
    severityBySensitivity: severities(S.Medium, S.Low, null, null),
    kinds: [K.AzureStorageAccount],
    requirements: ACCESS_REQUIREMENTS,
    remediation: {
      [K.AzureStorageAccount]: {
        steps: [
          "Move applications to Microsoft Entra ID, then set Allow storage account key access to Disabled.",
        ],
        cli: "az storage account update --name {name} --allow-shared-key-access false",
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return factIs(
        input.posture.sharedKeyAccess,
        true,
        "Shared key access is allowed.",
      );
    },
  },
  {
    id: "object-acls-enabled",
    group: G.Access,
    title: "Objects can carry their own access rules",
    description:
      "Object ACLs are on, so one object can be made public while the bucket looks private.",
    whyItMatters:
      "Per-object rules are invisible in the bucket's policy, and are how single files end up public.",
    severityBySensitivity: severities(S.Low, S.Low, null, null),
    kinds: [K.AwsS3Bucket, K.GcpStorageBucket],
    requirements: ACCESS_REQUIREMENTS,
    remediation: {
      [K.AwsS3Bucket]: {
        steps: ["Set Object Ownership to Bucket owner enforced."],
        cli: "aws s3api put-bucket-ownership-controls --bucket {name} --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'",
      },
      [K.GcpStorageBucket]: {
        steps: ["Turn on uniform bucket-level access."],
        cli: "gcloud storage buckets update gs://{name} --uniform-bucket-level-access",
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return factIs(
        input.posture.uniformAccess,
        false,
        "Object-level access rules are allowed.",
      );
    },
  },
  {
    id: "many-readers",
    group: G.Access,
    title: "More than 25 identities can read Restricted data",
    description:
      "More identities than most teams can review hold read access to the store.",
    whyItMatters:
      "Every reader is a credential that can leak; least privilege is how a single leak stays small.",
    severityBySensitivity: severities(S.Medium, null, null, null),
    families: STORING_FAMILIES,
    requirements: ACCESS_REQUIREMENTS,
    remediation: {
      default: {
        steps: [
          "Open the store's Who can reach it tab, and remove access that is unused or broader than needed.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      if (input.readerCount === undefined || input.readerCount === null) {
        return UNKNOWN;
      }

      return input.readerCount > 25
        ? fail(`${input.readerCount} identities can read it.`)
        : PASS;
    },
  },

  // Data hygiene.
  {
    id: "secrets-stored",
    group: G.Hygiene,
    title: "Secrets are stored in it",
    description:
      "Passwords, API keys, tokens or private keys were found in the store's data.",
    whyItMatters:
      "A secret in a data store is readable by everyone who can read the store, and is copied into every backup and export.",
    severityBySensitivity: severities(S.High, S.High, S.High, S.High),
    families: STORING_FAMILIES,
    requirements: LEAKAGE_REQUIREMENTS,
    remediation: {
      default: {
        steps: [
          "Rotate every secret found: treat it as leaked.",
          "Move secrets to a secret manager (AWS Secrets Manager, Azure Key Vault, Google Secret Manager) and delete them from the store.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      const secrets: Array<string> = input.dataTypeIds.filter(isSecretType);

      if (secrets.length === 0) {
        return PASS;
      }

      const exposure: DataStoreExposure = getDataStoreExposure(input.posture);
      const exposed: boolean =
        exposure === DataStoreExposure.Public ||
        exposure === DataStoreExposure.OtherAccounts;

      return fail(
        `Found ${secrets.length} kind(s) of secret.`,
        exposed ? S.Critical : undefined,
      );
    },
  },
  {
    id: "card-security-codes-stored",
    group: G.Hygiene,
    title: "Card security codes are stored",
    description:
      "CVV or CVC codes were found. PCI DSS forbids keeping them after a payment is authorised, encrypted or not.",
    whyItMatters:
      "A card number with its security code is everything a fraudster needs, and keeping codes breaks PCI DSS outright.",
    severityBySensitivity: severities(S.Critical, S.Critical, S.Critical, S.Critical),
    families: STORING_FAMILIES,
    requirements: [r(CF.PCIDSS, "3.3.1")],
    remediation: {
      default: {
        steps: [
          "Stop the code that writes security codes, delete the stored codes, and confirm none remain in backups.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return input.dataTypeIds.includes("card-verification-code")
        ? fail("Card security codes were found.")
        : PASS;
    },
  },
  {
    id: "card-numbers-readable",
    group: G.Hygiene,
    title: "Card numbers are stored readable",
    description:
      "Full card numbers were found in readable form. PCI DSS requires them to be unreadable wherever they are stored.",
    whyItMatters:
      "Readable card numbers put the store, and everything that can reach it, in PCI DSS scope.",
    severityBySensitivity: severities(S.High, S.High, S.High, S.High),
    families: STORING_FAMILIES,
    requirements: [r(CF.PCIDSS, "3.5.1"), r(CF.PCIDSS, "3.4.1")],
    remediation: {
      default: {
        steps: [
          "Tokenize card numbers with your payment provider, or store them encrypted at the field level, and delete the readable copies.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return input.dataTypeIds.includes("credit-card-number")
        ? fail("Readable card numbers were found.")
        : PASS;
    },
  },
  {
    id: "plaintext-passwords",
    group: G.Hygiene,
    title: "Passwords are stored in plain text",
    description:
      "A password field holds values that are not password hashes (bcrypt, argon2, scrypt or PBKDF2).",
    whyItMatters:
      "One read of this store hands over every user's password, and with password reuse, their other accounts.",
    severityBySensitivity: severities(S.Critical, S.Critical, S.Critical, S.Critical),
    families: STORING_FAMILIES,
    requirements: [
      r(CF.GDPR, "Art. 32"),
      r(CF.PCIDSS, "8.3.2"),
      r(CF.ISO27001, "A.8.24"),
      r(CF.SOC2, "CC6.1"),
    ],
    remediation: {
      default: {
        steps: [
          "Hash passwords with bcrypt, scrypt or argon2 at sign-up and sign-in, migrate the stored ones, and force a reset for every account.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      const fields: ReadonlyArray<string> = input.plaintextPasswordFields || [];

      return fields.length > 0
        ? fail(`Plain-text passwords in ${fields.slice(0, 3).join(", ")}.`)
        : PASS;
    },
  },
  {
    id: "production-data-in-non-production",
    group: G.Hygiene,
    title: "Production data was copied into a non-production store",
    description:
      "Values found in a production store were also found here, in a development, test or staging store.",
    whyItMatters:
      "Non-production stores are rarely guarded like production ones, so copies of real customer data leak from them most.",
    severityBySensitivity: severities(S.High, S.Medium, null, null),
    families: STORING_FAMILIES,
    requirements: MINIMISATION_REQUIREMENTS,
    remediation: {
      default: {
        steps: [
          "Replace the copy with masked or synthetic data, and delete the real data from the non-production store.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      if (!isNonProduction(input.environment)) {
        return NOT_APPLICABLE;
      }

      return input.copiedFromProductionStoreName
        ? fail(`It holds copies of data from ${input.copiedFromProductionStoreName}.`)
        : PASS;
    },
  },
  {
    id: "stale-sensitive-data",
    group: G.Hygiene,
    title: "Sensitive data nobody has used in 90 days",
    description:
      "The store holds sensitive data and has had no reads or writes for 90 days.",
    whyItMatters:
      "Data you no longer use is pure risk; GDPR's storage limitation principle says to delete it.",
    severityBySensitivity: severities(S.Medium, S.Low, null, null),
    families: STORING_FAMILIES,
    requirements: [r(CF.GDPR, "Art. 5(1)(e)"), ...MINIMISATION_REQUIREMENTS],
    remediation: {
      default: {
        steps: [
          "Confirm the data is no longer needed, then archive it with a retention date, or delete it.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      if (!input.lastActivityAt) {
        return UNKNOWN;
      }

      const now: Date = input.now || new Date();
      const idleDays: number = Math.floor(
        (now.getTime() - input.lastActivityAt.getTime()) / 86_400_000,
      );

      return idleDays >= 90 ? fail(`No activity for ${idleDays} days.`) : PASS;
    },
  },
  {
    id: "no-owner",
    group: G.Hygiene,
    title: "Nobody owns this sensitive store",
    description: "The store holds sensitive data and has no owner.",
    whyItMatters:
      "An issue on a store nobody owns is an issue nobody fixes. Owner rules assign owners from tags.",
    severityBySensitivity: severities(S.Medium, S.Low, null, null),
    requirements: [r(CF.ISO27001, "A.5.9"), r(CF.NISTCSF, "ID.AM-07")],
    remediation: {
      default: {
        steps: [
          "Add an owner on the store's Owners tab, or an owner rule under Data Security > Settings that matches its tags.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return input.hasOwner ? PASS : fail("It has no owner.");
    },
  },

  // Telemetry.
  {
    id: "sensitive-data-in-telemetry",
    group: G.Telemetry,
    title: "Sensitive data is reaching your telemetry",
    description:
      "Logs, traces, exceptions, replays or AI conversations carry sensitive data that no scrub rule masks.",
    whyItMatters:
      "Telemetry is copied to many places and read by many people; personal data in it widens every privacy obligation.",
    severityBySensitivity: severities(S.High, S.Medium, S.Low, null),
    families: [FAM.Telemetry],
    requirements: [...MINIMISATION_REQUIREMENTS, r(CF.PCIDSS, "3.4.1")],
    remediation: {
      default: {
        steps: [
          "Press Scrub It on each finding to mask that data at ingest from now on.",
          "Fix the code that writes it: the finding names the service and the attribute.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      const unscrubbed: ReadonlyArray<string> = (
        input.unscrubbedDataTypeIds || []
      ).filter((dataTypeId: string) => {
        return !isSecretType(dataTypeId);
      });

      return unscrubbed.length > 0
        ? fail(`${unscrubbed.length} kind(s) of sensitive data are not scrubbed.`)
        : PASS;
    },
  },
  {
    id: "secrets-in-telemetry",
    group: G.Telemetry,
    title: "Secrets are reaching your telemetry",
    description:
      "Passwords, API keys or tokens appear in logs, traces, exceptions or AI conversations.",
    whyItMatters:
      "Anyone who can read the telemetry can use the secret; rotate it and stop the code that logs it.",
    severityBySensitivity: severities(S.Critical, S.Critical, S.Critical, S.Critical),
    families: [FAM.Telemetry],
    requirements: LEAKAGE_REQUIREMENTS,
    remediation: {
      default: {
        steps: [
          "Rotate the secret first: it has been seen by everyone who can read this telemetry.",
          "Press Scrub It to mask it at ingest, then fix the code that writes it.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      const secrets: Array<string> = (input.unscrubbedDataTypeIds || []).filter(
        isSecretType,
      );

      return secrets.length > 0
        ? fail(`${secrets.length} kind(s) of secret are not scrubbed.`)
        : PASS;
    },
  },

  // Residency.
  {
    id: "residency-violation",
    group: G.Residency,
    title: "Data is stored outside the regions it may live in",
    description:
      "The store's region, or a region its data is replicated to, breaks a residency rule.",
    whyItMatters:
      "Personal data moved outside its allowed regions can be an unlawful transfer under GDPR and similar laws.",
    severityBySensitivity: severities(S.High, S.High, S.Medium, null),
    families: STORING_FAMILIES,
    requirements: [r(CF.GDPR, "Arts. 44-49"), r(CF.LGPD, "Art. 33"), r(CF.DPDP, "Sec. 16")],
    remediation: {
      default: {
        steps: [
          "Move the data to an allowed region, or stop replicating it to the disallowed one.",
          "If the transfer is lawful (for example under standard contractual clauses), accept the issue and record the basis.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      const violations: ReadonlyArray<{ ruleName: string; region: string }> =
        input.residencyViolations || [];

      if (violations.length === 0) {
        return PASS;
      }

      const first: { ruleName: string; region: string } = violations[0]!;

      return fail(`${first.region} is outside what "${first.ruleName}" allows.`);
    },
  },

  // AI.
  {
    id: "sensitive-data-to-ai",
    group: G.AI,
    title: "Sensitive data is being sent to an AI provider",
    description:
      "AI conversations recorded in OneUptime carry sensitive data to a model provider.",
    whyItMatters:
      "Data sent to a model provider leaves your control, may be retained, and is a transfer to a processor.",
    severityBySensitivity: severities(S.Critical, S.High, S.Low, null),
    kinds: [K.TelemetryAiConversations],
    requirements: [...MINIMISATION_REQUIREMENTS, r(CF.GDPR, "Art. 28")],
    remediation: {
      default: {
        steps: [
          "Redact sensitive values before prompts are sent, or route these calls to a model you host.",
          "Press Scrub It to stop storing the values in OneUptime's copy of the conversation.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      const providers: ReadonlyArray<string> = input.aiProvidersReached || [];

      if (input.dataTypeIds.length === 0) {
        return PASS;
      }

      return fail(
        providers.length > 0
          ? `Sent to ${providers.slice(0, 3).join(", ")}.`
          : "Found in prompts or responses.",
      );
    },
  },
  {
    id: "sensitive-data-in-ai-store",
    group: G.AI,
    title: "Restricted data is in a store used for AI",
    description:
      "A store tagged as AI training or retrieval data holds Restricted data.",
    whyItMatters:
      "Models and retrieval indexes can repeat what they were given to anyone who asks the right question.",
    severityBySensitivity: severities(S.High, S.Medium, null, null),
    families: STORING_FAMILIES,
    requirements: MINIMISATION_REQUIREMENTS,
    remediation: {
      default: {
        steps: [
          "Remove or mask the Restricted data before it is used to train or ground a model.",
        ],
      },
    },
    evaluate: (input: DataStoreCheckInput): DataSecurityCheckResult => {
      return input.isAiData ? fail("It is tagged for AI use.") : NOT_APPLICABLE;
    },
  },
];

const CHECKS_BY_ID: ReadonlyMap<string, DataSecurityCheckInfo> = new Map(
  DATA_SECURITY_CHECKS.map((check: DataSecurityCheckInfo) => {
    return [check.id, check];
  }),
);

export function getDataSecurityCheck(
  id: string,
): DataSecurityCheckInfo | undefined {
  return CHECKS_BY_ID.get(id);
}

// Whether a check applies to a store of this kind at all.
export function checkAppliesToKind(
  check: DataSecurityCheckInfo,
  kind: DataStoreKind,
): boolean {
  const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(kind);

  if (check.kinds && !check.kinds.includes(kind)) {
    return false;
  }

  if (check.families && (!info || !check.families.includes(info.family))) {
    return false;
  }

  return true;
}

// How to fix a check's failure on a store of this kind.
export function getCheckRemediation(
  check: DataSecurityCheckInfo,
  kind: DataStoreKind,
): CheckRemediation | undefined {
  const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(kind);

  return (
    check.remediation[kind] ||
    (info ? check.remediation[info.provider] : undefined) ||
    check.remediation.default
  );
}

/*
 * Fills a remediation's {placeholders} with the store's values. Values are
 * inserted as they are; the page shows the result as code, never as markup.
 */
export function fillRemediationText(
  text: string,
  values: { name: string; region?: string | undefined },
): string {
  return text
    .split("{name}")
    .join(values.name)
    .split("{region}")
    .join(values.region || "<region>");
}

export interface EvaluatedCheck {
  check: DataSecurityCheckInfo;
  result: DataSecurityCheckResult;
  // The issue's severity when it fails, or null when it is no issue.
  severity: SecuritySeverity | null;
}

/*
 * Runs every applicable check on a store. A failing check whose severity
 * for the store's sensitivity is null - a public bucket holding nothing
 * sensitive is only Low, a missing backup of public data is nothing - is
 * reported with a null severity and opens no issue.
 */
export function evaluateDataStoreChecks(
  input: DataStoreCheckInput,
  options: {
    disabledCheckIds?: ReadonlySet<string> | undefined;
    severityOverrides?:
      | ReadonlyMap<string, SecuritySeverity>
      | undefined;
  } = {},
): Array<EvaluatedCheck> {
  const results: Array<EvaluatedCheck> = [];

  for (const check of DATA_SECURITY_CHECKS) {
    if (
      options.disabledCheckIds?.has(check.id) ||
      !checkAppliesToKind(check, input.kind)
    ) {
      continue;
    }

    let result: DataSecurityCheckResult;

    try {
      result = check.evaluate(input);
    } catch {
      result = UNKNOWN;
    }

    let severity: SecuritySeverity | null = null;

    if (result.status === DataSecurityCheckStatus.Fail) {
      severity =
        options.severityOverrides?.get(check.id) ||
        result.severity ||
        check.severityBySensitivity[input.sensitivity];
    }

    results.push({ check, result, severity });
  }

  return results;
}
