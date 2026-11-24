import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudSavingsActionsAccess,
  getCloudSavingsActionsAccess,
} from "../../../../Types/Cloud/CloudSavingsAction";
import {
  CloudConnectionAuthMethod,
  SAVINGS_ACTIONS_FIELD_KEY,
  getCloudConnectionDefinition,
  isCloudConnectionSavingsActionsOn,
} from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  CloudConnectionAccessExtra,
  CloudConnectionSetupScope,
  getAwsAccessKeySetupCommand,
  getAwsReadOnlyRoleTemplate,
  getAwsRoleSetupCommand,
  getAzureSetupCommand,
  getCloudConnectionAccessExtras,
  getCloudConnectionCommandSettings,
  getCloudConnectionSetupCommand,
  getGcpSetupCommand,
} from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import {
  AWS_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS,
  AWS_SAVINGS_ACTIONS_POLICY_NAME,
  AWS_SAVINGS_ACTIONS_RESIZE_ACTIONS,
  AWS_SAVINGS_ACTIONS_TAG_ON_CREATE,
  AZURE_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS,
  AZURE_SAVINGS_ACTIONS_RESIZE_ACTIONS,
  AZURE_SAVINGS_ACTIONS_ROLE,
  GCP_SAVINGS_ACTIONS_CLEAN_UP_PERMISSIONS,
  GCP_SAVINGS_ACTIONS_RESIZE_PERMISSIONS,
  GCP_SAVINGS_ACTIONS_ROLE_ID,
  getAwsSavingsActionsPolicy,
} from "../../../../Types/CloudConnection/CloudSavingsActionsAccess";
import { JSONObject } from "../../../../Types/JSON";

/*
 * WHAT ONEUPTIME DOES TO A CLOUD FOR A SAVING IS WHAT THE COMMAND GRANTS
 * (#11010) - and nothing at all until someone picks it.
 *
 *   - Each cloud's savings actions name the permission of every call they
 *     make, in the refusal that says which one was missing; those are
 *     exactly the "Savings actions" grant for that cloud: AWS's policy,
 *     Azure's and Google Cloud's custom roles. A call added without its
 *     permission, or a permission granted that nothing calls, fails here.
 *   - With the setting off, no command holds a line of it; "clean-up"
 *     grants no resize; "resize" grants both.
 *   - The form reads the setting as the server does, so the command a
 *     person runs grants what the server will use.
 */

// packages/Common/Tests/Server/Utils/CloudSavings -> packages/Common.
const COMMON: string = path.resolve(__dirname, "..", "..", "..", "..");

function source(file: string): string {
  return fs.readFileSync(path.join(COMMON, file), "utf8");
}

const DOUBLE_QUOTED: RegExp = /"([^"\n]*)"/g;

function quoted(code: string): Set<string> {
  return new Set(
    Array.from(code.matchAll(DOUBLE_QUOTED)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    ),
  );
}

const AWS_IAM_ACTION: RegExp = /^(ec2|rds):[A-Z][A-Za-z]+$/;
const AZURE_RBAC_ACTION: RegExp = /^Microsoft\.[A-Za-z]+\/[A-Za-z/]+$/;
// A permission, never the API it belongs to ("compute.googleapis.com").
const GCP_PERMISSION: RegExp = /^compute\.(?!googleapis\.)[a-zA-Z]+\.[a-zA-Z]+$/;

function sorted(values: Iterable<string>): Array<string> {
  return Array.from(new Set(values)).sort();
}

const SETTINGS_CHOICES: Array<CloudSavingsActionsAccess> = [
  CloudSavingsActionsAccess.Off,
  CloudSavingsActionsAccess.CleanUp,
  CloudSavingsActionsAccess.Resize,
];

describe("each cloud's savings actions call exactly what is granted", () => {
  test("AWS: every IAM action the module names is granted, and every one granted is named", () => {
    const code: string = source(
      "Server/Utils/CloudSavings/Cloud/AwsSavingsActions.ts",
    );
    const named: Array<string> = sorted(
      Array.from(quoted(code)).filter((text: string): boolean => {
        return AWS_IAM_ACTION.test(text);
      }),
    );

    expect(named).toEqual(
      sorted([
        ...AWS_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS,
        ...AWS_SAVINGS_ACTIONS_RESIZE_ACTIONS,
      ]),
    );
  });

  test("AWS: every Query action the module sends is one of the granted actions", () => {
    const code: string = source(
      "Server/Utils/CloudSavings/Cloud/AwsSavingsActions.ts",
    );
    const sent: Array<string> = sorted(
      Array.from(code.matchAll(/Action: "([A-Z][A-Za-z]+)"/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    );
    const granted: Array<string> = [
      ...AWS_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS,
      ...AWS_SAVINGS_ACTIONS_RESIZE_ACTIONS,
    ].map((action: string): string => {
      return action.split(":")[1]!;
    });

    expect(sent.length).toBeGreaterThan(10);

    for (const action of sent) {
      expect(granted).toContain(action);
    }

    // The two state changes are sent by name through a variable.
    expect(code).toContain('"StopInstances" | "StartInstances"');
    expect(code).toContain('"StopDBInstance" | "StartDBInstance"');
  });

  test("Azure: every RBAC action the module names is granted, and every one granted is named", () => {
    const code: string = source(
      "Server/Utils/CloudSavings/Cloud/AzureSavingsActions.ts",
    );
    const named: Array<string> = sorted(
      Array.from(quoted(code)).filter((text: string): boolean => {
        return AZURE_RBAC_ACTION.test(text);
      }),
    );

    expect(named).toEqual(
      sorted([
        ...AZURE_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS,
        ...AZURE_SAVINGS_ACTIONS_RESIZE_ACTIONS,
      ]),
    );
  });

  test("Google Cloud: every permission the module names is granted, and every one granted is named", () => {
    const code: string = source(
      "Server/Utils/CloudSavings/Cloud/GcpSavingsActions.ts",
    );
    const named: Array<string> = sorted(
      Array.from(quoted(code)).filter((text: string): boolean => {
        return GCP_PERMISSION.test(text);
      }),
    );

    expect(named).toEqual(
      sorted([
        ...GCP_SAVINGS_ACTIONS_CLEAN_UP_PERMISSIONS,
        ...GCP_SAVINGS_ACTIONS_RESIZE_PERMISSIONS,
      ]),
    );
  });
});

describe("the AWS policy", () => {
  test("is nothing when off, and tags only what it makes", () => {
    expect(
      getAwsSavingsActionsPolicy(CloudSavingsActionsAccess.Off),
    ).toBeNull();

    const policy: ReturnType<typeof getAwsSavingsActionsPolicy> =
      getAwsSavingsActionsPolicy(CloudSavingsActionsAccess.CleanUp)!;

    expect(policy.Statement).toHaveLength(2);
    expect(policy.Statement[1]).toEqual({
      Effect: "Allow",
      Action: ["ec2:CreateTags"],
      Resource: "*",
      Condition: {
        StringEquals: {
          "ec2:CreateAction": [...AWS_SAVINGS_ACTIONS_TAG_ON_CREATE],
        },
      },
    });
  });

  test("clean-up grants no resize; resize grants both", () => {
    const cleanUp: Array<string> = getAwsSavingsActionsPolicy(
      CloudSavingsActionsAccess.CleanUp,
    )!.Statement[0]!.Action;
    const resize: Array<string> = getAwsSavingsActionsPolicy(
      CloudSavingsActionsAccess.Resize,
    )!.Statement[0]!.Action;

    expect(cleanUp).toEqual([...AWS_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS]);
    expect(cleanUp).not.toContain("ec2:ModifyInstanceAttribute");
    expect(cleanUp).not.toContain("rds:ModifyDBInstance");
    expect(resize).toEqual([
      ...AWS_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS,
      ...AWS_SAVINGS_ACTIONS_RESIZE_ACTIONS,
    ]);
  });

  test("never grants a terminate, a delete of anything but disks and snapshots, or a sign-in change", () => {
    const actions: Array<string> = getAwsSavingsActionsPolicy(
      CloudSavingsActionsAccess.Resize,
    )!.Statement.flatMap((statement: { Action: Array<string> }) => {
      return statement.Action;
    });

    for (const action of actions) {
      expect(action).not.toMatch(
        /Terminate|DeleteDBInstance|iam:|Delete(?!Volume|Snapshot)/,
      );
    }
  });
});

describe("the commands", () => {
  const role: {
    trustedPrincipalArn: string;
    externalId: string;
  } = {
    trustedPrincipalArn: "arn:aws:iam::999988887777:root",
    externalId: "oneuptime-0123456789abcdef0123456789abcdef",
  };

  test("off: no command holds a line of it", () => {
    for (const command of [
      getAwsRoleSetupCommand(role),
      getAwsAccessKeySetupCommand({}),
      getAzureSetupCommand(),
      getGcpSetupCommand(),
      getAwsReadOnlyRoleTemplate(role),
    ]) {
      expect(command).not.toContain(AWS_SAVINGS_ACTIONS_POLICY_NAME);
      expect(command).not.toContain(AZURE_SAVINGS_ACTIONS_ROLE);
      expect(command).not.toContain(GCP_SAVINGS_ACTIONS_ROLE_ID);
    }
  });

  test("AWS role: one more inline policy, with the actions of the choice", () => {
    const command: string = getAwsRoleSetupCommand({
      ...role,
      savingsActions: CloudSavingsActionsAccess.CleanUp,
    });
    const line: string = command.split("\n").find((each: string) => {
      return each.includes(AWS_SAVINGS_ACTIONS_POLICY_NAME);
    })!;

    expect(line).toContain(
      `aws iam put-role-policy --role-name "$ROLE" --policy-name ${AWS_SAVINGS_ACTIONS_POLICY_NAME} --policy-document '`,
    );
    expect(line).toContain("ec2:DeleteVolume");
    expect(line).not.toContain("ec2:ModifyInstanceAttribute");
    // The role's ARN is still what the command prints last.
    expect(command.split("\n").pop()).toContain("aws iam get-role");
  });

  test("AWS access key: a group of its own, the user added to it", () => {
    const command: string = getAwsAccessKeySetupCommand({
      savingsActions: CloudSavingsActionsAccess.Resize,
    });

    expect(command).toContain(
      `aws iam create-group --group-name ${AWS_SAVINGS_ACTIONS_POLICY_NAME}`,
    );
    expect(command).toContain(
      `aws iam add-user-to-group --user-name OneUptimeReadOnly --group-name ${AWS_SAVINGS_ACTIONS_POLICY_NAME}`,
    );
    expect(command).toContain("rds:ModifyDBInstance");
    expect(command.split("\n").pop()).toContain("aws iam create-access-key");
  });

  test("AWS organization: every account's role takes the policy, and says it may act", () => {
    const template: JSONObject = JSON.parse(
      getAwsReadOnlyRoleTemplate({
        ...role,
        savingsActions: CloudSavingsActionsAccess.CleanUp,
      }),
    );
    const resources: JSONObject = template["Resources"] as JSONObject;
    const policies: Array<JSONObject> = (
      (resources["OneUptimeReadOnlyRole"] as JSONObject)[
        "Properties"
      ] as JSONObject
    )["Policies"] as Array<JSONObject>;

    expect(
      policies.map((policy: JSONObject): unknown => {
        return policy["PolicyName"];
      }),
    ).toContain(AWS_SAVINGS_ACTIONS_POLICY_NAME);
    expect(String(template["Description"])).toContain(
      "act on the savings an owner approves",
    );
    expect(String(template["Description"])).not.toContain("can only read");
  });

  test("Azure: a custom role on the same scope, with resize only when picked", () => {
    const cleanUp: string = getAzureSetupCommand(
      CloudConnectionSetupScope.Account,
      "off",
      "off",
      "off",
      CloudSavingsActionsAccess.CleanUp,
    );
    const resize: string = getAzureSetupCommand(
      CloudConnectionSetupScope.Organization,
      "off",
      "off",
      "off",
      CloudSavingsActionsAccess.Resize,
    );

    expect(cleanUp).toContain(`Name: "${AZURE_SAVINGS_ACTIONS_ROLE}"`);
    expect(cleanUp).toContain(
      `az role assignment create --assignee "$APP" --role "${AZURE_SAVINGS_ACTIONS_ROLE}" --scope "$SCOPE"`,
    );
    expect(cleanUp).not.toContain("Microsoft.Compute/virtualMachines/write");
    expect(resize).toContain('"Microsoft.Compute/virtualMachines/write"');
    // The expiry is still the last thing it prints.
    expect(cleanUp.split("\n").pop()).toContain("endDateTime");
  });

  test("Google Cloud: the Compute API and a custom role, bound where the command binds", () => {
    const project: string = getGcpSetupCommand(
      CloudConnectionSetupScope.Account,
      "off",
      "off",
      "off",
      CloudSavingsActionsAccess.CleanUp,
    );
    const organization: string = getGcpSetupCommand(
      CloudConnectionSetupScope.Organization,
      "off",
      "off",
      "off",
      CloudSavingsActionsAccess.Resize,
    );

    expect(project).toContain("gcloud services enable compute.googleapis.com");
    expect(project).toContain(
      `gcloud iam roles create ${GCP_SAVINGS_ACTIONS_ROLE_ID} --project "$PROJECT_ID"`,
    );
    expect(project).toContain(
      `--role projects/$PROJECT_ID/roles/${GCP_SAVINGS_ACTIONS_ROLE_ID}`,
    );
    expect(project).not.toContain("compute.instances.setMachineType");
    expect(organization).toContain(
      `--role organizations/$ORG_ID/roles/${GCP_SAVINGS_ACTIONS_ROLE_ID}`,
    );
    expect(organization).toContain("compute.instances.setMachineType");
    // The key is still the last thing it prints.
    expect(project.split("\n").pop()).toBe(
      "cat oneuptime-key.json && rm oneuptime-key.json",
    );
  });
});

describe("the form and the server read the setting alike", () => {
  test.each([
    [undefined],
    ["off"],
    ["clean-up"],
    ["resize"],
    ["on"],
    ["RESIZE"],
    [3],
  ])("%s", (value: unknown) => {
    const config: JSONObject =
      value === undefined
        ? {}
        : { [SAVINGS_ACTIONS_FIELD_KEY]: value as string };

    expect(getCloudConnectionCommandSettings(config).savingsActions).toBe(
      getCloudSavingsActionsAccess(value),
    );
  });

  test("every choice the form offers is a level the server knows, off first and by default", () => {
    for (const provider of Object.values(CloudProvider)) {
      const field: ReturnType<
        typeof getCloudConnectionDefinition
      >["configFields"][number] = getCloudConnectionDefinition(
        provider,
      )!.configFields.find((candidate: { key: string }): boolean => {
        return candidate.key === SAVINGS_ACTIONS_FIELD_KEY;
      })!;

      expect(field.defaultValue).toBe("off");
      expect(field.isAdvanced).toBe(true);
      expect(field.changesSetupCommand).toBe(true);
      expect(
        field.options!.map((option: { value: string }): string => {
          return option.value;
        }),
      ).toEqual(SETTINGS_CHOICES);
    }
  });

  test("the command a form shows for a choice grants what the choice needs, through every sign-in method", () => {
    for (const choice of SETTINGS_CHOICES) {
      const commands: Array<string | undefined> = [
        getCloudConnectionSetupCommand(
          CloudProvider.AWS,
          CloudConnectionAuthMethod.AwsRole,
          { ...role(), savingsActions: choice },
        ),
        getCloudConnectionSetupCommand(
          CloudProvider.AWS,
          CloudConnectionAuthMethod.AwsAccessKey,
          { savingsActions: choice },
        ),
        getCloudConnectionSetupCommand(
          CloudProvider.Azure,
          CloudConnectionAuthMethod.AzureClientSecret,
          { savingsActions: choice },
        ),
        getCloudConnectionSetupCommand(
          CloudProvider.GCP,
          CloudConnectionAuthMethod.GcpServiceAccountKey,
          { savingsActions: choice },
        ),
      ];

      for (const command of commands) {
        const grants: boolean =
          command!.includes(AWS_SAVINGS_ACTIONS_POLICY_NAME) ||
          command!.includes(AZURE_SAVINGS_ACTIONS_ROLE) ||
          command!.includes(GCP_SAVINGS_ACTIONS_ROLE_ID);

        expect(grants).toBe(isCloudConnectionSavingsActionsOn(choice));
      }
    }

    function role(): { trustedPrincipalArn: string; externalId: string } {
      return {
        trustedPrincipalArn: "arn:aws:iam::999988887777:root",
        externalId: "oneuptime-0123456789abcdef0123456789abcdef",
      };
    }
  });

  test("the lines under the command say it may act, and resize, as picked", () => {
    expect(
      getCloudConnectionAccessExtras({
        savingsActions: CloudSavingsActionsAccess.Off,
      }),
    ).toEqual([]);
    expect(
      getCloudConnectionAccessExtras({
        savingsActions: CloudSavingsActionsAccess.CleanUp,
        provider: CloudProvider.Azure,
      }),
    ).toEqual([CloudConnectionAccessExtra.SavingsActions]);
    expect(
      getCloudConnectionAccessExtras({
        savingsActions: CloudSavingsActionsAccess.Resize,
        provider: CloudProvider.GCP,
      }),
    ).toEqual([
      CloudConnectionAccessExtra.SavingsActions,
      CloudConnectionAccessExtra.SavingsResize,
    ]);
  });
});
