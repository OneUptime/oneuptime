import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_CONNECTION_SECURITY_CASE_CHECKS_CHOICES,
  CloudConnectionAuthMethod,
  CloudConnectionSecurityCaseChecks,
  SECURITY_CASE_CHECKS_FIELD_KEY,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  AWS_DATA_SECURITY_GROUP_NAME,
  AWS_READ_ONLY_ACTIONS,
  AWS_SECURITY_CASE_CHECKS_ACTIONS,
  AWS_SECURITY_CASE_CHECKS_GROUP_NAME,
  AWS_SECURITY_CASE_CHECKS_POLICY_NAME,
  AwsPolicyStatement,
  CLOUD_CONNECTION_READ_ONLY_NAME,
  CloudConnectionSetupScope,
  getAwsAccessKeySetupCommand,
  getAwsDataSecurityPolicyDocument,
  getAwsDataSecurityResponsePolicyDocument,
  getAwsExternalIdForProject,
  getAwsOrganizationSetupCommand,
  getAwsReadOnlyPolicyDocument,
  getAwsReadOnlyRoleTemplate,
  getAwsRoleSetupCommand,
  getAwsSecurityCaseChecksPolicy,
  getAwsSecurityCaseChecksPolicyDocument,
  getAwsWafBlocklistGroupName,
  getAwsWafBlocklistPolicyDocument,
  getCloudConnectionCommandSettings,
  getCloudConnectionSetupCommand,
} from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { CloudSavingsActionsAccess } from "../../../Types/Cloud/CloudSavingsAction";
import { getAwsSavingsActionsPolicyDocument } from "../../../Types/CloudConnection/CloudSavingsActionsAccess";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * SECURITY CASE CHECKS (#10900, #11038): what a security case may read of
 * the IAM users and roles an attack changed, granted on a setting of its
 * own.
 *
 * Off - every connection until someone turns it on - the commands are the
 * ones connections had before it, byte for byte. On, they add one policy,
 * OneUptimeSecurityCaseChecks: the ten reads the step "Undo what changed
 * on the account" makes of a user or a role (held to the calls it makes by
 * CloudConnectionCommandNeeds.test.ts), each a Get or a List, none that
 * reads a secret or a policy's document, none that writes. A role takes
 * it as a fifth inline policy, every member account's role through the
 * organization's StackSet, and the access key's user - whose own inline
 * policies are full - through a group of the same name. Every inline
 * policy a role may hold still fits what IAM allows, with every setting
 * on, Savings actions' included.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const EXTERNAL_ID: string = getAwsExternalIdForProject(PROJECT);
const ROLE: { trustedPrincipalArn: string; externalId: string } = {
  trustedPrincipalArn: "arn:aws:iam::999988887777:root",
  externalId: EXTERNAL_ID,
};
const LINE_BREAK: string = "\n";
// An IAM action that only reads: a Get or a List.
const IAM_READ: RegExp = /^iam:(Get|List)[A-Z][A-Za-z]+$/;
// What a policy line puts, before its document.
const POLICY_DOCUMENT: string = " --policy-document '";

// Every inline policy a role may hold, with every setting at its most.
function everyRolePolicy(
  securityCaseChecks: CloudConnectionSecurityCaseChecks,
): Array<string> {
  return [
    getAwsReadOnlyPolicyDocument({ organization: true }),
    getAwsDataSecurityPolicyDocument("content"),
    getAwsDataSecurityResponsePolicyDocument("block"),
    getAwsWafBlocklistPolicyDocument("rule", EXTERNAL_ID),
    getAwsSecurityCaseChecksPolicyDocument(securityCaseChecks),
    getAwsSavingsActionsPolicyDocument(CloudSavingsActionsAccess.Resize),
  ].filter((document: string): boolean => {
    return document.length > 0;
  });
}

// IAM counts a policy's characters but its whitespace; the commands write none.
function iamLength(document: string): number {
  return document.replace(/\s/g, "").length;
}

function linesOf(command: string): Array<string> {
  return command.split(LINE_BREAK);
}

describe("the policy", () => {
  test("is the ten reads a security case makes of a user or a role, on every one, and nothing else", () => {
    expect(AWS_SECURITY_CASE_CHECKS_POLICY_NAME).toBe(
      "OneUptimeSecurityCaseChecks",
    );
    expect([...AWS_SECURITY_CASE_CHECKS_ACTIONS]).toEqual([
      "iam:GetUser",
      "iam:ListAccessKeys",
      "iam:GetLoginProfile",
      "iam:ListAttachedUserPolicies",
      "iam:ListUserPolicies",
      "iam:ListGroupsForUser",
      "iam:ListMFADevices",
      // A role's (#11038): the role and whom it trusts, its managed and its inline policies.
      "iam:GetRole",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
    ]);
    expect(getAwsSecurityCaseChecksPolicy("on")).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [...AWS_SECURITY_CASE_CHECKS_ACTIONS],
          Resource: "*",
        },
      ],
    });
  });

  test("each action only reads, names one call - no wildcard - and none is the read-only policy's already", () => {
    expect(new Set<string>(AWS_SECURITY_CASE_CHECKS_ACTIONS).size).toBe(
      AWS_SECURITY_CASE_CHECKS_ACTIONS.length,
    );

    for (const action of AWS_SECURITY_CASE_CHECKS_ACTIONS) {
      expect({ action, reads: IAM_READ.test(action) }).toEqual({
        action,
        reads: true,
      });
      expect(action).not.toContain("*");
      expect(AWS_READ_ONLY_ACTIONS).not.toContain(action);
    }
  });

  test("never reads a secret: no access key's secret, no password, no MFA seed, no SSH key or certificate body", () => {
    const actions: Array<string> = [...AWS_SECURITY_CASE_CHECKS_ACTIONS];

    for (const secret of [
      // A key's last use is not needed, and the secret is never readable: nothing that creates one.
      "iam:CreateAccessKey",
      // The password is never readable; GetLoginProfile says only that one is set, and since when.
      "iam:UpdateLoginProfile",
      // A virtual MFA device's seed comes only from creating it.
      "iam:CreateVirtualMFADevice",
      "iam:ListVirtualMFADevices",
      "iam:GetSSHPublicKey",
      "iam:ListSSHPublicKeys",
      "iam:ListSigningCertificates",
      "iam:ListServiceSpecificCredentials",
      "iam:GetUserPolicy",
      "iam:GetPolicyVersion",
      "iam:GenerateCredentialReport",
      "iam:GetCredentialReport",
      "iam:GetAccountAuthorizationDetails",
      // A role's inline policy is read by its name alone, never its document (#11038).
      "iam:GetRolePolicy",
      "iam:ListRoles",
    ]) {
      expect({ secret, granted: actions.includes(secret) }).toEqual({
        secret,
        granted: false,
      });
    }
  });

  test("never writes to a role: OneUptime deletes and edits nothing, the undoing is a person's (#11038)", () => {
    for (const write of [
      "iam:DeleteRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:DetachRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:PutRolePolicy",
      "iam:UpdateRole",
      "iam:TagRole",
      "iam:PassRole",
    ]) {
      expect({
        write,
        granted: AWS_SECURITY_CASE_CHECKS_ACTIONS.includes(write),
      }).toEqual({ write, granted: false });
    }
  });

  test("off - or anything but on - is no policy at all", () => {
    for (const choice of ["off", undefined, "On", " on ", "rule"] as Array<
      CloudConnectionSecurityCaseChecks | undefined
    >) {
      expect({
        choice,
        policy: getAwsSecurityCaseChecksPolicy(choice),
      }).toEqual({ choice, policy: null });
      expect(getAwsSecurityCaseChecksPolicyDocument(choice)).toBe("");
    }

    expect([...CLOUD_CONNECTION_SECURITY_CASE_CHECKS_CHOICES]).toEqual([
      "off",
      "on",
    ]);
  });

  test("its document can be quoted in a shell's single quotes, and is the policy as JSON", () => {
    const document: string = getAwsSecurityCaseChecksPolicyDocument("on");

    expect(document).not.toContain("'");
    expect(document).not.toMatch(/\s/);
    expect(JSON.parse(document)).toEqual(getAwsSecurityCaseChecksPolicy("on"));
  });

  test("fits what IAM allows: every inline policy a role may hold together, a group's, and the access key's user keeps its own", () => {
    const every: Array<string> = everyRolePolicy("on");
    const total: number = every.reduce(
      (sum: number, document: string): number => {
        return sum + iamLength(document);
      },
      0,
    );

    // The read-only, Data Security's two, the blocklist's, this one and Savings actions'.
    expect(every).toHaveLength(6);
    // A role's inline policies may total 10,240 characters: with every setting on, about half of it.
    expect(total).toBeLessThan(10240);
    expect(total).toBeLessThan(6000);
    // The role reads (#11038) add 68 characters to this policy, which stays small.
    expect(iamLength(getAwsSecurityCaseChecksPolicyDocument("on"))).toBe(307);
    // A group's may total 5,120: the access key's user takes this policy through its own group.
    expect(
      iamLength(getAwsSecurityCaseChecksPolicyDocument("on")),
    ).toBeLessThan(5120);
    // The access key's user keeps its 2,048 for the read-only policy, as before.
    expect(iamLength(getAwsReadOnlyPolicyDocument())).toBeLessThan(2048);
  });

  test("every inline policy a role may hold fits whichever of them a connection turns on", () => {
    const documents: Array<string> = everyRolePolicy("on");

    // Each subset: a connection turns its settings on one by one.
    for (let mask: number = 0; mask < 1 << documents.length; mask++) {
      const total: number = documents
        .filter((_: string, index: number): boolean => {
          return (mask & (1 << index)) !== 0;
        })
        .reduce((sum: number, document: string): number => {
          return sum + iamLength(document);
        }, 0);

      expect({ mask, fits: total < 10240 }).toEqual({ mask, fits: true });
    }
  });
});

describe("the role's command", () => {
  test("off, it is the command it always was, byte for byte", () => {
    for (const organization of [false, true]) {
      expect(
        getAwsRoleSetupCommand({
          ...ROLE,
          organization,
          securityCaseChecks: "off",
        }),
      ).toBe(getAwsRoleSetupCommand({ ...ROLE, organization }));
    }
  });

  test("on, it adds one line, the fifth policy, just before it prints the role's ARN", () => {
    for (const organization of [false, true]) {
      const off: Array<string> = linesOf(
        getAwsRoleSetupCommand({ ...ROLE, organization }),
      );
      const on: Array<string> = linesOf(
        getAwsRoleSetupCommand({
          ...ROLE,
          organization,
          securityCaseChecks: "on",
        }),
      );
      const line: string = `aws iam put-role-policy --role-name "$ROLE" --policy-name ${AWS_SECURITY_CASE_CHECKS_POLICY_NAME}${POLICY_DOCUMENT}${getAwsSecurityCaseChecksPolicyDocument("on")}'`;

      expect(on).toEqual([...off.slice(0, -1), line, off[off.length - 1]]);
      expect(on[on.length - 1]).toBe(
        'aws iam get-role --role-name "$ROLE" --query Role.Arn --output text',
      );
    }
  });

  test("with every other setting on, it still adds only its own line, after theirs", () => {
    const everything: {
      dataSecurity: "content";
      dataSecurityResponse: "block";
      wafBlocklist: "rule";
    } = {
      dataSecurity: "content",
      dataSecurityResponse: "block",
      wafBlocklist: "rule",
    };
    const off: Array<string> = linesOf(
      getAwsRoleSetupCommand({ ...ROLE, ...everything }),
    );
    const on: Array<string> = linesOf(
      getAwsRoleSetupCommand({
        ...ROLE,
        ...everything,
        securityCaseChecks: "on",
      }),
    );
    const policies: Array<string> = on
      .filter((line: string): boolean => {
        return line.startsWith('aws iam put-role-policy --role-name "$ROLE"');
      })
      .map((line: string): string => {
        return line.split("--policy-name ")[1]!.split(" ")[0]!;
      });

    expect(on.length).toBe(off.length + 1);
    expect(policies).toEqual([
      CLOUD_CONNECTION_READ_ONLY_NAME,
      "OneUptimeDataSecurity",
      "OneUptimeDataSecurityResponse",
      "OneUptimeWafBlocklist",
      AWS_SECURITY_CASE_CHECKS_POLICY_NAME,
    ]);
  });
});

describe("the organization's StackSet", () => {
  interface Template {
    Description: string;
    Resources: {
      OneUptimeReadOnlyRole: {
        Properties: {
          Policies: Array<{
            PolicyName: string;
            PolicyDocument: { Statement: Array<AwsPolicyStatement> };
          }>;
        };
      };
    };
  }

  function templateOf(
    securityCaseChecks: CloudConnectionSecurityCaseChecks | undefined,
  ): Template {
    return JSON.parse(
      getAwsReadOnlyRoleTemplate({ ...ROLE, securityCaseChecks }),
    ) as Template;
  }

  test("puts the policy in every member account's role once on, and says what the role reads", () => {
    const on: Template = templateOf("on");
    const policies: Template["Resources"]["OneUptimeReadOnlyRole"]["Properties"]["Policies"] =
      on.Resources.OneUptimeReadOnlyRole.Properties.Policies;

    expect(
      policies.map((policy: { PolicyName: string }): string => {
        return policy.PolicyName;
      }),
    ).toEqual([
      CLOUD_CONNECTION_READ_ONLY_NAME,
      AWS_SECURITY_CASE_CHECKS_POLICY_NAME,
    ]);
    expect(policies[1]!.PolicyDocument).toEqual(
      getAwsSecurityCaseChecksPolicy("on"),
    );
    // It only reads, so the role still "can only read".
    expect(on.Description).toBe(
      "OneUptime: a role that can only read this account's metrics, resources, changes and health events, and which keys, console passwords, policies, groups and MFA devices its IAM users have, and which policies its IAM roles have and whom they trust.",
    );
    // CloudFormation holds a description to 1,024 characters.
    expect(on.Description.length).toBeLessThanOrEqual(1024);
  });

  test("off, the template is the one it always was", () => {
    expect(
      getAwsReadOnlyRoleTemplate({ ...ROLE, securityCaseChecks: "off" }),
    ).toBe(getAwsReadOnlyRoleTemplate(ROLE));
    expect(templateOf(undefined).Description).toBe(
      "OneUptime: a role that can only read this account's metrics, resources, changes and health events.",
    );
  });

  test("the organization's command gives the management account's role the policy too", () => {
    const command: Array<string> = linesOf(
      getAwsOrganizationSetupCommand({ ...ROLE, securityCaseChecks: "on" }),
    );

    expect(
      command.filter((line: string): boolean => {
        return line.includes(
          `--policy-name ${AWS_SECURITY_CASE_CHECKS_POLICY_NAME}${POLICY_DOCUMENT}`,
        );
      }),
    ).toHaveLength(1);
    expect(command[1]).toBe(
      getAwsReadOnlyRoleTemplate({ ...ROLE, securityCaseChecks: "on" }),
    );
    expect(
      getAwsOrganizationSetupCommand({ ...ROLE, securityCaseChecks: "off" }),
    ).toBe(getAwsOrganizationSetupCommand(ROLE));
  });
});

describe("the access key's command", () => {
  test("off, it is the command it always was, byte for byte", () => {
    expect(getAwsAccessKeySetupCommand({ securityCaseChecks: "off" })).toBe(
      getAwsAccessKeySetupCommand(),
    );
  });

  test("on, the user joins a group of the policy's name - its own inline policies are full - and the key is made last", () => {
    const off: Array<string> = linesOf(getAwsAccessKeySetupCommand());
    const on: Array<string> = linesOf(
      getAwsAccessKeySetupCommand({ securityCaseChecks: "on" }),
    );

    expect(AWS_SECURITY_CASE_CHECKS_GROUP_NAME).toBe(
      AWS_SECURITY_CASE_CHECKS_POLICY_NAME,
    );
    expect(on).toEqual([
      ...off.slice(0, -1),
      `aws iam create-group --group-name ${AWS_SECURITY_CASE_CHECKS_GROUP_NAME} > /dev/null 2>&1 || true`,
      `aws iam put-group-policy --group-name ${AWS_SECURITY_CASE_CHECKS_GROUP_NAME} --policy-name ${AWS_SECURITY_CASE_CHECKS_POLICY_NAME}${POLICY_DOCUMENT}${getAwsSecurityCaseChecksPolicyDocument("on")}'`,
      `aws iam add-user-to-group --user-name ${CLOUD_CONNECTION_READ_ONLY_NAME} --group-name ${AWS_SECURITY_CASE_CHECKS_GROUP_NAME}`,
      `aws iam create-access-key --user-name ${CLOUD_CONNECTION_READ_ONLY_NAME}`,
    ]);
  });

  test("its group is its own: never Data Security's, nor the blocklist's, so turning one off leaves the others", () => {
    const command: string = getAwsAccessKeySetupCommand({
      dataSecurity: "content",
      dataSecurityResponse: "block",
      wafBlocklist: "rule",
      externalId: EXTERNAL_ID,
      securityCaseChecks: "on",
    });
    const groups: Array<string> = linesOf(command)
      .filter((line: string): boolean => {
        return line.startsWith("aws iam add-user-to-group ");
      })
      .map((line: string): string => {
        return line.split("--group-name ")[1]!;
      });

    expect(groups).toEqual([
      AWS_DATA_SECURITY_GROUP_NAME,
      getAwsWafBlocklistGroupName(EXTERNAL_ID),
      AWS_SECURITY_CASE_CHECKS_GROUP_NAME,
    ]);
    expect(new Set<string>(groups).size).toBe(3);
  });
});

describe("the command a connection is shown", () => {
  const AWS_WAYS: Array<{
    method: CloudConnectionAuthMethod;
    scope: CloudConnectionSetupScope;
  }> = [
    {
      method: CloudConnectionAuthMethod.AwsRole,
      scope: CloudConnectionSetupScope.Account,
    },
    {
      method: CloudConnectionAuthMethod.AwsRole,
      scope: CloudConnectionSetupScope.Organization,
    },
    {
      method: CloudConnectionAuthMethod.AwsAccessKey,
      scope: CloudConnectionSetupScope.Account,
    },
  ];

  test("grants the reads exactly when the connection keeps the setting on, on every AWS way", () => {
    for (const way of AWS_WAYS) {
      for (const [config, grants] of [
        [{}, false],
        [{ [SECURITY_CASE_CHECKS_FIELD_KEY]: "off" }, false],
        [{ [SECURITY_CASE_CHECKS_FIELD_KEY]: "On" }, false],
        [{ [SECURITY_CASE_CHECKS_FIELD_KEY]: true }, false],
        [{ [SECURITY_CASE_CHECKS_FIELD_KEY]: "on" }, true],
      ] as Array<[JSONObject, boolean]>) {
        const command: string = getCloudConnectionSetupCommand(
          CloudProvider.AWS,
          way.method,
          {
            ...ROLE,
            ...getCloudConnectionCommandSettings(config),
            scope: way.scope,
          },
        )!;

        expect({
          way,
          config,
          grants: command.includes(
            `--policy-name ${AWS_SECURITY_CASE_CHECKS_POLICY_NAME}${POLICY_DOCUMENT}`,
          ),
        }).toEqual({ way, config, grants });
      }
    }
  });

  test("Azure and Google Cloud have no IAM users of AWS's: asked for it, their commands are what they were", () => {
    for (const [provider, method] of [
      [CloudProvider.Azure, CloudConnectionAuthMethod.AzureClientSecret],
      [CloudProvider.GCP, CloudConnectionAuthMethod.GcpServiceAccountKey],
    ] as Array<[CloudProvider, CloudConnectionAuthMethod]>) {
      for (const scope of [
        CloudConnectionSetupScope.Account,
        CloudConnectionSetupScope.Organization,
      ]) {
        expect(
          getCloudConnectionSetupCommand(provider, method, {
            scope,
            securityCaseChecks: "on",
          }),
        ).toBe(getCloudConnectionSetupCommand(provider, method, { scope }));
      }
    }
  });
});
