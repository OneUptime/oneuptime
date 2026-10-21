import Crypto from "../../Utils/Crypto";
import { CloudProvider } from "../Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "./CloudConnectionCatalog";

/*
 * THE ONE COMMAND EACH CLOUD'S SETUP STEP SHOWS.
 *
 * Connecting a cloud takes one paste: the customer opens their cloud's own
 * browser terminal (AWS CloudShell, Azure Cloud Shell, Google Cloud Shell),
 * runs the command shown, and pastes back what it printed. Each command
 * creates access that can only read, and nothing else:
 *
 *   - AWS, IAM role: a role trusting this OneUptime's AWS account with an
 *     external id only this project's connections use, with an inline
 *     policy of three read actions. Prints the role's ARN.
 *   - AWS, access key: a user with the same policy, and an access key.
 *     Prints the key.
 *   - Azure: an app registration (service principal) with the built-in
 *     Monitoring Reader role on the current subscription. Prints its app
 *     id, password and tenant.
 *   - Google Cloud: a service account with the built-in Monitoring Viewer
 *     role on the current project, and a JSON key. Prints the key.
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
 * Every AWS action a connection uses. Reading metrics and their dimensions,
 * and the Name tags of the resources they are about - nothing that reads
 * data, configuration or secrets, and nothing that writes.
 */
export const AWS_READ_ONLY_ACTIONS: Array<string> = [
  "cloudwatch:GetMetricData",
  "cloudwatch:ListMetrics",
  "tag:GetResources",
];

// The built-in roles Azure and Google Cloud connections are given.
export const AZURE_READ_ONLY_ROLE: string = "Monitoring Reader";
export const GCP_READ_ONLY_ROLE: string = "roles/monitoring.viewer";

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

export function getAwsReadOnlyPolicyDocument(): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: AWS_READ_ONLY_ACTIONS,
        Resource: "*",
      },
    ],
  });
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
}): string {
  const role: string = getAwsRoleNameForExternalId(data.externalId);
  const trust: string = getAwsTrustPolicyDocument(data);

  return [
    `ROLE=${role}`,
    `TRUST='${trust}'`,
    `aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" > /dev/null 2>&1 || aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"`,
    `aws iam put-role-policy --role-name "$ROLE" --policy-name ${CLOUD_CONNECTION_READ_ONLY_NAME} --policy-document '${getAwsReadOnlyPolicyDocument()}'`,
    `aws iam get-role --role-name "$ROLE" --query Role.Arn --output text`,
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

export function getAzureSetupCommand(): string {
  return `az ad sp create-for-rbac --name ${CLOUD_CONNECTION_READ_ONLY_NAME} --role "${AZURE_READ_ONLY_ROLE}" --scopes "/subscriptions/$(az account show --query id --output tsv)"`;
}

export function getGcpSetupCommand(): string {
  const member: string = `${GCP_SERVICE_ACCOUNT_ID}@$PROJECT_ID.iam.gserviceaccount.com`;

  return [
    "PROJECT_ID=$(gcloud config get-value project)",
    "gcloud services enable monitoring.googleapis.com",
    `gcloud iam service-accounts create ${GCP_SERVICE_ACCOUNT_ID} --display-name "OneUptime (read only)"`,
    `gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${member}" --role ${GCP_READ_ONLY_ROLE} --condition=None > /dev/null`,
    `gcloud iam service-accounts keys create oneuptime-key.json --iam-account "${member}"`,
    "cat oneuptime-key.json && rm oneuptime-key.json",
  ].join("\n");
}

export interface CloudConnectionCommandContext {
  // AWS role only: what the role trusts (CloudConnectionAwsRoleSetup).
  trustedPrincipalArn?: string | undefined;
  externalId?: string | undefined;
}

/*
 * The command for a cloud and sign-in method, or undefined when it cannot
 * be written yet (an AWS role before this OneUptime's AWS identity is
 * known).
 */
export function getCloudConnectionSetupCommand(
  provider: CloudProvider,
  method: CloudConnectionAuthMethod,
  context: CloudConnectionCommandContext = {},
): string | undefined {
  if (provider === CloudProvider.AWS) {
    if (method === CloudConnectionAuthMethod.AwsRole) {
      if (!context.trustedPrincipalArn || !context.externalId) {
        return undefined;
      }

      return getAwsRoleSetupCommand({
        trustedPrincipalArn: context.trustedPrincipalArn,
        externalId: context.externalId,
      });
    }

    return getAwsAccessKeySetupCommand();
  }

  if (provider === CloudProvider.Azure) {
    return getAzureSetupCommand();
  }

  return getGcpSetupCommand();
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
