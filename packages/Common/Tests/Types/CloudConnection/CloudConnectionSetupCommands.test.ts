import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import { isAwsRoleArn } from "../../../Types/CloudConnection/CloudConnectionPaste";
import {
  AWS_LOG_READ_ACTION_GROUP,
  AWS_ORGANIZATION_ACTION_GROUP,
  AWS_READ_ONLY_ACTIONS,
  AWS_READ_ONLY_ACTION_GROUPS,
  AWS_SCOPED_READ_RESOURCES,
  AZURE_READ_ONLY_ROLE,
  CLOUD_CONNECTION_READ_ONLY_NAME,
  CloudConnectionSetupScope,
  GCP_AUDIT_LOG_ROLE,
  GCP_INVENTORY_ROLE,
  GCP_READ_ONLY_ROLE,
  GCP_READ_ONLY_ROLES,
  GCP_SERVICES,
  GCP_SERVICE_ACCOUNT_ID,
  canSetUpOrganization,
  getAwsAccessKeySetupCommand,
  getAwsExternalIdForProject,
  getAwsOrganizationSetupCommand,
  getAwsOrganizationStackSetName,
  getAwsReadOnlyPolicy,
  getAwsReadOnlyPolicyDocument,
  getAwsReadOnlyRoleTemplate,
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
 * only read, and nothing a connection does not use - and these hold it to
 * that: every AWS action reads (Describe, List, Get or Lookup, and the log
 * group's FilterLogEvents), none writes, none reads data but the log lines
 * read only when AI may read an account's logs, and none is one no reader
 * calls (no billing, no health entities); an investigation's live reads
 * have the actions they call; API Gateway's one read action is held to the
 * APIs' own definitions; only an organization's management account may
 * list its accounts; the role trusts this OneUptime with this project's
 * own external id only, and a project's organization StackSet is its own;
 * Azure's app gets the built-in Monitoring Reader role, Google Cloud's
 * service account Monitoring Viewer, Cloud Asset Viewer, Logs Viewer and
 * Service Health Viewer. Each command can be run again, for one account or
 * a whole organization.
 */

// What an investigation's live reads call on AWS, besides what listing calls.
const AWS_LIVE_READ_ACTIONS: Array<string> = [
  "rds:DescribeEvents",
  "autoscaling:DescribeScalingActivities",
  "ec2:DescribeInstanceStatus",
  "ecs:DescribeTaskDefinition",
  "lambda:GetFunctionConfiguration",
  "lambda:GetFunctionConcurrency",
  "lambda:GetAlias",
  "servicequotas:ListServiceQuotas",
  "logs:FilterLogEvents",
  "logs:DescribeLogGroups",
];

function isLogReadAction(action: string): boolean {
  return AWS_LOG_READ_ACTION_GROUP.actions.includes(action);
}

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
  test("every action reads: Describe, List, Get or Lookup - and API Gateway's GET", () => {
    for (const action of AWS_READ_ONLY_ACTIONS.filter(
      (entry: string): boolean => {
        return !isLogReadAction(entry);
      },
    )) {
      expect(action).toMatch(/^[a-z0-9-]+:(Describe|List|Get|Lookup|GET$)/);
    }

    // The log lines: found with Describe, read with Filter.
    expect(AWS_LOG_READ_ACTION_GROUP.actions).toEqual([
      "logs:DescribeLogGroups",
      "logs:FilterLogEvents",
    ]);
  });

  test("no action reads data or a secret, but the log lines read only when AI may read an account's logs, and none writes", () => {
    for (const action of AWS_READ_ONLY_ACTIONS) {
      const [service, name] = action.split(":") as [string, string];

      // Objects, rows, messages, secrets, parameters, queries of data.
      expect(["s3", "secretsmanager", "ssm", "kms", "athena"]).not.toContain(
        service,
      );
      expect({ action, logs: service === "logs" }).toEqual({
        action,
        logs: isLogReadAction(action),
      });
      expect(name).not.toMatch(
        /^(Put|Create|Delete|Update|Modify|Start|Stop|Reboot|Terminate|Attach|Detach|Set|Send|Invoke|Receive|Scan|Query|GetItem|BatchGet|GetObject|GetSecret|GetLogEvents|GetQueryResults|Decrypt)/,
      );
    }

    expect(AWS_READ_ONLY_ACTIONS).not.toContain("*");
    // GetFunction hands out a link to the function's code.
    expect(AWS_READ_ONLY_ACTIONS).not.toContain("lambda:GetFunction");
    expect(AWS_READ_ONLY_ACTION_GROUPS).toContain(AWS_LOG_READ_ACTION_GROUP);
    expect(AWS_LOG_READ_ACTION_GROUP.purpose).toBe(
      "Read log lines, only when you let AI read an account's logs",
    );
  });

  test("an investigation's live reads have the actions they call: a resource's status and recent events, the quotas, and the log lines", () => {
    for (const action of AWS_LIVE_READ_ACTIONS) {
      expect({
        action,
        granted: AWS_READ_ONLY_ACTIONS.includes(action),
      }).toEqual({ action, granted: true });
    }

    expect(
      AWS_READ_ONLY_ACTION_GROUPS.slice(-3).flatMap(
        (group: { actions: Array<string> }): Array<string> => {
          return group.actions;
        },
      ),
    ).toEqual(expect.arrayContaining(AWS_LIVE_READ_ACTIONS));
    expect(
      AWS_READ_ONLY_ACTION_GROUPS.slice(-3).map(
        (group: { purpose: string }): string => {
          return group.purpose;
        },
      ),
    ).toEqual([
      "Read a resource's live status and recent events during an investigation",
      "Read the account's quotas during an investigation",
      "Read log lines, only when you let AI read an account's logs",
    ]);
  });

  test("no action is one no reader calls: no billing, no health entities", () => {
    for (const action of AWS_READ_ONLY_ACTIONS) {
      expect(action.startsWith("ce:")).toBe(false);
      expect(action.startsWith("aws-portal:")).toBe(false);
    }

    expect(AWS_READ_ONLY_ACTIONS).not.toContain(
      "health:DescribeAffectedEntities",
    );
    expect(AWS_READ_ONLY_ACTIONS).toContain("health:DescribeEvents");
    expect(AWS_READ_ONLY_ACTIONS).toContain("health:DescribeEventDetails");
  });

  test("an account's own role may not list an organization's accounts", () => {
    expect(AWS_READ_ONLY_ACTIONS).not.toContain("organizations:ListAccounts");
    expect(getAwsReadOnlyPolicyDocument()).not.toContain("organizations:");
    expect(AWS_ORGANIZATION_ACTION_GROUP.actions).toEqual([
      "organizations:ListAccounts",
    ]);
  });

  test("the management account's role may, and nothing else besides", () => {
    const policy: ReturnType<typeof getAwsReadOnlyPolicy> =
      getAwsReadOnlyPolicy({ organization: true });

    expect(policy.Statement[0]!.Action).toEqual([
      ...getAwsReadOnlyPolicy().Statement[0]!.Action,
      "organizations:ListAccounts",
    ]);
    expect(policy.Statement.slice(1)).toEqual(
      getAwsReadOnlyPolicy().Statement.slice(1),
    );
  });

  test("each action is named once, in a group that says what it is for", () => {
    expect(new Set(AWS_READ_ONLY_ACTIONS).size).toBe(
      AWS_READ_ONLY_ACTIONS.length,
    );

    for (const group of AWS_READ_ONLY_ACTION_GROUPS) {
      expect(group.purpose.length).toBeGreaterThan(0);
      expect(group.actions.length).toBeGreaterThan(0);
    }
  });

  test("the policy allows the read actions on everything, but API Gateway's only on API definitions - never on its keys", () => {
    const policy: ReturnType<typeof getAwsReadOnlyPolicy> = JSON.parse(
      getAwsReadOnlyPolicyDocument(),
    );

    expect(policy).toEqual(getAwsReadOnlyPolicy());
    expect(policy.Statement).toHaveLength(2);
    expect(policy.Statement[0]).toEqual({
      Effect: "Allow",
      Action: AWS_READ_ONLY_ACTIONS.filter((action: string): boolean => {
        return action !== "apigateway:GET";
      }),
      Resource: "*",
    });
    expect(policy.Statement[1]).toEqual({
      Effect: "Allow",
      Action: ["apigateway:GET"],
      Resource: AWS_SCOPED_READ_RESOURCES["apigateway:GET"],
    });

    for (const resource of AWS_SCOPED_READ_RESOURCES["apigateway:GET"]!) {
      expect(resource).not.toContain("apikeys");
      expect(resource).toMatch(/::\/(restapis|apis)(\/\*)?$/);
    }
  });

  test("the policy fits an IAM inline policy's 10,240 characters with room to spare", () => {
    expect(getAwsReadOnlyPolicyDocument().length).toBeLessThan(5000);
  });

  test("the access key's user takes the policy too: IAM holds a user's inline policies to 2,048 characters", () => {
    expect(getAwsReadOnlyPolicyDocument()).not.toMatch(/\s/);
    expect(getAwsReadOnlyPolicyDocument().length).toBeLessThanOrEqual(2048);
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

  test("the role command names the role and what it trusts once, creates or updates it, puts the read policy on it and prints its ARN last", () => {
    const externalId: string = getAwsExternalIdForProject(PROJECT);
    const role: string = getAwsRoleNameForExternalId(externalId);
    const command: string = getAwsRoleSetupCommand({
      trustedPrincipalArn: TRUSTED,
      externalId,
    });
    const lines: Array<string> = command.split("\n");

    expect(lines).toHaveLength(5);
    // Who may sign in, under which external id: said first, and once.
    expect(lines[0]).toBe(`ROLE=${role}`);
    expect(lines[1]!.startsWith("TRUST='")).toBe(true);
    expect(JSON.parse(quotedAfter(lines[1]!, "TRUST="))).toEqual(
      JSON.parse(
        getAwsTrustPolicyDocument({ trustedPrincipalArn: TRUSTED, externalId }),
      ),
    );
    expect(command.split(TRUSTED)).toHaveLength(2);
    expect(command.split(externalId)).toHaveLength(2);
    // Run again: the trust policy is updated rather than failing.
    expect(lines[2]).toBe(
      'aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" > /dev/null 2>&1 || aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"',
    );
    expect(lines[3]).toContain(
      `aws iam put-role-policy --role-name "$ROLE" --policy-name ${CLOUD_CONNECTION_READ_ONLY_NAME} `,
    );
    expect(JSON.parse(quotedAfter(lines[3]!, "--policy-document"))).toEqual(
      JSON.parse(getAwsReadOnlyPolicyDocument()),
    );
    expect(lines[4]).toBe(
      'aws iam get-role --role-name "$ROLE" --query Role.Arn --output text',
    );
  });

  test("the role command's quoting holds: the trust policy has no single quote to end its own", () => {
    const command: string = getAwsRoleSetupCommand({
      trustedPrincipalArn: TRUSTED,
      externalId: getAwsExternalIdForProject(PROJECT),
    });
    const trustLine: string = command.split("\n")[1]!;

    // Exactly the two quotes around the policy.
    expect(trustLine.split("'")).toHaveLength(3);
    expect(trustLine.endsWith("'")).toBe(true);
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
      getAzureSetupCommand(CloudConnectionSetupScope.Organization),
      getGcpSetupCommand(CloudConnectionSetupScope.Organization),
      getAwsOrganizationSetupCommand({
        trustedPrincipalArn: TRUSTED,
        externalId: getAwsExternalIdForProject(PROJECT),
      }),
    ]) {
      expect(command).not.toMatch(/<[A-Z_]+>/);
      expect(command).not.toContain("${");
    }
  });
});

describe("AWS organizations", () => {
  const data: { trustedPrincipalArn: string; externalId: string } = {
    trustedPrincipalArn: TRUSTED,
    externalId: getAwsExternalIdForProject(PROJECT),
  };

  test("the template makes the same role, trust and policy the command does", () => {
    const template: {
      Resources: {
        OneUptimeReadOnlyRole: {
          Type: string;
          Properties: {
            RoleName: string;
            AssumeRolePolicyDocument: unknown;
            Policies: Array<{ PolicyName: string; PolicyDocument: unknown }>;
          };
        };
      };
    } = JSON.parse(getAwsReadOnlyRoleTemplate(data));
    const role: (typeof template)["Resources"]["OneUptimeReadOnlyRole"] =
      template.Resources.OneUptimeReadOnlyRole;

    expect(role.Type).toBe("AWS::IAM::Role");
    expect(role.Properties.RoleName).toBe(
      getAwsRoleNameForExternalId(data.externalId),
    );
    expect(role.Properties.AssumeRolePolicyDocument).toEqual(
      JSON.parse(getAwsTrustPolicyDocument(data)),
    );
    expect(role.Properties.Policies).toEqual([
      {
        PolicyName: CLOUD_CONNECTION_READ_ONLY_NAME,
        PolicyDocument: getAwsReadOnlyPolicy(),
      },
    ]);
  });

  test("the organization command deploys the template to every account through a StackSet, then makes the role here and prints its ARN last", () => {
    const command: string = getAwsOrganizationSetupCommand(data);
    const lines: Array<string> = command.split("\n");

    expect(lines[0]).toBe("cat > oneuptime-read-only.json <<'TEMPLATE'");
    expect(JSON.parse(lines[1]!)).toEqual(
      JSON.parse(getAwsReadOnlyRoleTemplate(data)),
    );
    expect(lines[2]).toBe("TEMPLATE");
    // StackSets' trusted access to the organization, turned on (a no-op when it is).
    expect(lines[3]).toBe(
      "aws cloudformation activate-organizations-access > /dev/null 2>&1 || true",
    );
    expect(lines[4]).toContain(
      `aws cloudformation create-stack-set --stack-set-name ${getAwsOrganizationStackSetName(data.externalId)} `,
    );
    expect(lines[4]).toContain("--permission-model SERVICE_MANAGED");
    expect(lines[4]).toContain("--auto-deployment Enabled=true");
    // Run again: the StackSet is updated rather than failing.
    expect(lines[4]).toContain("|| aws cloudformation update-stack-set");
    expect(lines[5]).toContain("aws cloudformation create-stack-instances");
    expect(lines[5]).toContain("OrganizationalUnitIds=");
    // The management account's role: the one that may list the accounts.
    expect(
      command.endsWith(getAwsRoleSetupCommand({ ...data, organization: true })),
    ).toBe(true);
    expect(lines[lines.length - 1]).toBe(
      'aws iam get-role --role-name "$ROLE" --query Role.Arn --output text',
    );
  });

  test("the StackSet is the project's own: a second project connecting the same organization adds its roles, never replaces the first's", () => {
    const other: string = getAwsExternalIdForProject(OTHER_PROJECT);

    expect(getAwsOrganizationStackSetName(data.externalId)).toBe(
      getAwsRoleNameForExternalId(data.externalId),
    );
    expect(getAwsOrganizationStackSetName(data.externalId)).not.toBe(
      getAwsOrganizationStackSetName(other),
    );
    // CloudFormation StackSet names: letters, digits and hyphens, at most 128.
    expect(getAwsOrganizationStackSetName(data.externalId)).toMatch(
      /^[A-Za-z][A-Za-z0-9-]{0,127}$/,
    );
  });

  test("the roles the StackSet puts in every member account may not list the organization", () => {
    expect(getAwsReadOnlyRoleTemplate(data)).not.toContain("organizations:");
    expect(
      getAwsOrganizationSetupCommand(data)
        .split("\n")
        .filter((line: string): boolean => {
          return line.includes("organizations:ListAccounts");
        }),
    ).toHaveLength(1);
  });

  test("an organization is set up through a role only: an access key's user cannot sign in to the members' roles", () => {
    expect(
      canSetUpOrganization(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsRole,
      ),
    ).toBe(true);
    expect(
      canSetUpOrganization(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsAccessKey,
      ),
    ).toBe(false);
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsAccessKey,
        { scope: CloudConnectionSetupScope.Organization },
      ),
    ).toBe(getAwsAccessKeySetupCommand());
  });
});

describe("Azure", () => {
  test("creates an app with Monitoring Reader on the subscription the shell is in, and prints what it made with the password's expiry", () => {
    const lines: Array<string> = getAzureSetupCommand().split("\n");

    expect(lines).toEqual([
      'SCOPE="/subscriptions/$(az account show --query id --output tsv)"',
      `OUT=$(az ad sp create-for-rbac --name ${CLOUD_CONNECTION_READ_ONLY_NAME} --role "Monitoring Reader" --scopes "$SCOPE")`,
      'APP=$(echo "$OUT" | jq -r .appId)',
      'END=$(az ad app credential list --id "$APP" --query "max([].endDateTime)" --output tsv)',
      `echo "$OUT" | jq --arg end "$END" '. + {endDateTime: $end}'`,
    ]);
    expect(AZURE_READ_ONLY_ROLE).toBe("Monitoring Reader");
    // No role a connection does not use: no billing reader.
    expect(getAzureSetupCommand()).not.toContain("Cost Management");
    expect(getAzureSetupCommand()).not.toContain("role assignment create");
  });

  test("for every subscription, the same on the tenant's root management group", () => {
    const lines: Array<string> = getAzureSetupCommand(
      CloudConnectionSetupScope.Organization,
    ).split("\n");

    expect(lines[0]).toBe(
      'SCOPE="/providers/Microsoft.Management/managementGroups/$(az account show --query tenantId --output tsv)"',
    );
    expect(lines.slice(1)).toEqual(getAzureSetupCommand().split("\n").slice(1));
  });
});

describe("Google Cloud", () => {
  const member: string = `${GCP_SERVICE_ACCOUNT_ID}@$PROJECT_ID.iam.gserviceaccount.com`;

  test("turns on the APIs it reads, creates the service account, grants its read-only roles on the project and prints a key it then deletes", () => {
    const lines: Array<string> = getGcpSetupCommand().split("\n");

    expect(lines).toEqual([
      "PROJECT_ID=$(gcloud config get-value project)",
      `gcloud services enable ${GCP_SERVICES.join(" ")}`,
      `gcloud iam service-accounts create ${GCP_SERVICE_ACCOUNT_ID} --display-name "OneUptime (read only)" > /dev/null 2>&1 || true`,
      ...GCP_READ_ONLY_ROLES.map((role: string): string => {
        return `gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${member}" --role ${role} --condition=None > /dev/null`;
      }),
      `gcloud iam service-accounts keys create oneuptime-key.json --iam-account "${member}"`,
      "cat oneuptime-key.json && rm oneuptime-key.json",
    ]);
    expect(GCP_READ_ONLY_ROLE).toBe("roles/monitoring.viewer");
    expect(GCP_READ_ONLY_ROLES).toEqual([
      "roles/monitoring.viewer",
      GCP_INVENTORY_ROLE,
      GCP_AUDIT_LOG_ROLE,
      "roles/servicehealth.viewer",
    ]);
    expect(GCP_SERVICES).toContain("cloudasset.googleapis.com");
  });

  test("for every project, grants the roles on the project's organization instead", () => {
    const lines: Array<string> = getGcpSetupCommand(
      CloudConnectionSetupScope.Organization,
    ).split("\n");

    expect(lines[1]).toBe(
      'ORG_ID=$(gcloud projects get-ancestors "$PROJECT_ID" --format="value(id)" | tail -1)',
    );

    for (const role of GCP_READ_ONLY_ROLES) {
      expect(lines).toContain(
        `gcloud organizations add-iam-policy-binding "$ORG_ID" --member "serviceAccount:${member}" --role ${role} --condition=None > /dev/null`,
      );
    }

    expect(lines.join("\n")).not.toContain(
      "gcloud projects add-iam-policy-binding",
    );
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
    ).toBe(
      getAwsRoleSetupCommand({ trustedPrincipalArn: TRUSTED, externalId }),
    );
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
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsRole,
        {
          trustedPrincipalArn: TRUSTED,
          externalId,
          scope: CloudConnectionSetupScope.Organization,
        },
      ),
    ).toBe(
      getAwsOrganizationSetupCommand({
        trustedPrincipalArn: TRUSTED,
        externalId,
      }),
    );
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.Azure,
        CloudConnectionAuthMethod.AzureClientSecret,
        { scope: CloudConnectionSetupScope.Organization },
      ),
    ).toBe(getAzureSetupCommand(CloudConnectionSetupScope.Organization));
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.GCP,
        CloudConnectionAuthMethod.GcpServiceAccountKey,
        { scope: CloudConnectionSetupScope.Organization },
      ),
    ).toBe(getGcpSetupCommand(CloudConnectionSetupScope.Organization));
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
