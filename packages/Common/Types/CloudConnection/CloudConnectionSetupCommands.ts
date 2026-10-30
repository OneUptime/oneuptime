import Crypto from "../../Utils/Crypto";
import { CloudProvider } from "../Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "./CloudConnectionCatalog";

/*
 * THE ONE COMMAND EACH CLOUD'S SETUP STEP SHOWS.
 *
 * Connecting a cloud takes one paste: the customer opens their cloud's own
 * browser terminal (AWS CloudShell, Azure Cloud Shell, Google Cloud Shell),
 * runs the command shown, and pastes back what it printed. Each command
 * creates access that can only read - metrics, the resources and how they
 * are configured, what changed, the provider's health events, and, while
 * OneUptime AI investigates, a resource's live status, recent events and
 * quotas - and nothing more than a connection uses. OneUptime reads no
 * data or secrets with it but for one thing: a resource's log lines, which
 * can hold data, and which it reads only for an account whose AI log
 * reading someone turned on.
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
 * The one group that reads data: a resource's recent log lines, which can
 * hold anything an application logs. OneUptime reads them only while it
 * investigates an account whose AI log reading someone turned on; until
 * then its read-logs live read is off, and these two actions go unused.
 */
export const AWS_LOG_READ_ACTION_GROUP: AwsReadOnlyActionGroup = {
  purpose: "Read log lines, only when you let AI read an account's logs",
  actions: ["logs:DescribeLogGroups", "logs:FilterLogEvents"],
};

/*
 * Every AWS action a connection uses, by what it is for. Each reads, and
 * none writes. None reads data (an object, a row, a message) or a secret
 * store, but for the log lines of AWS_LOG_READ_ACTION_GROUP. Configuration
 * is what a team wrote into it, though: a Lambda function's and a task
 * definition's environment variables come with theirs.
 *
 * Listing a resource type through Cloud Control calls that service's own
 * List or Describe action as the role, which is why those are here. The
 * groups after the health events are the live reads an investigation
 * makes (the cloud catalog's describe, recent-events, quota-usage and
 * read-logs), which run on the server through this connection.
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
  {
    purpose:
      "Read a resource's live status and recent events during an investigation",
    actions: [
      "rds:DescribeEvents",
      "autoscaling:DescribeScalingActivities",
      "ec2:DescribeInstanceStatus",
      "ecs:DescribeTaskDefinition",
      "lambda:GetFunctionConfiguration",
      "lambda:GetFunctionConcurrency",
      "lambda:GetAlias",
    ],
  },
  {
    purpose: "Read the account's quotas during an investigation",
    actions: ["servicequotas:ListServiceQuotas"],
  },
  AWS_LOG_READ_ACTION_GROUP,
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

/*
 * The built-in roles Azure and Google Cloud connections are given. They
 * already cover an investigation's live reads: Monitoring Reader may read
 * every resource provider's settings, which takes in the Resource Manager
 * reads, Resource Health, the Activity Log, Compute usages and a
 * resource's Log Analytics query; the four Google Cloud roles take in
 * Cloud Asset's search, Logging's entries and Cloud Monitoring's time
 * series.
 */
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
}): string {
  const role: string = getAwsRoleNameForExternalId(data.externalId);
  const trust: string = getAwsTrustPolicyDocument(data);

  return [
    `ROLE=${role}`,
    `TRUST='${trust}'`,
    `aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" > /dev/null 2>&1 || aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"`,
    `aws iam put-role-policy --role-name "$ROLE" --policy-name ${CLOUD_CONNECTION_READ_ONLY_NAME} --policy-document '${getAwsReadOnlyPolicyDocument({ organization: data.organization })}'`,
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
}): string {
  return JSON.stringify({
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "OneUptime: a role that can only read this account's metrics, resources, changes and health events.",
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

export function getAwsAccessKeySetupCommand(): string {
  const user: string = CLOUD_CONNECTION_READ_ONLY_NAME;

  return [
    `aws iam create-user --user-name ${user} > /dev/null 2>&1 || true`,
    `aws iam put-user-policy --user-name ${user} --policy-name ${CLOUD_CONNECTION_READ_ONLY_NAME} --policy-document '${getAwsReadOnlyPolicyDocument()}'`,
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
): string {
  const scopeLine: string =
    scope === CloudConnectionSetupScope.Organization
      ? `SCOPE="/providers/Microsoft.Management/managementGroups/$(az account show --query tenantId --output tsv)"`
      : `SCOPE="/subscriptions/$(az account show --query id --output tsv)"`;

  return [
    scopeLine,
    `OUT=$(az ad sp create-for-rbac --name ${CLOUD_CONNECTION_READ_ONLY_NAME} --role "${AZURE_READ_ONLY_ROLE}" --scopes "$SCOPE")`,
    `APP=$(echo "$OUT" | jq -r .appId)`,
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
): string {
  const member: string = `${GCP_SERVICE_ACCOUNT_ID}@$PROJECT_ID.iam.gserviceaccount.com`;
  const bind: (role: string) => string = (role: string): string => {
    return scope === CloudConnectionSetupScope.Organization
      ? `gcloud organizations add-iam-policy-binding "$ORG_ID" --member "serviceAccount:${member}" --role ${role} --condition=None > /dev/null`
      : `gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${member}" --role ${role} --condition=None > /dev/null`;
  };

  return [
    "PROJECT_ID=$(gcloud config get-value project)",
    ...(scope === CloudConnectionSetupScope.Organization
      ? [
          `ORG_ID=$(gcloud projects get-ancestors "$PROJECT_ID" --format="value(id)" | tail -1)`,
        ]
      : []),
    `gcloud services enable ${GCP_SERVICES.join(" ")}`,
    `gcloud iam service-accounts create ${GCP_SERVICE_ACCOUNT_ID} --display-name "OneUptime (read only)" > /dev/null 2>&1 || true`,
    ...GCP_READ_ONLY_ROLES.map(bind),
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

  if (provider === CloudProvider.AWS) {
    if (method === CloudConnectionAuthMethod.AwsRole) {
      if (!context.trustedPrincipalArn || !context.externalId) {
        return undefined;
      }

      const role: { trustedPrincipalArn: string; externalId: string } = {
        trustedPrincipalArn: context.trustedPrincipalArn,
        externalId: context.externalId,
      };

      return scope === CloudConnectionSetupScope.Organization
        ? getAwsOrganizationSetupCommand(role)
        : getAwsRoleSetupCommand(role);
    }

    return getAwsAccessKeySetupCommand();
  }

  if (provider === CloudProvider.Azure) {
    return getAzureSetupCommand(scope);
  }

  return getGcpSetupCommand(scope);
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
