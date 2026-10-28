import Crypto from "../../Utils/Crypto";
import { CloudProvider } from "../Cloud/CloudPlatform";
import {
  CloudConnectionAuthMethod,
  CloudConnectionDataSecurityLevel,
  CloudConnectionDataSecurityResponse,
  isCloudConnectionDataSecurityResponseOn,
} from "./CloudConnectionCatalog";

/*
 * THE ONE COMMAND EACH CLOUD'S SETUP STEP SHOWS.
 *
 * Connecting a cloud takes one paste: the customer opens their cloud's own
 * browser terminal (AWS CloudShell, Azure Cloud Shell, Google Cloud Shell),
 * runs the command shown, and pastes back what it printed. Each command
 * creates access that can only read - metrics, the resources and how they
 * are configured, what changed and the provider's health events, never
 * data or secrets - and nothing more than a connection uses:
 *
 *   - AWS, IAM role: a role trusting this OneUptime's AWS account with an
 *     external id only this project's connections use, with an inline
 *     read-only policy (AWS_READ_ONLY_ACTION_GROUPS). Prints the role's ARN.
 *     For a whole organization, the same role in every account through a
 *     CloudFormation StackSet of this project's own, and in the management
 *     account itself - the one role that may also list the organization's
 *     accounts (AWS_ORGANIZATION_ACTION_GROUP).
 *   - AWS, access key: a user with the same policy, and an access key.
 *     Prints the key.
 *   - Azure: an app registration (service principal) with the built-in
 *     Monitoring Reader role on the current subscription - or on the
 *     tenant's root management group, for every subscription. Prints its
 *     app id, password, tenant and when the password expires.
 *   - Google Cloud: a service account with the built-in Monitoring Viewer,
 *     Cloud Asset Viewer, Logs Viewer and Service Health Viewer roles on the
 *     current project - or on its organization, for every project - and a
 *     JSON key. Prints the key.
 *
 * Each can be run again: a role, a user or a service account that is
 * already there is updated, not duplicated.
 *
 * Data Security's access is opt-in, per connection (the dataSecurity
 * setting, CloudConnectionDataSecurityLevel), and added by the same command
 * only when it is asked for - with it off, every command is exactly the
 * one described above. See "DATA SECURITY'S OPT-IN ACCESS" below. So is
 * the one write a command ever grants, on a setting of its own
 * (dataSecurityResponse): closing a data store's exposure. See "DATA
 * SECURITY RESPONSE" below.
 *
 * The dashboard shows these, the docs page shows the same ones
 * (CloudConnectDocsFacts holds them equal), and the server checks that a
 * role to assume carries this project's external id.
 */

// What every resource OneUptime creates in a customer's cloud is called.
export const CLOUD_CONNECTION_READ_ONLY_NAME: string = "OneUptimeReadOnly";
export const GCP_SERVICE_ACCOUNT_ID: string = "oneuptime-read-only";

/*
 * Whom one command gives access: the account the shell is in, or every
 * account of its organization (an AWS Organization, an Azure tenant, a
 * Google Cloud organization).
 */
export enum CloudConnectionSetupScope {
  Account = "account",
  Organization = "organization",
}

export interface AwsReadOnlyActionGroup {
  // What OneUptime reads with them, in the reader's words.
  purpose: string;
  actions: Array<string>;
}

/*
 * Every AWS action a connection uses, by what it is for. Each reads; none
 * reads data (an object, a row, a message) or a secret, and none writes.
 * Listing a resource type through Cloud Control calls that service's own
 * List or Describe action as the role, which is why those are here.
 */
export const AWS_READ_ONLY_ACTION_GROUPS: Array<AwsReadOnlyActionGroup> = [
  {
    purpose: "Find the resources that report metrics, and read their metrics",
    actions: ["cloudwatch:GetMetricData", "cloudwatch:ListMetrics"],
  },
  {
    purpose: "Name each resource and read its tags",
    actions: ["tag:GetResources", "iam:ListAccountAliases"],
  },
  {
    purpose:
      "List every resource and how it is configured, through Cloud Control",
    actions: [
      "cloudformation:ListResources",
      "ec2:DescribeInstances",
      "ec2:DescribeVolumes",
      "ec2:DescribeVpcs",
      "ec2:DescribeNatGateways",
      "autoscaling:DescribeAutoScalingGroups",
      "elasticloadbalancing:DescribeLoadBalancers",
      "elasticloadbalancing:DescribeLoadBalancerAttributes",
      "elasticloadbalancing:DescribeTargetGroups",
      "elasticloadbalancing:DescribeTargetGroupAttributes",
      "elasticloadbalancing:DescribeTargetHealth",
      "elasticloadbalancing:DescribeTags",
      "ecs:ListClusters",
      "ecs:DescribeClusters",
      "ecs:ListServices",
      "ecs:DescribeServices",
      "lambda:ListFunctions",
      "rds:DescribeDBInstances",
      "rds:DescribeDBClusters",
      "elasticache:DescribeReplicationGroups",
      "sqs:ListQueues",
      "sqs:GetQueueAttributes",
      "sns:ListTopics",
      "sns:GetTopicAttributes",
      "sns:ListSubscriptionsByTopic",
      "dynamodb:ListTables",
      "dynamodb:DescribeTable",
      "kinesis:ListStreams",
      "kinesis:DescribeStreamSummary",
      "states:ListStateMachines",
      "states:DescribeStateMachine",
      "cloudfront:ListDistributions",
      "elasticfilesystem:DescribeFileSystems",
      "es:ListDomainNames",
      "es:DescribeDomains",
      "apprunner:ListServices",
      "apprunner:DescribeService",
      "apigateway:GET",
    ],
  },
  {
    purpose: "Read what changed: the account's management events",
    actions: ["cloudtrail:LookupEvents"],
  },
  {
    purpose: "Read AWS's own health events for the account",
    actions: ["health:DescribeEvents", "health:DescribeEventDetails"],
  },
];

/*
 * What only the organization's management account's role may do besides:
 * list the accounts the other roles are in. Never in an account's own
 * role, nor in the roles the StackSet puts in every member account.
 */
export const AWS_ORGANIZATION_ACTION_GROUP: AwsReadOnlyActionGroup = {
  purpose: "List the organization's accounts, from its management account",
  actions: ["organizations:ListAccounts"],
};

export const AWS_READ_ONLY_ACTIONS: Array<string> =
  AWS_READ_ONLY_ACTION_GROUPS.flatMap(
    (group: AwsReadOnlyActionGroup): Array<string> => {
      return group.actions;
    },
  );

/*
 * Actions allowed only on some resources. API Gateway's reads are one
 * action for every path, so it is allowed on the APIs' own definitions
 * only - never on /apikeys, which can return a key's value.
 */
export const AWS_SCOPED_READ_RESOURCES: Record<string, Array<string>> = {
  "apigateway:GET": [
    "arn:aws:apigateway:*::/restapis",
    "arn:aws:apigateway:*::/restapis/*",
    "arn:aws:apigateway:*::/apis",
    "arn:aws:apigateway:*::/apis/*",
  ],
};

// The built-in roles Azure and Google Cloud connections are given.
export const AZURE_READ_ONLY_ROLE: string = "Monitoring Reader";
export const GCP_READ_ONLY_ROLE: string = "roles/monitoring.viewer";
export const GCP_INVENTORY_ROLE: string = "roles/cloudasset.viewer";
export const GCP_AUDIT_LOG_ROLE: string = "roles/logging.viewer";
export const GCP_SERVICE_HEALTH_ROLE: string = "roles/servicehealth.viewer";
export const GCP_READ_ONLY_ROLES: Array<string> = [
  GCP_READ_ONLY_ROLE,
  GCP_INVENTORY_ROLE,
  GCP_AUDIT_LOG_ROLE,
  GCP_SERVICE_HEALTH_ROLE,
];
// The Google Cloud APIs a connection calls, turned on by the command.
export const GCP_SERVICES: Array<string> = [
  "monitoring.googleapis.com",
  "cloudasset.googleapis.com",
  "logging.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "servicehealth.googleapis.com",
];

/*
 * DATA SECURITY'S OPT-IN ACCESS: what each level adds to a cloud's command.
 *
 *   - "configuration": how every data store is set up - who can reach it,
 *     how it is encrypted, backed up, logged and copied. Still no data and
 *     no secret.
 *       AWS: a second inline policy, OneUptimeDataSecurity, with exactly
 *       the read actions the data security reader calls
 *       (AWS_DATA_SECURITY_CONFIGURATION_ACTIONS).
 *       Azure: nothing more. Monitoring Reader's wildcard read action
 *       reads every resource's configuration through Azure Resource
 *       Manager.
 *       Google Cloud: nothing more. Cloud Asset Viewer reads every
 *       resource's configuration and IAM policy.
 *   - "content": that, and samples of what the stores hold, to find
 *     sensitive data in them.
 *       AWS: the same policy, with s3:ListBucket and s3:GetObject on every
 *       bucket, and kms:Decrypt only as S3 asks for it (an object
 *       encrypted with a KMS key).
 *       Azure: Storage Blob Data Reader, on the same scope.
 *       Google Cloud: Storage Object Viewer and BigQuery Data Viewer, and
 *       the BigQuery API turned on.
 *
 * Choosing a lower level later and running the command again replaces the
 * AWS policy with the lower one; "off" adds nothing, so it leaves what an
 * earlier command granted until it is removed (aws iam delete-role-policy
 * --policy-name OneUptimeDataSecurity).
 */

export const AWS_DATA_SECURITY_POLICY_NAME: string = "OneUptimeDataSecurity";

/*
 * Every AWS action the data security reader calls (AwsDataSecurityReader),
 * by what it is for. Each reads a setting; none reads data or writes. A
 * few are in the read-only policy too: this one stands on its own.
 * organizations:ListAccounts, which an organization's read also calls,
 * stays in the management account's role alone.
 */
export const AWS_DATA_SECURITY_CONFIGURATION_ACTION_GROUPS: Array<AwsReadOnlyActionGroup> =
  [
    {
      purpose:
        "List the buckets, and read who can reach each one and how it is encrypted, versioned, logged, copied and tagged",
      actions: [
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicyStatus",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetAccountPublicAccessBlock",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketVersioning",
        "s3:GetBucketLogging",
        "s3:GetBucketOwnershipControls",
        "s3:GetReplicationConfiguration",
        "s3:GetBucketTagging",
      ],
    },
    {
      purpose:
        "Read how the databases are reached, encrypted and backed up, and whom their manual snapshots are shared with",
      actions: [
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "rds:DescribeDBSnapshots",
        "rds:DescribeDBSnapshotAttributes",
        "rds:DescribeDBClusterSnapshots",
        "rds:DescribeDBClusterSnapshotAttributes",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "redshift:DescribeClusters",
        "redshift:DescribeLoggingStatus",
      ],
    },
    {
      purpose:
        "Read how the search domains, caches and file systems are set up",
      actions: [
        "es:ListDomainNames",
        "es:DescribeDomains",
        "elasticache:DescribeReplicationGroups",
        "elasticfilesystem:DescribeFileSystems",
      ],
    },
    {
      purpose: "Tell AWS's own keys (alias/aws/...) from the keys you manage",
      actions: ["kms:ListAliases"],
    },
  ];

export const AWS_DATA_SECURITY_CONFIGURATION_ACTIONS: Array<string> =
  AWS_DATA_SECURITY_CONFIGURATION_ACTION_GROUPS.flatMap(
    (group: AwsReadOnlyActionGroup): Array<string> => {
      return group.actions;
    },
  );

// What "content" adds: reading objects, and the KMS key they are encrypted with.
export const AWS_DATA_SECURITY_CONTENT_ACTIONS: Array<string> = [
  "s3:ListBucket",
  "s3:GetObject",
  "kms:Decrypt",
];

// Where each content action is allowed: buckets, their objects, any key.
export const AWS_DATA_SECURITY_CONTENT_RESOURCES: Record<string, string> = {
  "s3:ListBucket": "arn:aws:s3:::*",
  "s3:GetObject": "arn:aws:s3:::*/*",
  "kms:Decrypt": "*",
};

/*
 * kms:Decrypt only when S3 asks for it, reading an object encrypted with a
 * KMS key: never a direct decrypt of anything else the key protects.
 */
export const AWS_DATA_SECURITY_KMS_CONDITION: Record<
  string,
  Record<string, string>
> = {
  StringLike: { "kms:ViaService": "s3.*.amazonaws.com" },
};

/*
 * Azure: "configuration" needs nothing beyond Monitoring Reader (its
 * wildcard read action covers every Azure Resource Manager read);
 * "content" adds the built-in role that reads blobs.
 */
export const AZURE_DATA_SECURITY_CONTENT_ROLE: string =
  "Storage Blob Data Reader";

/*
 * Google Cloud: "configuration" needs nothing beyond the roles above
 * (Cloud Asset Viewer reads IAM policies and resource data); "content"
 * adds these roles and the API they read through.
 */
export const GCP_DATA_SECURITY_CONTENT_ROLES: Array<string> = [
  "roles/storage.objectViewer",
  "roles/bigquery.dataViewer",
];
export const GCP_DATA_SECURITY_CONTENT_SERVICES: Array<string> = [
  "bigquery.googleapis.com",
];

function isDataSecurityOn(
  level: CloudConnectionDataSecurityLevel | undefined,
): boolean {
  return level === "configuration" || level === "content";
}

export interface AwsPolicyStatement {
  Effect: string;
  Action: Array<string>;
  Resource: string | Array<string>;
  Condition?: Record<string, Record<string, string>> | undefined;
}

/*
 * The data security policy for a level, or null when it is off: the
 * configuration reads on every resource, and - for content - each content
 * action on its own resources, kms:Decrypt with its condition.
 */
export function getAwsDataSecurityPolicy(
  level: CloudConnectionDataSecurityLevel | undefined,
): { Version: string; Statement: Array<AwsPolicyStatement> } | null {
  if (!isDataSecurityOn(level)) {
    return null;
  }

  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [...AWS_DATA_SECURITY_CONFIGURATION_ACTIONS],
        Resource: "*",
      },
      ...(level === "content"
        ? AWS_DATA_SECURITY_CONTENT_ACTIONS.map(
            (action: string): AwsPolicyStatement => {
              return {
                Effect: "Allow",
                Action: [action],
                Resource: AWS_DATA_SECURITY_CONTENT_RESOURCES[action]!,
                ...(action === "kms:Decrypt"
                  ? { Condition: AWS_DATA_SECURITY_KMS_CONDITION }
                  : {}),
              };
            },
          )
        : []),
    ],
  };
}

// The policy as the commands write it; "" when data security is off.
export function getAwsDataSecurityPolicyDocument(
  level: CloudConnectionDataSecurityLevel | undefined,
): string {
  const policy: ReturnType<typeof getAwsDataSecurityPolicy> =
    getAwsDataSecurityPolicy(level);

  return policy ? JSON.stringify(policy) : "";
}

/*
 * DATA SECURITY RESPONSE: the one write any command grants, on its own
 * setting (dataSecurityResponse) and only when it is "block" - Security
 * Operations playbooks closing a data store's exposure, each run approved
 * by a person unless the playbook says otherwise (AwsDataSecurityResponse).
 * Nothing it grants deletes, reads data, or changes who may sign in.
 *
 *   AWS: a third inline policy, OneUptimeDataSecurityResponse: read and
 *     turn on a bucket's Block Public Access, read and narrow whom an RDS
 *     manual snapshot is shared with.
 *   Azure: a custom role, OneUptime Data Security Response, that reads and
 *     updates storage accounts' settings (public blob access, network
 *     access) on the same scope - never their keys.
 *   Google Cloud: a custom role, oneuptimeDataSecurityResponse, that reads
 *     and updates buckets' settings (public access prevention), on the
 *     project or organization the command targets.
 */
export const AWS_DATA_SECURITY_RESPONSE_POLICY_NAME: string =
  "OneUptimeDataSecurityResponse";

export const AWS_DATA_SECURITY_RESPONSE_ACTIONS: Array<string> = [
  "s3:GetBucketPublicAccessBlock",
  "s3:PutBucketPublicAccessBlock",
  "rds:DescribeDBSnapshotAttributes",
  "rds:DescribeDBClusterSnapshotAttributes",
  "rds:ModifyDBSnapshotAttribute",
  "rds:ModifyDBClusterSnapshotAttribute",
];

export const AZURE_DATA_SECURITY_RESPONSE_ROLE: string =
  "OneUptime Data Security Response";

// Reading and updating a storage account's settings; never listKeys.
export const AZURE_DATA_SECURITY_RESPONSE_ACTIONS: Array<string> = [
  "Microsoft.Storage/storageAccounts/read",
  "Microsoft.Storage/storageAccounts/write",
];

export const GCP_DATA_SECURITY_RESPONSE_ROLE_ID: string =
  "oneuptimeDataSecurityResponse";

export const GCP_DATA_SECURITY_RESPONSE_PERMISSIONS: Array<string> = [
  "storage.buckets.get",
  "storage.buckets.update",
];

// The response policy, or null when the setting is not "block".
export function getAwsDataSecurityResponsePolicy(
  response: CloudConnectionDataSecurityResponse | undefined,
): { Version: string; Statement: Array<AwsPolicyStatement> } | null {
  if (!isCloudConnectionDataSecurityResponseOn(response)) {
    return null;
  }

  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [...AWS_DATA_SECURITY_RESPONSE_ACTIONS],
        Resource: "*",
      },
    ],
  };
}

// The response policy as the commands write it; "" when it is off.
export function getAwsDataSecurityResponsePolicyDocument(
  response: CloudConnectionDataSecurityResponse | undefined,
): string {
  const policy: ReturnType<typeof getAwsDataSecurityResponsePolicy> =
    getAwsDataSecurityResponsePolicy(response);

  return policy ? JSON.stringify(policy) : "";
}

/*
 * Azure's custom role, as az role definition takes it: built by jq in the
 * shell, where the scope it may be assigned at ($SCOPE) is known.
 */
function getAzureResponseRoleLines(): Array<string> {
  const actions: string = AZURE_DATA_SECURITY_RESPONSE_ACTIONS.map(
    (action: string): string => {
      return `"${action}"`;
    },
  ).join(", ");

  return [
    `RESPONSE_ROLE=$(jq -n --arg scope "$SCOPE" '{Name: "${AZURE_DATA_SECURITY_RESPONSE_ROLE}", IsCustom: true, Description: "OneUptime: turn off public access to storage accounts. Never lists their keys.", Actions: [${actions}], NotActions: [], AssignableScopes: [$scope]}')`,
    `az role definition create --role-definition "$RESPONSE_ROLE" > /dev/null 2>&1 || az role definition update --role-definition "$RESPONSE_ROLE" > /dev/null`,
    `az role assignment create --assignee "$APP" --role "${AZURE_DATA_SECURITY_RESPONSE_ROLE}" --scope "$SCOPE" > /dev/null`,
  ];
}

const EXTERNAL_ID_PREFIX: string = "oneuptime-";

/*
 * The external id an AWS role trusts OneUptime with, for one project.
 *
 * AWS asks a third party that assumes customers' roles to use an external
 * id it chooses, unique per customer, so nobody can make it assume a role
 * that was made for someone else (the "confused deputy"). This one is
 * derived from the project and nothing a request carries: a connection is
 * always read with its own project's external id, so a role ARN copied
 * from another project fails to assume - its trust policy names a
 * different id. It is not a secret.
 */
export function getAwsExternalIdForProject(projectId: string): string {
  return `${EXTERNAL_ID_PREFIX}${Crypto.getSha256Hash(
    `cloud-connection-aws-external-id:${projectId.trim().toLowerCase()}`,
  ).slice(0, 32)}`;
}

/*
 * The role a project's command creates: one per project, so connecting one
 * AWS account to two projects makes two roles instead of one trusting only
 * the project that ran the command last.
 */
export function getAwsRoleNameForExternalId(externalId: string): string {
  const suffix: string = externalId.startsWith(EXTERNAL_ID_PREFIX)
    ? externalId.slice(EXTERNAL_ID_PREFIX.length, EXTERNAL_ID_PREFIX.length + 8)
    : externalId.slice(0, 8);

  return `${CLOUD_CONNECTION_READ_ONLY_NAME}-${suffix}`;
}

/*
 * The StackSet that puts the role in every account of an AWS Organization:
 * one per project, named like the project's role, so a second project that
 * connects the same organization adds its own roles instead of replacing
 * the first project's.
 */
export function getAwsOrganizationStackSetName(externalId: string): string {
  return getAwsRoleNameForExternalId(externalId);
}

/*
 * The read-only policy as an object, for the commands and the template.
 * An organization's management account's role (organization: true) may
 * also list the organization's accounts.
 */
export function getAwsReadOnlyPolicy(
  options: { organization?: boolean | undefined } = {},
): {
  Version: string;
  Statement: Array<{
    Effect: string;
    Action: Array<string>;
    Resource: string | Array<string>;
  }>;
} {
  const scoped: Array<string> = Object.keys(AWS_SCOPED_READ_RESOURCES);

  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          ...AWS_READ_ONLY_ACTIONS.filter((action: string): boolean => {
            return !scoped.includes(action);
          }),
          ...(options.organization
            ? AWS_ORGANIZATION_ACTION_GROUP.actions
            : []),
        ],
        Resource: "*",
      },
      ...scoped.map(
        (
          action: string,
        ): {
          Effect: string;
          Action: Array<string>;
          Resource: Array<string>;
        } => {
          return {
            Effect: "Allow",
            Action: [action],
            Resource: AWS_SCOPED_READ_RESOURCES[action]!,
          };
        },
      ),
    ],
  };
}

export function getAwsReadOnlyPolicyDocument(
  options: { organization?: boolean | undefined } = {},
): string {
  return JSON.stringify(getAwsReadOnlyPolicy(options));
}

export function getAwsTrustPolicyDocument(data: {
  trustedPrincipalArn: string;
  externalId: string;
}): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: data.trustedPrincipalArn },
        Action: "sts:AssumeRole",
        Condition: { StringEquals: { "sts:ExternalId": data.externalId } },
      },
    ],
  });
}

/*
 * The role and what it trusts are set first, once each, so the command
 * reads top to bottom - who may sign in, under which external id - and the
 * trust policy is written out once rather than in both of the calls that
 * use it.
 */
export function getAwsRoleSetupCommand(data: {
  trustedPrincipalArn: string;
  externalId: string;
  // The organization's management account's role: it also lists the accounts.
  organization?: boolean | undefined;
  // Data Security's policy beside the read-only one; none when off or absent.
  dataSecurity?: CloudConnectionDataSecurityLevel | undefined;
  // The response policy, a third; none unless "block".
  dataSecurityResponse?: CloudConnectionDataSecurityResponse | undefined;
}): string {
  const role: string = getAwsRoleNameForExternalId(data.externalId);
  const trust: string = getAwsTrustPolicyDocument(data);

  return [
    `ROLE=${role}`,
    `TRUST='${trust}'`,
    `aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" > /dev/null 2>&1 || aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"`,
    `aws iam put-role-policy --role-name "$ROLE" --policy-name ${CLOUD_CONNECTION_READ_ONLY_NAME} --policy-document '${getAwsReadOnlyPolicyDocument({ organization: data.organization })}'`,
    ...(isDataSecurityOn(data.dataSecurity)
      ? [
          `aws iam put-role-policy --role-name "$ROLE" --policy-name ${AWS_DATA_SECURITY_POLICY_NAME} --policy-document '${getAwsDataSecurityPolicyDocument(data.dataSecurity)}'`,
        ]
      : []),
    ...(isCloudConnectionDataSecurityResponseOn(data.dataSecurityResponse)
      ? [
          `aws iam put-role-policy --role-name "$ROLE" --policy-name ${AWS_DATA_SECURITY_RESPONSE_POLICY_NAME} --policy-document '${getAwsDataSecurityResponsePolicyDocument(data.dataSecurityResponse)}'`,
        ]
      : []),
    `aws iam get-role --role-name "$ROLE" --query Role.Arn --output text`,
  ].join("\n");
}

/*
 * The CloudFormation template of the role: what a StackSet puts in every
 * account of an organization, and what a team that keeps its IAM in
 * CloudFormation deploys itself.
 */
export function getAwsReadOnlyRoleTemplate(data: {
  trustedPrincipalArn: string;
  externalId: string;
  // Data Security's policy beside the read-only one; none when off or absent.
  dataSecurity?: CloudConnectionDataSecurityLevel | undefined;
  // The response policy, a third; none unless "block".
  dataSecurityResponse?: CloudConnectionDataSecurityResponse | undefined;
}): string {
  const dataSecurity: ReturnType<typeof getAwsDataSecurityPolicy> =
    getAwsDataSecurityPolicy(data.dataSecurity);
  const response: ReturnType<typeof getAwsDataSecurityResponsePolicy> =
    getAwsDataSecurityResponsePolicy(data.dataSecurityResponse);
  const reads: string =
    data.dataSecurity === "content"
      ? ", and its data stores' configuration and samples of their content"
      : dataSecurity
        ? ", and its data stores' configuration"
        : "";
  const writes: string = response
    ? "; it may also block a data store's public access and sharing"
    : "";

  return JSON.stringify({
    AWSTemplateFormatVersion: "2010-09-09",
    Description: `OneUptime: a role that can only read this account's metrics, resources, changes and health events${reads}${writes}.`,
    Resources: {
      OneUptimeReadOnlyRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: getAwsRoleNameForExternalId(data.externalId),
          AssumeRolePolicyDocument: JSON.parse(getAwsTrustPolicyDocument(data)),
          Policies: [
            {
              PolicyName: CLOUD_CONNECTION_READ_ONLY_NAME,
              PolicyDocument: getAwsReadOnlyPolicy(),
            },
            ...(dataSecurity
              ? [
                  {
                    PolicyName: AWS_DATA_SECURITY_POLICY_NAME,
                    PolicyDocument: dataSecurity,
                  },
                ]
              : []),
            ...(response
              ? [
                  {
                    PolicyName: AWS_DATA_SECURITY_RESPONSE_POLICY_NAME,
                    PolicyDocument: response,
                  },
                ]
              : []),
          ],
        },
      },
    },
    Outputs: {
      RoleArn: {
        Value: { "Fn::GetAtt": ["OneUptimeReadOnlyRole", "Arn"] },
      },
    },
  });
}

/*
 * A whole AWS Organization, from its management account: StackSets'
 * trusted access to the organization turned on (nothing happens when it
 * is on already), the role in every member account (a service-managed
 * StackSet of this project's own that also reaches accounts added later),
 * then in the management account itself, whose ARN it prints. IAM is
 * global, so the StackSet deploys to one Region.
 */
export function getAwsOrganizationSetupCommand(data: {
  trustedPrincipalArn: string;
  externalId: string;
  // Data Security's policy in every account's role; none when off or absent.
  dataSecurity?: CloudConnectionDataSecurityLevel | undefined;
  // The response policy in every account's role; none unless "block".
  dataSecurityResponse?: CloudConnectionDataSecurityResponse | undefined;
}): string {
  const stackSet: string = getAwsOrganizationStackSetName(data.externalId);

  return [
    `cat > oneuptime-read-only.json <<'TEMPLATE'`,
    getAwsReadOnlyRoleTemplate(data),
    "TEMPLATE",
    `aws cloudformation activate-organizations-access > /dev/null 2>&1 || true`,
    `aws cloudformation create-stack-set --stack-set-name ${stackSet} --template-body file://oneuptime-read-only.json --capabilities CAPABILITY_NAMED_IAM --permission-model SERVICE_MANAGED --auto-deployment Enabled=true,RetainStacksOnAccountRemoval=false > /dev/null 2>&1 || aws cloudformation update-stack-set --stack-set-name ${stackSet} --template-body file://oneuptime-read-only.json --capabilities CAPABILITY_NAMED_IAM > /dev/null`,
    `aws cloudformation create-stack-instances --stack-set-name ${stackSet} --deployment-targets OrganizationalUnitIds=$(aws organizations list-roots --query "Roots[0].Id" --output text) --regions us-east-1 > /dev/null 2>&1 || true`,
    getAwsRoleSetupCommand({ ...data, organization: true }),
  ].join("\n");
}

/*
 * IAM holds a user's inline policies to 2,048 characters in all, and the
 * read-only policy takes most of them, so the access key's user gets Data
 * Security's policies - reading, and the response's - through a group of
 * its own (a group's inline policies may total 5,120): created once, its
 * policies put again on every run.
 */
export const AWS_DATA_SECURITY_GROUP_NAME: string =
  AWS_DATA_SECURITY_POLICY_NAME;

export function getAwsAccessKeySetupCommand(
  options: {
    dataSecurity?: CloudConnectionDataSecurityLevel | undefined;
    dataSecurityResponse?: CloudConnectionDataSecurityResponse | undefined;
  } = {},
): string {
  const user: string = CLOUD_CONNECTION_READ_ONLY_NAME;
  const group: string = AWS_DATA_SECURITY_GROUP_NAME;
  const reads: boolean = isDataSecurityOn(options.dataSecurity);
  const responds: boolean = isCloudConnectionDataSecurityResponseOn(
    options.dataSecurityResponse,
  );

  return [
    `aws iam create-user --user-name ${user} > /dev/null 2>&1 || true`,
    `aws iam put-user-policy --user-name ${user} --policy-name ${CLOUD_CONNECTION_READ_ONLY_NAME} --policy-document '${getAwsReadOnlyPolicyDocument()}'`,
    ...(reads || responds
      ? [`aws iam create-group --group-name ${group} > /dev/null 2>&1 || true`]
      : []),
    ...(reads
      ? [
          `aws iam put-group-policy --group-name ${group} --policy-name ${AWS_DATA_SECURITY_POLICY_NAME} --policy-document '${getAwsDataSecurityPolicyDocument(options.dataSecurity)}'`,
        ]
      : []),
    ...(responds
      ? [
          `aws iam put-group-policy --group-name ${group} --policy-name ${AWS_DATA_SECURITY_RESPONSE_POLICY_NAME} --policy-document '${getAwsDataSecurityResponsePolicyDocument(options.dataSecurityResponse)}'`,
        ]
      : []),
    ...(reads || responds
      ? [`aws iam add-user-to-group --user-name ${user} --group-name ${group}`]
      : []),
    `aws iam create-access-key --user-name ${user}`,
  ].join("\n");
}

/*
 * Azure: the app, its role on the scope, and what it printed with the
 * password's expiry added, so OneUptime can say before the password stops
 * working. The tenant's root management group is named after the tenant.
 */
export function getAzureSetupCommand(
  scope: CloudConnectionSetupScope = CloudConnectionSetupScope.Account,
  // "content" adds Storage Blob Data Reader on the same scope; the others nothing.
  dataSecurity: CloudConnectionDataSecurityLevel = "off",
  // "block" adds the response's custom role, made for and assigned on the same scope.
  dataSecurityResponse: CloudConnectionDataSecurityResponse = "off",
): string {
  const scopeLine: string =
    scope === CloudConnectionSetupScope.Organization
      ? `SCOPE="/providers/Microsoft.Management/managementGroups/$(az account show --query tenantId --output tsv)"`
      : `SCOPE="/subscriptions/$(az account show --query id --output tsv)"`;

  return [
    scopeLine,
    `OUT=$(az ad sp create-for-rbac --name ${CLOUD_CONNECTION_READ_ONLY_NAME} --role "${AZURE_READ_ONLY_ROLE}" --scopes "$SCOPE")`,
    `APP=$(echo "$OUT" | jq -r .appId)`,
    ...(dataSecurity === "content"
      ? [
          `az role assignment create --assignee "$APP" --role "${AZURE_DATA_SECURITY_CONTENT_ROLE}" --scope "$SCOPE" > /dev/null`,
        ]
      : []),
    ...(isCloudConnectionDataSecurityResponseOn(dataSecurityResponse)
      ? getAzureResponseRoleLines()
      : []),
    `END=$(az ad app credential list --id "$APP" --query "max([].endDateTime)" --output tsv)`,
    `echo "$OUT" | jq --arg end "$END" '. + {endDateTime: $end}'`,
  ].join("\n");
}

/*
 * Google Cloud: the APIs a connection calls, the service account, its
 * roles on the project - or on the project's organization, for every
 * project - and a key it prints and then deletes from the shell.
 */
export function getGcpSetupCommand(
  scope: CloudConnectionSetupScope = CloudConnectionSetupScope.Account,
  // "content" adds the object and dataset readers and the BigQuery API; the others nothing.
  dataSecurity: CloudConnectionDataSecurityLevel = "off",
  // "block" adds the response's custom role, made where the command binds roles.
  dataSecurityResponse: CloudConnectionDataSecurityResponse = "off",
): string {
  const member: string = `${GCP_SERVICE_ACCOUNT_ID}@$PROJECT_ID.iam.gserviceaccount.com`;
  const organization: boolean =
    scope === CloudConnectionSetupScope.Organization;
  const bind: (role: string) => string = (role: string): string => {
    return organization
      ? `gcloud organizations add-iam-policy-binding "$ORG_ID" --member "serviceAccount:${member}" --role ${role} --condition=None > /dev/null`
      : `gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${member}" --role ${role} --condition=None > /dev/null`;
  };
  const content: boolean = dataSecurity === "content";
  // The custom role lives where it is bound: the project, or the organization.
  const roleHome: string = organization
    ? `--organization "$ORG_ID"`
    : `--project "$PROJECT_ID"`;
  const responseRole: string = organization
    ? `organizations/$ORG_ID/roles/${GCP_DATA_SECURITY_RESPONSE_ROLE_ID}`
    : `projects/$PROJECT_ID/roles/${GCP_DATA_SECURITY_RESPONSE_ROLE_ID}`;
  const permissions: string = GCP_DATA_SECURITY_RESPONSE_PERMISSIONS.join(",");
  const responseLines: Array<string> = isCloudConnectionDataSecurityResponseOn(
    dataSecurityResponse,
  )
    ? [
        `gcloud iam roles create ${GCP_DATA_SECURITY_RESPONSE_ROLE_ID} ${roleHome} --title "OneUptime Data Security Response" --description "OneUptime: turn on public access prevention for buckets." --permissions ${permissions} --stage GA --quiet > /dev/null 2>&1 || gcloud iam roles update ${GCP_DATA_SECURITY_RESPONSE_ROLE_ID} ${roleHome} --permissions ${permissions} --quiet > /dev/null`,
        bind(responseRole),
      ]
    : [];

  return [
    "PROJECT_ID=$(gcloud config get-value project)",
    ...(scope === CloudConnectionSetupScope.Organization
      ? [
          `ORG_ID=$(gcloud projects get-ancestors "$PROJECT_ID" --format="value(id)" | tail -1)`,
        ]
      : []),
    `gcloud services enable ${[
      ...GCP_SERVICES,
      ...(content ? GCP_DATA_SECURITY_CONTENT_SERVICES : []),
    ].join(" ")}`,
    `gcloud iam service-accounts create ${GCP_SERVICE_ACCOUNT_ID} --display-name "OneUptime (read only)" > /dev/null 2>&1 || true`,
    ...GCP_READ_ONLY_ROLES.map(bind),
    ...(content ? GCP_DATA_SECURITY_CONTENT_ROLES.map(bind) : []),
    ...responseLines,
    `gcloud iam service-accounts keys create oneuptime-key.json --iam-account "${member}"`,
    "cat oneuptime-key.json && rm oneuptime-key.json",
  ].join("\n");
}

export interface CloudConnectionCommandContext {
  // AWS role only: what the role trusts (CloudConnectionAwsRoleSetup).
  trustedPrincipalArn?: string | undefined;
  externalId?: string | undefined;
  // One account, or the whole organization. One account when absent.
  scope?: CloudConnectionSetupScope | undefined;
  // What Data Security may read (the connection's dataSecurity setting). Off when absent.
  dataSecurity?: CloudConnectionDataSecurityLevel | undefined;
  // Whether playbooks may close an exposure (dataSecurityResponse). Off when absent.
  dataSecurityResponse?: CloudConnectionDataSecurityResponse | undefined;
}

/*
 * The command for a cloud and sign-in method, or undefined when it cannot
 * be written yet (an AWS role before this OneUptime's AWS identity is
 * known). An AWS organization is read through roles only: an access key's
 * user cannot sign in to the member accounts' roles.
 */
export function getCloudConnectionSetupCommand(
  provider: CloudProvider,
  method: CloudConnectionAuthMethod,
  context: CloudConnectionCommandContext = {},
): string | undefined {
  const scope: CloudConnectionSetupScope =
    context.scope || CloudConnectionSetupScope.Account;
  const dataSecurity: CloudConnectionDataSecurityLevel =
    context.dataSecurity || "off";
  const dataSecurityResponse: CloudConnectionDataSecurityResponse =
    context.dataSecurityResponse || "off";

  if (provider === CloudProvider.AWS) {
    if (method === CloudConnectionAuthMethod.AwsRole) {
      if (!context.trustedPrincipalArn || !context.externalId) {
        return undefined;
      }

      const role: {
        trustedPrincipalArn: string;
        externalId: string;
        dataSecurity: CloudConnectionDataSecurityLevel;
        dataSecurityResponse: CloudConnectionDataSecurityResponse;
      } = {
        trustedPrincipalArn: context.trustedPrincipalArn,
        externalId: context.externalId,
        dataSecurity,
        dataSecurityResponse,
      };

      return scope === CloudConnectionSetupScope.Organization
        ? getAwsOrganizationSetupCommand(role)
        : getAwsRoleSetupCommand(role);
    }

    return getAwsAccessKeySetupCommand({ dataSecurity, dataSecurityResponse });
  }

  if (provider === CloudProvider.Azure) {
    return getAzureSetupCommand(scope, dataSecurity, dataSecurityResponse);
  }

  return getGcpSetupCommand(scope, dataSecurity, dataSecurityResponse);
}

/*
 * Whether a cloud and sign-in method can be set up for a whole
 * organization: Azure and Google Cloud always, AWS through a role.
 */
export function canSetUpOrganization(
  provider: CloudProvider,
  method: CloudConnectionAuthMethod,
): boolean {
  if (provider === CloudProvider.AWS) {
    return method === CloudConnectionAuthMethod.AwsRole;
  }

  return true;
}

/*
 * What the server tells the form about AWS roles: whether this OneUptime
 * can assume one (it has an AWS identity of its own), the principal a
 * role must trust, and the external id this project's roles carry.
 */
export interface CloudConnectionAwsRoleSetup {
  isAvailable: boolean;
  trustedPrincipalArn?: string | undefined;
  externalId: string;
}
