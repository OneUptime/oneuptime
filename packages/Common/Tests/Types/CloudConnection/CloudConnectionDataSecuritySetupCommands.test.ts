import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_CONNECTION_DATA_SECURITY_LEVELS,
  CLOUD_CONNECTION_DATA_SECURITY_RESPONSES,
  CloudConnectionAuthMethod,
  CloudConnectionCatalog,
  CloudConnectionDataSecurityLevel,
  CloudConnectionDataSecurityResponse,
  CloudConnectionDefinition,
  CloudConnectionField,
  DATA_SECURITY_FIELD_KEY,
  DATA_SECURITY_RESPONSE_FIELD_KEY,
  getCloudConnectionDataSecurityLevel,
  isCloudConnectionDataSecurityResponseOn,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  AWS_DATA_SECURITY_CONFIGURATION_ACTIONS,
  AWS_DATA_SECURITY_CONFIGURATION_ACTION_GROUPS,
  AWS_DATA_SECURITY_CONTENT_ACTIONS,
  AWS_DATA_SECURITY_GROUP_NAME,
  AWS_DATA_SECURITY_POLICY_NAME,
  AWS_DATA_SECURITY_RESPONSE_ACTIONS,
  AWS_DATA_SECURITY_RESPONSE_POLICY_NAME,
  AWS_READ_ONLY_ACTIONS,
  AZURE_DATA_SECURITY_CONTENT_ROLE,
  AZURE_DATA_SECURITY_RESPONSE_ACTIONS,
  AZURE_DATA_SECURITY_RESPONSE_ROLE,
  AwsPolicyStatement,
  CLOUD_CONNECTION_READ_ONLY_NAME,
  CloudConnectionSetupScope,
  GCP_DATA_SECURITY_CONTENT_ROLES,
  GCP_DATA_SECURITY_CONTENT_SERVICES,
  GCP_DATA_SECURITY_RESPONSE_PERMISSIONS,
  GCP_DATA_SECURITY_RESPONSE_ROLE_ID,
  GCP_READ_ONLY_ROLES,
  GCP_SERVICES,
  GCP_SERVICE_ACCOUNT_ID,
  getAwsAccessKeySetupCommand,
  getAwsDataSecurityPolicy,
  getAwsDataSecurityPolicyDocument,
  getAwsDataSecurityResponsePolicy,
  getAwsDataSecurityResponsePolicyDocument,
  getAwsExternalIdForProject,
  getAwsOrganizationSetupCommand,
  getAwsReadOnlyPolicy,
  getAwsReadOnlyPolicyDocument,
  getAwsReadOnlyRoleTemplate,
  getAwsRoleSetupCommand,
  getAzureSetupCommand,
  getCloudConnectionSetupCommand,
  getGcpSetupCommand,
} from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { describe, expect, test } from "@jest/globals";

/*
 * Data Security's access is opt-in, and the commands hold it to that:
 * with it off every command is the one connections get today, byte for
 * byte; "configuration" adds exactly the read actions the data security
 * reader calls, as a policy of its own, and nothing that writes or reads
 * data; "content" adds reading objects - with kms:Decrypt only through S3
 * - and Azure's and Google Cloud's data reader roles; the policies fit
 * IAM's size limits; and every cloud's form records the level granted.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const TRUSTED: string = "arn:aws:iam::999988887777:root";
const ROLE: { trustedPrincipalArn: string; externalId: string } = {
  trustedPrincipalArn: TRUSTED,
  externalId: getAwsExternalIdForProject(PROJECT),
};
const ON_LEVELS: Array<CloudConnectionDataSecurityLevel> = [
  "configuration",
  "content",
];
const SCOPES: Array<CloudConnectionSetupScope> = [
  CloudConnectionSetupScope.Account,
  CloudConnectionSetupScope.Organization,
];
// An action that reads a setting, and the verbs of one that changes or reads data.
const READ_ACTION_NAME: RegExp = /^(Describe|List|Get)/;
const DELETE_ACTION_NAME: RegExp = /:(Delete|Remove|Revoke|Detach)/;
// A value left for a person to fill in: <ACCOUNT_ID>.
const PLACEHOLDER: RegExp = /<[A-Z_]+>/;
const WRITE_ACTION_NAME: RegExp =
  /^(Put|Create|Delete|Update|Modify|Start|Stop|Reboot|Restore|Copy|Attach|Detach|Set|Send|Invoke|Encrypt|GenerateDataKey|Scan|Query)/;

// The JSON between the first pair of single quotes after a marker.
function quotedAfter(text: string, marker: string): string {
  const markerAt: number = text.indexOf(marker);
  const start: number = text.indexOf("'", markerAt);
  const end: number = text.indexOf("'", start + 1);
  return text.slice(start + 1, end);
}

function actionsOf(
  policy: { Statement: Array<AwsPolicyStatement> } | null,
): Array<string> {
  return (policy?.Statement || []).flatMap(
    (statement: AwsPolicyStatement): Array<string> => {
      return statement.Action;
    },
  );
}

describe("with data security off", () => {
  // Both of Data Security's settings off, as a connection has them until changed.
  const OFF: {
    dataSecurity: CloudConnectionDataSecurityLevel;
    dataSecurityResponse: CloudConnectionDataSecurityResponse;
  } = { dataSecurity: "off", dataSecurityResponse: "off" };

  test("every command, template and policy is exactly today's", () => {
    expect(getAwsRoleSetupCommand({ ...ROLE, ...OFF })).toBe(
      getAwsRoleSetupCommand(ROLE),
    );
    expect(
      getAwsRoleSetupCommand({
        ...ROLE,
        organization: true,
        ...OFF,
      }),
    ).toBe(getAwsRoleSetupCommand({ ...ROLE, organization: true }));
    expect(getAwsReadOnlyRoleTemplate({ ...ROLE, ...OFF })).toBe(
      getAwsReadOnlyRoleTemplate(ROLE),
    );
    expect(getAwsOrganizationSetupCommand({ ...ROLE, ...OFF })).toBe(
      getAwsOrganizationSetupCommand(ROLE),
    );
    expect(getAwsAccessKeySetupCommand(OFF)).toBe(
      getAwsAccessKeySetupCommand(),
    );
    expect(getAwsDataSecurityPolicy("off")).toBeNull();
    expect(getAwsDataSecurityPolicyDocument("off")).toBe("");
    expect(getAwsDataSecurityResponsePolicy("off")).toBeNull();
    expect(getAwsDataSecurityResponsePolicyDocument("off")).toBe("");

    for (const scope of SCOPES) {
      expect(getAzureSetupCommand(scope, "off", "off")).toBe(
        getAzureSetupCommand(scope),
      );
      expect(getGcpSetupCommand(scope, "off", "off")).toBe(
        getGcpSetupCommand(scope),
      );

      for (const [provider, method] of [
        [CloudProvider.AWS, CloudConnectionAuthMethod.AwsRole],
        [CloudProvider.AWS, CloudConnectionAuthMethod.AwsAccessKey],
        [CloudProvider.Azure, CloudConnectionAuthMethod.AzureClientSecret],
        [CloudProvider.GCP, CloudConnectionAuthMethod.GcpServiceAccountKey],
      ] as Array<[CloudProvider, CloudConnectionAuthMethod]>) {
        expect(
          getCloudConnectionSetupCommand(provider, method, {
            ...ROLE,
            scope,
            ...OFF,
          }),
        ).toBe(
          getCloudConnectionSetupCommand(provider, method, { ...ROLE, scope }),
        );
      }
    }
  });

  test("today's commands grant nothing of Data Security's", () => {
    for (const command of [
      getAwsRoleSetupCommand(ROLE),
      getAwsOrganizationSetupCommand(ROLE),
      getAwsAccessKeySetupCommand(),
      getAzureSetupCommand(),
      getGcpSetupCommand(),
    ]) {
      expect(command).not.toContain(AWS_DATA_SECURITY_POLICY_NAME);
      expect(command).not.toContain("s3:");
      expect(command).not.toContain(AZURE_DATA_SECURITY_CONTENT_ROLE);
      expect(command).not.toContain(AZURE_DATA_SECURITY_RESPONSE_ROLE);
      expect(command).not.toContain(GCP_DATA_SECURITY_RESPONSE_ROLE_ID);
      expect(command).not.toContain("Modify");

      for (const role of GCP_DATA_SECURITY_CONTENT_ROLES) {
        expect(command).not.toContain(role);
      }
    }
  });
});

describe("Data security response", () => {
  const BLOCK: CloudConnectionDataSecurityResponse = "block";

  test("AWS: the role gets a third inline policy, on a line of its own, with exactly the response's actions", () => {
    const today: Array<string> = getAwsRoleSetupCommand(ROLE).split("\n");
    const alone: Array<string> = getAwsRoleSetupCommand({
      ...ROLE,
      dataSecurityResponse: BLOCK,
    }).split("\n");
    const both: Array<string> = getAwsRoleSetupCommand({
      ...ROLE,
      dataSecurity: "content",
      dataSecurityResponse: BLOCK,
    }).split("\n");
    const responseLine: string = `aws iam put-role-policy --role-name "$ROLE" --policy-name ${AWS_DATA_SECURITY_RESPONSE_POLICY_NAME} --policy-document '`;

    expect(alone).toHaveLength(6);
    expect(alone.slice(0, 4)).toEqual(today.slice(0, 4));
    expect(alone[4]!.startsWith(responseLine)).toBe(true);
    expect(alone[5]).toBe(today[4]);
    expect(JSON.parse(quotedAfter(alone[4]!, "--policy-document"))).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "s3:GetBucketPublicAccessBlock",
            "s3:PutBucketPublicAccessBlock",
            "rds:DescribeDBSnapshotAttributes",
            "rds:DescribeDBClusterSnapshotAttributes",
            "rds:ModifyDBSnapshotAttribute",
            "rds:ModifyDBClusterSnapshotAttribute",
          ],
          Resource: "*",
        },
      ],
    });
    // Reading, then responding: three policies, the ARN still printed last.
    expect(both).toHaveLength(7);
    expect(both[4]).toContain(
      `--policy-name ${AWS_DATA_SECURITY_POLICY_NAME} `,
    );
    expect(both[5]!.startsWith(responseLine)).toBe(true);
    expect(both[6]).toBe(today[4]);
  });

  test("AWS: the only writes are turning on a bucket's Block Public Access and narrowing a snapshot's shares", () => {
    const writes: Array<string> = AWS_DATA_SECURITY_RESPONSE_ACTIONS.filter(
      (action: string): boolean => {
        return !READ_ACTION_NAME.test(action.split(":")[1] || "");
      },
    );

    expect(writes).toEqual([
      "s3:PutBucketPublicAccessBlock",
      "rds:ModifyDBSnapshotAttribute",
      "rds:ModifyDBClusterSnapshotAttribute",
    ]);

    for (const action of AWS_DATA_SECURITY_RESPONSE_ACTIONS) {
      expect(action).not.toContain("*");
      expect(action).not.toMatch(DELETE_ACTION_NAME);
    }

    // Not in the read-only policy, nor in the data security one.
    for (const write of writes) {
      expect(AWS_READ_ONLY_ACTIONS).not.toContain(write);
      expect(getAwsDataSecurityPolicyDocument("content")).not.toContain(write);
    }
  });

  test("AWS: the StackSet's template and the access key's group carry it too; every policy still fits", () => {
    const template: {
      Description: string;
      Resources: {
        OneUptimeReadOnlyRole: {
          Properties: {
            Policies: Array<{ PolicyName: string; PolicyDocument: unknown }>;
          };
        };
      };
    } = JSON.parse(
      getAwsReadOnlyRoleTemplate({
        ...ROLE,
        dataSecurity: "configuration",
        dataSecurityResponse: BLOCK,
      }),
    );

    expect(
      template.Resources.OneUptimeReadOnlyRole.Properties.Policies.map(
        (policy: { PolicyName: string }): string => {
          return policy.PolicyName;
        },
      ),
    ).toEqual([
      CLOUD_CONNECTION_READ_ONLY_NAME,
      AWS_DATA_SECURITY_POLICY_NAME,
      AWS_DATA_SECURITY_RESPONSE_POLICY_NAME,
    ]);
    expect(
      template.Resources.OneUptimeReadOnlyRole.Properties.Policies[2]!
        .PolicyDocument,
    ).toEqual(getAwsDataSecurityResponsePolicy(BLOCK));
    expect(template.Description).toContain(
      "it may also block a data store's public access and sharing",
    );
    expect(
      getAwsOrganizationSetupCommand({ ...ROLE, dataSecurityResponse: BLOCK }),
    ).toContain(
      getAwsRoleSetupCommand({
        ...ROLE,
        organization: true,
        dataSecurityResponse: BLOCK,
      }),
    );

    const user: string = CLOUD_CONNECTION_READ_ONLY_NAME;
    const group: string = AWS_DATA_SECURITY_GROUP_NAME;
    const today: Array<string> = getAwsAccessKeySetupCommand().split("\n");

    // Responding without reading: the group is still made, and joined.
    expect(
      getAwsAccessKeySetupCommand({ dataSecurityResponse: BLOCK }).split("\n"),
    ).toEqual([
      today[0],
      today[1],
      `aws iam create-group --group-name ${group} > /dev/null 2>&1 || true`,
      `aws iam put-group-policy --group-name ${group} --policy-name ${AWS_DATA_SECURITY_RESPONSE_POLICY_NAME} --policy-document '${getAwsDataSecurityResponsePolicyDocument(BLOCK)}'`,
      `aws iam add-user-to-group --user-name ${user} --group-name ${group}`,
      today[2],
    ]);
    expect(
      getAwsAccessKeySetupCommand({
        dataSecurity: "content",
        dataSecurityResponse: BLOCK,
      })
        .split("\n")
        .filter((line: string): boolean => {
          return line.includes("put-group-policy");
        })
        .map((line: string): string => {
          return line.split(" --policy-document")[0] || "";
        }),
    ).toEqual([
      `aws iam put-group-policy --group-name ${group} --policy-name ${AWS_DATA_SECURITY_POLICY_NAME}`,
      `aws iam put-group-policy --group-name ${group} --policy-name ${AWS_DATA_SECURITY_RESPONSE_POLICY_NAME}`,
    ]);

    const response: number =
      getAwsDataSecurityResponsePolicyDocument(BLOCK).length;

    expect(
      getAwsReadOnlyPolicyDocument({ organization: true }).length +
        getAwsDataSecurityPolicyDocument("content").length +
        response,
    ).toBeLessThan(10240);
    expect(
      getAwsDataSecurityPolicyDocument("content").length + response,
    ).toBeLessThan(5120);
    expect(getAwsDataSecurityResponsePolicyDocument(BLOCK)).not.toContain("'");
  });

  test("Azure: a custom role that may read and update storage accounts - never list their keys - made for and assigned on the same scope", () => {
    for (const scope of SCOPES) {
      const today: Array<string> = getAzureSetupCommand(scope).split("\n");
      const lines: Array<string> = getAzureSetupCommand(
        scope,
        "off",
        BLOCK,
      ).split("\n");

      expect(lines).toEqual([
        ...today.slice(0, 3),
        `RESPONSE_ROLE=$(jq -n --arg scope "$SCOPE" '{Name: "OneUptime Data Security Response", IsCustom: true, Description: "OneUptime: turn off public access to storage accounts. Never lists their keys.", Actions: ["Microsoft.Storage/storageAccounts/read", "Microsoft.Storage/storageAccounts/write"], NotActions: [], AssignableScopes: [$scope]}')`,
        `az role definition create --role-definition "$RESPONSE_ROLE" > /dev/null 2>&1 || az role definition update --role-definition "$RESPONSE_ROLE" > /dev/null`,
        `az role assignment create --assignee "$APP" --role "OneUptime Data Security Response" --scope "$SCOPE" > /dev/null`,
        ...today.slice(3),
      ]);
      expect(lines.join("\n")).not.toContain("listKeys");
    }

    expect(AZURE_DATA_SECURITY_RESPONSE_ROLE).toBe(
      "OneUptime Data Security Response",
    );
    expect(AZURE_DATA_SECURITY_RESPONSE_ACTIONS).toEqual([
      "Microsoft.Storage/storageAccounts/read",
      "Microsoft.Storage/storageAccounts/write",
    ]);
  });

  test("Google Cloud: a custom role that may read and update buckets, made where the command binds roles, and bound", () => {
    const member: string = `${GCP_SERVICE_ACCOUNT_ID}@$PROJECT_ID.iam.gserviceaccount.com`;

    expect(GCP_DATA_SECURITY_RESPONSE_PERMISSIONS).toEqual([
      "storage.buckets.get",
      "storage.buckets.update",
    ]);

    for (const [scope, home, bind, role] of [
      [
        CloudConnectionSetupScope.Account,
        `--project "$PROJECT_ID"`,
        `gcloud projects add-iam-policy-binding "$PROJECT_ID"`,
        `projects/$PROJECT_ID/roles/${GCP_DATA_SECURITY_RESPONSE_ROLE_ID}`,
      ],
      [
        CloudConnectionSetupScope.Organization,
        `--organization "$ORG_ID"`,
        `gcloud organizations add-iam-policy-binding "$ORG_ID"`,
        `organizations/$ORG_ID/roles/${GCP_DATA_SECURITY_RESPONSE_ROLE_ID}`,
      ],
    ] as Array<[CloudConnectionSetupScope, string, string, string]>) {
      const today: Array<string> = getGcpSetupCommand(scope).split("\n");
      const lines: Array<string> = getGcpSetupCommand(
        scope,
        "off",
        BLOCK,
      ).split("\n");

      expect(lines).toEqual([
        ...today.slice(0, -2),
        `gcloud iam roles create ${GCP_DATA_SECURITY_RESPONSE_ROLE_ID} ${home} --title "OneUptime Data Security Response" --description "OneUptime: turn on public access prevention for buckets." --permissions storage.buckets.get,storage.buckets.update --stage GA --quiet > /dev/null 2>&1 || gcloud iam roles update ${GCP_DATA_SECURITY_RESPONSE_ROLE_ID} ${home} --permissions storage.buckets.get,storage.buckets.update --quiet > /dev/null`,
        `${bind} --member "serviceAccount:${member}" --role ${role} --condition=None > /dev/null`,
        ...today.slice(-2),
      ]);
    }
  });

  test("the one command each form shows takes it, and nothing is left to fill in", () => {
    const context: {
      dataSecurityResponse: CloudConnectionDataSecurityResponse;
    } = { dataSecurityResponse: BLOCK };

    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsRole,
        { ...ROLE, ...context },
      ),
    ).toBe(getAwsRoleSetupCommand({ ...ROLE, ...context }));
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsRole,
        { ...ROLE, ...context, scope: CloudConnectionSetupScope.Organization },
      ),
    ).toBe(getAwsOrganizationSetupCommand({ ...ROLE, ...context }));
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsAccessKey,
        context,
      ),
    ).toBe(getAwsAccessKeySetupCommand(context));
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.Azure,
        CloudConnectionAuthMethod.AzureClientSecret,
        context,
      ),
    ).toBe(
      getAzureSetupCommand(CloudConnectionSetupScope.Account, "off", BLOCK),
    );
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.GCP,
        CloudConnectionAuthMethod.GcpServiceAccountKey,
        context,
      ),
    ).toBe(getGcpSetupCommand(CloudConnectionSetupScope.Account, "off", BLOCK));

    for (const command of [
      getAwsRoleSetupCommand({ ...ROLE, ...context }),
      getAwsAccessKeySetupCommand(context),
      getAzureSetupCommand(
        CloudConnectionSetupScope.Organization,
        "off",
        BLOCK,
      ),
      getGcpSetupCommand(CloudConnectionSetupScope.Organization, "off", BLOCK),
    ]) {
      expect(command).not.toMatch(PLACEHOLDER);
      expect(command).not.toContain("${");
    }
  });

  test("every cloud's form asks for it right after Data security, folded, off unless chosen", () => {
    for (const definition of CloudConnectionCatalog) {
      const keys: Array<string> = definition.configFields.map(
        (field: CloudConnectionField): string => {
          return field.key;
        },
      );
      const field: CloudConnectionField | undefined =
        definition.configFields.find(
          (candidate: CloudConnectionField): boolean => {
            return candidate.key === DATA_SECURITY_RESPONSE_FIELD_KEY;
          },
        );

      expect(keys.indexOf(DATA_SECURITY_RESPONSE_FIELD_KEY)).toBe(
        keys.indexOf(DATA_SECURITY_FIELD_KEY) + 1,
      );
      expect(field).toMatchObject({
        title: "Data security response",
        type: "dropdown",
        required: false,
        defaultValue: "off",
        isAdvanced: true,
      });
      expect(field!.options).toEqual([
        { label: "Off", value: "off" },
        { label: "Block public access and sharing", value: "block" },
      ]);
      expect(field!.description).toContain("approved by a person");
    }

    expect(isCloudConnectionDataSecurityResponseOn("block")).toBe(true);
    expect(isCloudConnectionDataSecurityResponseOn("off")).toBe(false);
    expect(isCloudConnectionDataSecurityResponseOn("Block")).toBe(false);
    expect(isCloudConnectionDataSecurityResponseOn(true)).toBe(false);
    expect(isCloudConnectionDataSecurityResponseOn(undefined)).toBe(false);
    expect(CLOUD_CONNECTION_DATA_SECURITY_RESPONSES).toEqual(["off", "block"]);
  });
});

describe("AWS, configuration", () => {
  test("the role gets a second inline policy of its own, on a line of its own, with exactly the configuration actions", () => {
    const today: Array<string> = getAwsRoleSetupCommand(ROLE).split("\n");
    const lines: Array<string> = getAwsRoleSetupCommand({
      ...ROLE,
      dataSecurity: "configuration",
    }).split("\n");

    expect(lines).toHaveLength(6);
    expect(lines.slice(0, 4)).toEqual(today.slice(0, 4));
    expect(
      lines[4]!.startsWith(
        `aws iam put-role-policy --role-name "$ROLE" --policy-name ${AWS_DATA_SECURITY_POLICY_NAME} --policy-document '`,
      ),
    ).toBe(true);
    expect(JSON.parse(quotedAfter(lines[4]!, "--policy-document"))).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: AWS_DATA_SECURITY_CONFIGURATION_ACTIONS,
          Resource: "*",
        },
      ],
    });
    // The ARN is still what the command prints last.
    expect(lines[5]).toBe(today[4]);
  });

  test("the configuration actions are the reader's, each once, in groups that say what they are for", () => {
    expect([...AWS_DATA_SECURITY_CONFIGURATION_ACTIONS].sort()).toEqual(
      [
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
        "es:ListDomainNames",
        "es:DescribeDomains",
        "elasticache:DescribeReplicationGroups",
        "elasticfilesystem:DescribeFileSystems",
        "kms:ListAliases",
      ].sort(),
    );
    expect(new Set(AWS_DATA_SECURITY_CONFIGURATION_ACTIONS).size).toBe(
      AWS_DATA_SECURITY_CONFIGURATION_ACTIONS.length,
    );

    for (const group of AWS_DATA_SECURITY_CONFIGURATION_ACTION_GROUPS) {
      expect(group.purpose.length).toBeGreaterThan(0);
      expect(group.actions.length).toBeGreaterThan(0);
    }
  });

  test("the read-only policy stays as it is: Data Security's actions are a policy of their own", () => {
    expect(getAwsReadOnlyPolicyDocument()).not.toContain("s3:");
    expect(AWS_READ_ONLY_ACTIONS).not.toContain("s3:GetBucketPolicy");
    expect(AWS_READ_ONLY_ACTIONS).not.toContain("kms:ListAliases");
  });
});

describe("AWS, content", () => {
  test("adds s3:ListBucket on every bucket, s3:GetObject on every object, and kms:Decrypt only through S3", () => {
    const policy: ReturnType<typeof getAwsDataSecurityPolicy> =
      getAwsDataSecurityPolicy("content");

    expect(policy).toEqual({
      Version: "2012-10-17",
      Statement: [
        getAwsDataSecurityPolicy("configuration")!.Statement[0],
        {
          Effect: "Allow",
          Action: ["s3:ListBucket"],
          Resource: "arn:aws:s3:::*",
        },
        {
          Effect: "Allow",
          Action: ["s3:GetObject"],
          Resource: "arn:aws:s3:::*/*",
        },
        {
          Effect: "Allow",
          Action: ["kms:Decrypt"],
          Resource: "*",
          Condition: { StringLike: { "kms:ViaService": "s3.*.amazonaws.com" } },
        },
      ],
    });
    expect(AWS_DATA_SECURITY_CONTENT_ACTIONS).toEqual([
      "s3:ListBucket",
      "s3:GetObject",
      "kms:Decrypt",
    ]);

    // Every kms:Decrypt carries the condition; no other statement has one.
    for (const statement of policy!.Statement) {
      expect([
        statement.Action.join(","),
        Boolean(statement.Condition),
      ]).toEqual([
        statement.Action.join(","),
        statement.Action.includes("kms:Decrypt"),
      ]);
    }
  });

  test("adds exactly the content actions to the configuration ones", () => {
    expect(actionsOf(getAwsDataSecurityPolicy("configuration"))).toEqual(
      AWS_DATA_SECURITY_CONFIGURATION_ACTIONS,
    );
    expect(actionsOf(getAwsDataSecurityPolicy("content"))).toEqual([
      ...AWS_DATA_SECURITY_CONFIGURATION_ACTIONS,
      ...AWS_DATA_SECURITY_CONTENT_ACTIONS,
    ]);
  });
});

describe("AWS, every level", () => {
  test("nothing writes: every action describes, lists or gets - and only content reads objects or decrypts", () => {
    for (const level of ON_LEVELS) {
      for (const action of actionsOf(getAwsDataSecurityPolicy(level))) {
        const [service, name] = action.split(":") as [string, string];
        const readsContent: boolean =
          action === "s3:GetObject" || action === "kms:Decrypt";

        expect([
          level,
          action,
          readsContent || READ_ACTION_NAME.test(name),
        ]).toEqual([level, action, true]);
        expect(name).not.toMatch(WRITE_ACTION_NAME);
        expect(name).not.toContain("*");
        expect(service).not.toContain("*");

        if (level === "configuration") {
          expect([
            "s3:GetObject",
            "s3:ListBucket",
            "kms:Decrypt",
          ]).not.toContain(action);
        }
      }
    }
  });

  test("the inline policies fit what IAM allows: a role's together, a user's, a group's", () => {
    for (const level of ON_LEVELS) {
      const dataSecurity: string = getAwsDataSecurityPolicyDocument(level);

      // A role's inline policies may total 10,240 characters.
      expect(
        getAwsReadOnlyPolicyDocument({ organization: true }).length +
          dataSecurity.length,
      ).toBeLessThan(10240);
      // A group's may total 5,120; the access key's user keeps its 2,048 for the read-only policy.
      expect(dataSecurity.length).toBeLessThan(5120);
      expect(getAwsReadOnlyPolicyDocument().length).toBeLessThan(2048);
    }
  });

  test("the StackSet's template carries both policies, and the organization's command puts them in every account and the management account", () => {
    for (const level of ON_LEVELS) {
      const template: {
        Description: string;
        Resources: {
          OneUptimeReadOnlyRole: {
            Properties: {
              Policies: Array<{ PolicyName: string; PolicyDocument: unknown }>;
            };
          };
        };
      } = JSON.parse(
        getAwsReadOnlyRoleTemplate({ ...ROLE, dataSecurity: level }),
      );

      expect(
        template.Resources.OneUptimeReadOnlyRole.Properties.Policies,
      ).toEqual([
        {
          PolicyName: CLOUD_CONNECTION_READ_ONLY_NAME,
          PolicyDocument: getAwsReadOnlyPolicy(),
        },
        {
          PolicyName: AWS_DATA_SECURITY_POLICY_NAME,
          PolicyDocument: getAwsDataSecurityPolicy(level),
        },
      ]);
      expect(template.Description).toContain("data stores' configuration");

      const command: string = getAwsOrganizationSetupCommand({
        ...ROLE,
        dataSecurity: level,
      });

      expect(JSON.parse(command.split("\n")[1]!)).toEqual(template);
      expect(
        command.endsWith(
          getAwsRoleSetupCommand({
            ...ROLE,
            organization: true,
            dataSecurity: level,
          }),
        ),
      ).toBe(true);
      // Still only the management account's role may list the organization.
      expect(
        command.split("\n").filter((line: string): boolean => {
          return line.includes("organizations:ListAccounts");
        }),
      ).toHaveLength(1);
    }

    expect(
      JSON.parse(
        getAwsReadOnlyRoleTemplate({ ...ROLE, dataSecurity: "content" }),
      ).Description,
    ).toContain("samples of their content");
  });

  test("the access key's user joins a group that carries the policy, created once and put again on every run", () => {
    const user: string = CLOUD_CONNECTION_READ_ONLY_NAME;
    const group: string = AWS_DATA_SECURITY_GROUP_NAME;
    const today: Array<string> = getAwsAccessKeySetupCommand().split("\n");
    const lines: Array<string> = getAwsAccessKeySetupCommand({
      dataSecurity: "content",
    }).split("\n");

    expect(lines).toEqual([
      today[0],
      today[1],
      `aws iam create-group --group-name ${group} > /dev/null 2>&1 || true`,
      expect.stringContaining(
        `aws iam put-group-policy --group-name ${group} --policy-name ${AWS_DATA_SECURITY_POLICY_NAME} --policy-document '`,
      ),
      `aws iam add-user-to-group --user-name ${user} --group-name ${group}`,
      today[2],
    ]);
    expect(JSON.parse(quotedAfter(lines[3]!, "--policy-document"))).toEqual(
      getAwsDataSecurityPolicy("content"),
    );
  });

  test("a lower level replaces the policy, by the same name", () => {
    const configuration: string = getAwsRoleSetupCommand({
      ...ROLE,
      dataSecurity: "configuration",
    });
    const content: string = getAwsRoleSetupCommand({
      ...ROLE,
      dataSecurity: "content",
    });

    expect(configuration.split("\n")[4]!.split("--policy-document")[0]).toBe(
      content.split("\n")[4]!.split("--policy-document")[0],
    );
  });

  test("the quoting holds and nothing is left to fill in", () => {
    for (const level of ON_LEVELS) {
      expect(getAwsDataSecurityPolicyDocument(level)).not.toContain("'");

      for (const command of [
        getAwsRoleSetupCommand({ ...ROLE, dataSecurity: level }),
        getAwsOrganizationSetupCommand({ ...ROLE, dataSecurity: level }),
        getAwsAccessKeySetupCommand({ dataSecurity: level }),
        getAzureSetupCommand(CloudConnectionSetupScope.Account, level),
        getGcpSetupCommand(CloudConnectionSetupScope.Organization, level),
      ]) {
        expect(command).not.toMatch(/<[A-Z_]+>/);
        expect(command).not.toContain("${");
      }
    }
  });
});

describe("Azure and Google Cloud", () => {
  test("Azure: configuration needs nothing more; content adds Storage Blob Data Reader on the same scope", () => {
    for (const scope of SCOPES) {
      expect(getAzureSetupCommand(scope, "configuration")).toBe(
        getAzureSetupCommand(scope),
      );

      const today: Array<string> = getAzureSetupCommand(scope).split("\n");

      expect(getAzureSetupCommand(scope, "content").split("\n")).toEqual([
        ...today.slice(0, 3),
        `az role assignment create --assignee "$APP" --role "Storage Blob Data Reader" --scope "$SCOPE" > /dev/null`,
        ...today.slice(3),
      ]);
    }

    expect(AZURE_DATA_SECURITY_CONTENT_ROLE).toBe("Storage Blob Data Reader");
  });

  test("Google Cloud: configuration needs nothing more; content adds the object and dataset readers and the BigQuery API", () => {
    const member: string = `${GCP_SERVICE_ACCOUNT_ID}@$PROJECT_ID.iam.gserviceaccount.com`;

    expect(GCP_DATA_SECURITY_CONTENT_ROLES).toEqual([
      "roles/storage.objectViewer",
      "roles/bigquery.dataViewer",
    ]);
    expect(GCP_DATA_SECURITY_CONTENT_SERVICES).toEqual([
      "bigquery.googleapis.com",
    ]);

    for (const scope of SCOPES) {
      expect(getGcpSetupCommand(scope, "configuration")).toBe(
        getGcpSetupCommand(scope),
      );

      const lines: Array<string> = getGcpSetupCommand(scope, "content").split(
        "\n",
      );
      const bindings: Array<string> = lines.filter((line: string): boolean => {
        return line.includes("add-iam-policy-binding");
      });

      expect(lines).toContain(
        `gcloud services enable ${[...GCP_SERVICES, "bigquery.googleapis.com"].join(" ")}`,
      );
      expect(bindings).toEqual(
        [...GCP_READ_ONLY_ROLES, ...GCP_DATA_SECURITY_CONTENT_ROLES].map(
          (role: string): string => {
            return scope === CloudConnectionSetupScope.Organization
              ? `gcloud organizations add-iam-policy-binding "$ORG_ID" --member "serviceAccount:${member}" --role ${role} --condition=None > /dev/null`
              : `gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${member}" --role ${role} --condition=None > /dev/null`;
          },
        ),
      );
    }
  });

  test("the one command each form shows takes the level", () => {
    for (const level of CLOUD_CONNECTION_DATA_SECURITY_LEVELS) {
      expect(
        getCloudConnectionSetupCommand(
          CloudProvider.AWS,
          CloudConnectionAuthMethod.AwsRole,
          { ...ROLE, dataSecurity: level },
        ),
      ).toBe(getAwsRoleSetupCommand({ ...ROLE, dataSecurity: level }));
      expect(
        getCloudConnectionSetupCommand(
          CloudProvider.AWS,
          CloudConnectionAuthMethod.AwsRole,
          {
            ...ROLE,
            scope: CloudConnectionSetupScope.Organization,
            dataSecurity: level,
          },
        ),
      ).toBe(getAwsOrganizationSetupCommand({ ...ROLE, dataSecurity: level }));
      expect(
        getCloudConnectionSetupCommand(
          CloudProvider.AWS,
          CloudConnectionAuthMethod.AwsAccessKey,
          { dataSecurity: level },
        ),
      ).toBe(getAwsAccessKeySetupCommand({ dataSecurity: level }));
      expect(
        getCloudConnectionSetupCommand(
          CloudProvider.Azure,
          CloudConnectionAuthMethod.AzureClientSecret,
          { dataSecurity: level },
        ),
      ).toBe(getAzureSetupCommand(CloudConnectionSetupScope.Account, level));
      expect(
        getCloudConnectionSetupCommand(
          CloudProvider.GCP,
          CloudConnectionAuthMethod.GcpServiceAccountKey,
          {
            scope: CloudConnectionSetupScope.Organization,
            dataSecurity: level,
          },
        ),
      ).toBe(getGcpSetupCommand(CloudConnectionSetupScope.Organization, level));
    }
  });
});

describe("the form's Data security setting", () => {
  test("every cloud asks for it, folded, off unless chosen", () => {
    for (const definition of CloudConnectionCatalog) {
      const field: CloudConnectionField | undefined =
        definition.configFields.find(
          (candidate: CloudConnectionField): boolean => {
            return candidate.key === DATA_SECURITY_FIELD_KEY;
          },
        );

      expect(field).toMatchObject({
        type: "dropdown",
        required: false,
        defaultValue: "off",
        isAdvanced: true,
      });
      expect(field!.authMethods).toBeUndefined();
      expect(
        (field!.options || []).map((option: { value: string }): string => {
          return option.value;
        }),
      ).toEqual(["off", "configuration", "content"]);
    }
  });

  test("a stored level is one of the three, else off", () => {
    expect(getCloudConnectionDataSecurityLevel("content")).toBe("content");
    expect(getCloudConnectionDataSecurityLevel("configuration")).toBe(
      "configuration",
    );
    expect(getCloudConnectionDataSecurityLevel("everything")).toBe("off");
    expect(getCloudConnectionDataSecurityLevel(undefined)).toBe("off");
    expect(CLOUD_CONNECTION_DATA_SECURITY_LEVELS).toEqual([
      "off",
      "configuration",
      "content",
    ]);
  });

  test("what each cloud says it reads is unchanged: never data or secrets, as off and configuration keep", () => {
    for (const definition of CloudConnectionCatalog as Array<CloudConnectionDefinition>) {
      expect(definition.explanation.endsWith("Never data or secrets.")).toBe(
        true,
      );
    }
  });
});
