import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import { isAwsRoleArn } from "../../../Types/CloudConnection/CloudConnectionPaste";
import {
  AWS_READ_ONLY_ACTIONS,
  AZURE_READ_ONLY_ROLE,
  CLOUD_CONNECTION_READ_ONLY_NAME,
  GCP_READ_ONLY_ROLE,
  GCP_SERVICE_ACCOUNT_ID,
  getAwsAccessKeySetupCommand,
  getAwsExternalIdForProject,
  getAwsReadOnlyPolicyDocument,
  getAwsRoleNameForExternalId,
  getAwsRoleSetupCommand,
  getAwsTrustPolicyDocument,
  getAzureSetupCommand,
  getCloudConnectionSetupCommand,
  getGcpSetupCommand,
} from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { describe, expect, test } from "@jest/globals";

/*
 * The one command each cloud's setup step shows creates access that can
 * only read - and these hold it to that: the AWS policy names three read
 * actions and nothing else, the role trusts this OneUptime with this
 * project's own external id only, Azure's app gets the built-in Monitoring
 * Reader role, Google Cloud's service account Monitoring Viewer. Each
 * command can be run again.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT: string = "22222222-2222-4222-8222-222222222222";
const TRUSTED: string = "arn:aws:iam::999988887777:root";

// The JSON between the first pair of single quotes after a flag.
function quotedAfter(command: string, flag: string): string {
  const flagAt: number = command.indexOf(flag);
  const start: number = command.indexOf("'", flagAt);
  const end: number = command.indexOf("'", start + 1);
  return command.slice(start + 1, end);
}

describe("the external id", () => {
  test("is the same for a project every time, and differs between projects", () => {
    expect(getAwsExternalIdForProject(PROJECT)).toBe(
      getAwsExternalIdForProject(PROJECT),
    );
    expect(getAwsExternalIdForProject(PROJECT)).not.toBe(
      getAwsExternalIdForProject(OTHER_PROJECT),
    );
  });

  test("ignores case and spaces in the project id", () => {
    expect(getAwsExternalIdForProject(` ${PROJECT.toUpperCase()} `)).toBe(
      getAwsExternalIdForProject(PROJECT),
    );
  });

  test("names OneUptime and does not carry the project id itself", () => {
    const externalId: string = getAwsExternalIdForProject(PROJECT);

    expect(externalId.startsWith("oneuptime-")).toBe(true);
    expect(externalId).toHaveLength("oneuptime-".length + 32);
    expect(externalId).not.toContain(PROJECT.slice(0, 8));
  });

  test("gives each project's role a name of its own", () => {
    const one: string = getAwsRoleNameForExternalId(
      getAwsExternalIdForProject(PROJECT),
    );
    const two: string = getAwsRoleNameForExternalId(
      getAwsExternalIdForProject(OTHER_PROJECT),
    );

    expect(one.startsWith(`${CLOUD_CONNECTION_READ_ONLY_NAME}-`)).toBe(true);
    expect(one).not.toBe(two);
    // IAM role names are at most 64 characters.
    expect(one.length).toBeLessThanOrEqual(64);
    expect(getAwsRoleNameForExternalId("custom")).toBe(
      `${CLOUD_CONNECTION_READ_ONLY_NAME}-custom`,
    );
  });
});

describe("AWS", () => {
  test("the policy allows the three read actions on everything, and nothing else", () => {
    expect(JSON.parse(getAwsReadOnlyPolicyDocument())).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "cloudwatch:GetMetricData",
            "cloudwatch:ListMetrics",
            "tag:GetResources",
          ],
          Resource: "*",
        },
      ],
    });
    for (const action of AWS_READ_ONLY_ACTIONS) {
      expect(action).toMatch(/:(Get|List)/);
    }
  });

  test("the trust policy names the principal and requires the external id", () => {
    expect(
      JSON.parse(
        getAwsTrustPolicyDocument({
          trustedPrincipalArn: TRUSTED,
          externalId: "oneuptime-abc",
        }),
      ),
    ).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: TRUSTED },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "sts:ExternalId": "oneuptime-abc" } },
        },
      ],
    });
  });

  test("the role command creates or updates the role, puts the read policy on it and prints its ARN last", () => {
    const externalId: string = getAwsExternalIdForProject(PROJECT);
    const role: string = getAwsRoleNameForExternalId(externalId);
    const command: string = getAwsRoleSetupCommand({
      trustedPrincipalArn: TRUSTED,
      externalId,
    });
    const lines: Array<string> = command.split("\n");

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(`aws iam create-role --role-name ${role} `);
    // Run again: the trust policy is updated rather than failing.
    expect(lines[0]).toContain(
      `|| aws iam update-assume-role-policy --role-name ${role} `,
    );
    expect(
      JSON.parse(quotedAfter(lines[0]!, "--assume-role-policy-document")),
    ).toEqual(
      JSON.parse(
        getAwsTrustPolicyDocument({ trustedPrincipalArn: TRUSTED, externalId }),
      ),
    );
    expect(lines[1]).toContain(`aws iam put-role-policy --role-name ${role}`);
    expect(JSON.parse(quotedAfter(lines[1]!, "--policy-document"))).toEqual(
      JSON.parse(getAwsReadOnlyPolicyDocument()),
    );
    expect(lines[2]).toBe(
      `aws iam get-role --role-name ${role} --query Role.Arn --output text`,
    );
  });

  test("the access key command creates the user once, puts the read policy on it and prints a key", () => {
    const lines: Array<string> = getAwsAccessKeySetupCommand().split("\n");

    expect(lines).toEqual([
      `aws iam create-user --user-name ${CLOUD_CONNECTION_READ_ONLY_NAME} > /dev/null 2>&1 || true`,
      expect.stringContaining(
        `aws iam put-user-policy --user-name ${CLOUD_CONNECTION_READ_ONLY_NAME} --policy-name ${CLOUD_CONNECTION_READ_ONLY_NAME}`,
      ),
      `aws iam create-access-key --user-name ${CLOUD_CONNECTION_READ_ONLY_NAME}`,
    ]);
    expect(JSON.parse(quotedAfter(lines[1]!, "--policy-document"))).toEqual(
      JSON.parse(getAwsReadOnlyPolicyDocument()),
    );
  });

  test("no command holds a secret or a placeholder to fill in", () => {
    for (const command of [
      getAwsAccessKeySetupCommand(),
      getAwsRoleSetupCommand({
        trustedPrincipalArn: TRUSTED,
        externalId: getAwsExternalIdForProject(PROJECT),
      }),
      getAzureSetupCommand(),
      getGcpSetupCommand(),
    ]) {
      expect(command).not.toMatch(/<[A-Z_]+>/);
      expect(command).not.toContain("${");
    }
  });
});

describe("Azure", () => {
  test("creates an app with Monitoring Reader on the subscription the shell is in", () => {
    expect(getAzureSetupCommand()).toBe(
      `az ad sp create-for-rbac --name ${CLOUD_CONNECTION_READ_ONLY_NAME} --role "Monitoring Reader" --scopes "/subscriptions/$(az account show --query id --output tsv)"`,
    );
    expect(AZURE_READ_ONLY_ROLE).toBe("Monitoring Reader");
  });
});

describe("Google Cloud", () => {
  test("turns on Cloud Monitoring, creates the service account, grants Monitoring Viewer and prints a key it then deletes", () => {
    const lines: Array<string> = getGcpSetupCommand().split("\n");
    const member: string = `${GCP_SERVICE_ACCOUNT_ID}@$PROJECT_ID.iam.gserviceaccount.com`;

    expect(lines).toEqual([
      "PROJECT_ID=$(gcloud config get-value project)",
      "gcloud services enable monitoring.googleapis.com",
      `gcloud iam service-accounts create ${GCP_SERVICE_ACCOUNT_ID} --display-name "OneUptime (read only)"`,
      `gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${member}" --role ${GCP_READ_ONLY_ROLE} --condition=None > /dev/null`,
      `gcloud iam service-accounts keys create oneuptime-key.json --iam-account "${member}"`,
      "cat oneuptime-key.json && rm oneuptime-key.json",
    ]);
    expect(GCP_READ_ONLY_ROLE).toBe("roles/monitoring.viewer");
  });
});

describe("getCloudConnectionSetupCommand", () => {
  test("each cloud and method gets its own command", () => {
    const externalId: string = getAwsExternalIdForProject(PROJECT);

    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsAccessKey,
      ),
    ).toBe(getAwsAccessKeySetupCommand());
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsRole,
        { trustedPrincipalArn: TRUSTED, externalId },
      ),
    ).toBe(getAwsRoleSetupCommand({ trustedPrincipalArn: TRUSTED, externalId }));
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.Azure,
        CloudConnectionAuthMethod.AzureClientSecret,
      ),
    ).toBe(getAzureSetupCommand());
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.GCP,
        CloudConnectionAuthMethod.GcpServiceAccountKey,
      ),
    ).toBe(getGcpSetupCommand());
  });

  test("an AWS role command waits for what the role trusts", () => {
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsRole,
      ),
    ).toBeUndefined();
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsRole,
        { trustedPrincipalArn: TRUSTED },
      ),
    ).toBeUndefined();
  });

  test("the role the command creates is one the form accepts", () => {
    const externalId: string = getAwsExternalIdForProject(PROJECT);

    expect(
      isAwsRoleArn(
        `arn:aws:iam::123456789012:role/${getAwsRoleNameForExternalId(externalId)}`,
      ),
    ).toBe(true);
  });
});
