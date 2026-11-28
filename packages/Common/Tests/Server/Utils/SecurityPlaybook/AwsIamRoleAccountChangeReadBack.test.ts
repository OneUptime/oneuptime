import { describe, expect, test } from "@jest/globals";
import {
  AWS_IAM_MAX_LIST_PAGES,
  AwsIamSession,
  getAwsIamRoleUrl,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsIamUsers";
import {
  CloudConnectorTransport,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import AccountChangeReadBack, {
  AccountChangeFacts,
  AccountChangePolicyDocument,
  AccountChangeState,
  AccountChangeUnknownReason,
} from "../../../../Server/Utils/SecurityPlaybook/AccountChangeReadBack";
import { AWS_SECURITY_CASE_CHECKS_ACTIONS } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject } from "../../../../Types/JSON";
import { SecurityCaseEventSnapshot } from "../../../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  AccountChange,
  AccountChangeKind,
  AccountChangeSubject,
  getAttackAccountChanges,
  readAccountChange,
} from "../../../../Utils/SecurityCase/AttackAccountChanges";
import {
  AwsIdentityProviderKind,
  AwsIdentityProviderReach,
  AwsTrustedIdentityProvider,
} from "../../../../Utils/SecurityCase/AwsTrustPolicy";
import {
  GITHUB_AUDIENCE_ONLY_TRUST,
  GITHUB_BRANCH_TRUST,
  GITHUB_ORGANIZATION_TRUST,
  GOOGLE_TRUST,
} from "../../../Helpers/AwsTrustPolicyExamples";
import {
  ATTACH_ROLE_POLICY_RECORD,
  AWS_DOCS_GAP,
  CREATE_ROLE_RECORD,
  GET_ROLE_POLICY_SAMPLE_RESPONSE,
  GET_ROLE_SAMPLE_RESPONSE,
  LIST_ATTACHED_ROLE_POLICIES_SAMPLE_RESPONSE,
  LIST_ROLE_POLICIES_SAMPLE_RESPONSE,
  PUT_ROLE_POLICY_RECORD,
  RECORDED_ACCOUNT,
  UPDATE_ASSUME_ROLE_POLICY_RECORD,
  getInlinePolicyResponse,
  getRoleResponse,
  iamErrorBody,
  readRecordedEvent,
  recordedRoleCall,
} from "../../../Helpers/AwsIamRoleRecords";

/*
 * THE IAM ROLE CHANGES AN ATTACK MADE, READ BACK (#11038): a role it made,
 * a trust policy it set, a policy it gave the role, each read back through
 * a session signed in to the account it was made in, with the reads
 * Security case checks grant - the role first, then the one list the
 * change is in - and never anything else: OneUptime deletes and edits
 * nothing.
 *
 * Every change starts as AWS records it - the CloudTrail User Guide's
 * CreateRole record, the IAM API Reference's sample requests in that
 * record's envelope (Helpers/AwsIamRoleRecords) - read by OneUptime's own
 * CloudTrail parser and the case's change reader. IAM answers as its Query
 * API does: the IAM API Reference's own sample responses where they fit,
 * and answers of their shape for the roles a test sets up, each trust
 * policy URL-encoded as GetRole writes it. Each change reads three ways:
 * undone, still there, and a person's to confirm.
 */

// Accounts outside the recorded one, as AWS's documentation writes them.
const ATTACKER: string = "444455556666";
const PARTNER: string = "111122223333";

interface FakeRole {
  roleId: string;
  trustPolicy: JSONObject | string;
  attachedPolicies?: Array<string> | undefined;
  // Its inline policies, by name: each one's document (#11377).
  inlinePolicies?: Record<string, JSONObject | string> | undefined;
}

interface FakeIamOptions {
  roles: Record<string, FakeRole>;
  // Whole answers, by action: the IAM API Reference's samples, word for word.
  answers?: Partial<Record<string, string>> | undefined;
  // Actions the connection may not call: AccessDenied.
  refused?: Array<string> | undefined;
  // Actions IAM fails at: a 500 every time.
  failing?: Array<string> | undefined;
  pageSize?: number | undefined;
}

function answer(statusCode: number, bodyText: string): DataSourceHttpResponse {
  return { statusCode, bodyText, bodyJson: undefined, headers: {} };
}

function listXml(action: string, result: string): string {
  return `<${action}Response xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><${action}Result>${result}</${action}Result><ResponseMetadata><RequestId>1</RequestId></ResponseMetadata></${action}Response>`;
}

// One page of a list: its items from the marker on, and the marker of the next.
function page(
  items: Array<string>,
  form: URLSearchParams,
  size: number,
): { items: Array<string>; tail: string } {
  const start: number = Number(form.get("Marker") || "0");
  const next: number = start + size;

  return {
    items: items.slice(start, next),
    tail:
      next < items.length
        ? `<IsTruncated>true</IsTruncated><Marker>${next}</Marker>`
        : "<IsTruncated>false</IsTruncated>",
  };
}

function fakeIam(
  options: FakeIamOptions,
  requests: Array<URLSearchParams> = [],
): CloudConnectorTransport {
  const size: number = options.pageSize || 100;

  return async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    const url: URL = new URL(request.url);
    const form: URLSearchParams = new URLSearchParams(String(request.body));
    const action: string = form.get("Action") || "";

    requests.push(form);

    if (url.hostname !== "iam.amazonaws.com" || request.method !== "POST") {
      throw new Error(`not IAM's endpoint: ${request.method} ${request.url}`);
    }

    // A read-back reads, and only what Security case checks grant.
    if (!AWS_SECURITY_CASE_CHECKS_ACTIONS.includes(`iam:${action}`)) {
      throw new Error(`a read-back must not call iam:${action}`);
    }

    if ((options.refused || []).includes(action)) {
      return answer(
        403,
        iamErrorBody(
          "AccessDenied",
          `User: arn:aws:sts::${RECORDED_ACCOUNT}:assumed-role/OneUptimeReadOnly-1a2b3c4d/session is not authorized to perform: iam:${action} on resource: role ${form.get("RoleName")} because no identity-based policy allows the iam:${action} action`,
        ),
      );
    }

    if ((options.failing || []).includes(action)) {
      return answer(
        500,
        iamErrorBody("ServiceFailure", "Request processing has failed."),
      );
    }

    const whole: string | undefined = options.answers?.[action];

    if (whole) {
      return answer(200, whole);
    }

    const name: string = form.get("RoleName") || "";
    const role: FakeRole | undefined = options.roles[name];

    if (!role) {
      return answer(
        404,
        iamErrorBody(
          "NoSuchEntity",
          `The role with name ${name} cannot be found.`,
        ),
      );
    }

    switch (action) {
      case "GetRole":
        return answer(
          200,
          getRoleResponse({
            accountId: RECORDED_ACCOUNT,
            roleName: name,
            roleId: role.roleId,
            trustPolicy: role.trustPolicy,
          }),
        );
      case "ListAttachedRolePolicies": {
        const listed: { items: Array<string>; tail: string } = page(
          role.attachedPolicies || [],
          form,
          size,
        );

        return answer(
          200,
          listXml(
            action,
            `<AttachedPolicies>${listed.items
              .map((arn: string): string => {
                return `<member><PolicyName>${arn.split("/").pop()}</PolicyName><PolicyArn>${arn}</PolicyArn></member>`;
              })
              .join("")}</AttachedPolicies>${listed.tail}`,
          ),
        );
      }
      case "ListRolePolicies": {
        const listed: { items: Array<string>; tail: string } = page(
          Object.keys(role.inlinePolicies || {}),
          form,
          size,
        );

        return answer(
          200,
          listXml(
            action,
            `<PolicyNames>${listed.items
              .map((policy: string): string => {
                return `<member>${policy}</member>`;
              })
              .join("")}</PolicyNames>${listed.tail}`,
          ),
        );
      }
      // One inline policy's document, URL-encoded as GetRolePolicy writes it (#11377).
      case "GetRolePolicy": {
        const policyName: string = form.get("PolicyName") || "";
        const document: JSONObject | string | undefined =
          role.inlinePolicies?.[policyName];

        return document === undefined
          ? answer(
              404,
              iamErrorBody(
                "NoSuchEntity",
                `The role policy with name ${policyName} cannot be found.`,
              ),
            )
          : answer(
              200,
              getInlinePolicyResponse({
                action,
                subject: name,
                policyName,
                document,
              }),
            );
      }
      default:
        throw new Error(`the fake does not answer ${action} for a role`);
    }
  };
}

function session(transport: CloudConnectorTransport): AwsIamSession {
  return {
    transport,
    credentials: {
      accessKeyId: "ASIAEXAMPLE",
      secretAccessKey: "secret",
      sessionToken: "token",
    },
    budget: new CloudReadBudget({ maxRequests: 50, maxDurationMs: 60_000 }),
    now: (): Date => {
      return new Date("2026-11-24T12:00:00.000Z");
    },
    sleep: async (): Promise<void> => {
      // No waiting between tries in a test.
    },
    partition: "aws",
    accountId: RECORDED_ACCOUNT,
    subject: "The role",
  };
}

// The change a case reads from recorded CloudTrail records, as its step does.
function changeOf(...records: Array<JSONObject>): AccountChange {
  const changes: Array<AccountChange> = getAttackAccountChanges({
    matches: null,
    keptEvents: records.map(readRecordedEvent),
  });

  expect(changes).toHaveLength(1);

  return changes[0]!;
}

async function readBack(
  change: AccountChange,
  options: FakeIamOptions,
  requests?: Array<URLSearchParams>,
): Promise<AccountChangeFacts> {
  return await AccountChangeReadBack.readInAws({
    session: session(fakeIam(options, requests)),
    change,
  });
}

function rolePage(roleName: string): string {
  return getAwsIamRoleUrl("aws", roleName);
}

// A trust policy that lets an account assume the role.
function trusting(...principals: Array<string>): JSONObject {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          AWS: principals.length === 1 ? principals[0]! : principals,
        },
        Action: "sts:AssumeRole",
      },
    ],
  };
}

// The IAM API Reference's PutRolePolicy sample's document: s3:* on everything (#11377).
const S3_ACCESS_POLICY: JSONObject = {
  Version: "2012-10-17",
  Statement: { Effect: "Allow", Action: "s3:*", Resource: "*" },
};

const EC2_TRUST: JSONObject = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: ["ec2.amazonaws.com"] },
      Action: ["sts:AssumeRole"],
    },
  ],
};

// A trust policy the attack set, as the CLI sends a file of it: pretty-printed, AWS's run of whitespace and all.
function attackTrustRecord(data: {
  roleName: string;
  policy: JSONObject;
  eventID: string;
  eventTime?: string | undefined;
}): JSONObject {
  return recordedRoleCall({
    eventName: "UpdateAssumeRolePolicy",
    requestParameters: {
      policyDocument: JSON.stringify(data.policy, null, 4).replace(
        '"Version": "2012-10-17",',
        `"Version": "2012-10-17",${AWS_DOCS_GAP}`,
      ),
      roleName: data.roleName,
    },
    eventID: data.eventID,
    eventTime: data.eventTime,
  });
}

describe("the recorded calls, as the case reads them", () => {
  test("each is a change to a role, by its name, in the account CloudTrail says received it", () => {
    expect(
      [
        CREATE_ROLE_RECORD,
        UPDATE_ASSUME_ROLE_POLICY_RECORD,
        ATTACH_ROLE_POLICY_RECORD,
        PUT_ROLE_POLICY_RECORD,
      ].map((record: JSONObject) => {
        const snapshot: SecurityCaseEventSnapshot = readRecordedEvent(record);
        const change: AccountChange = readAccountChange(snapshot)!;

        return {
          subject: change.subject,
          kind: change.kind,
          account: change.account,
          accountId: change.accountId,
          objectId: change.objectId,
          objectName: change.objectName,
          cloudAccountId: change.cloudAccountId,
          policyDocuments: change.policyDocuments.length,
        };
      }),
    ).toEqual([
      {
        subject: AccountChangeSubject.Role,
        kind: AccountChangeKind.Account,
        account: "TestRole",
        accountId: "AROA6ON6E4XEFFEXAMPLE",
        objectId: "",
        objectName: "",
        cloudAccountId: RECORDED_ACCOUNT,
        policyDocuments: 0,
      },
      {
        subject: AccountChangeSubject.Role,
        kind: AccountChangeKind.Trust,
        account: "S3AccessForEC2Instances",
        accountId: "",
        objectId: "",
        objectName: "",
        cloudAccountId: RECORDED_ACCOUNT,
        policyDocuments: 1,
      },
      {
        subject: AccountChangeSubject.Role,
        kind: AccountChangeKind.Policy,
        account: "ReadOnlyRole",
        accountId: "",
        objectId: "arn:aws:iam::aws:policy/ReadOnlyAccess",
        objectName: "ReadOnlyAccess",
        cloudAccountId: RECORDED_ACCOUNT,
        policyDocuments: 0,
      },
      {
        subject: AccountChangeSubject.Role,
        kind: AccountChangeKind.Policy,
        account: "S3Access",
        accountId: "",
        objectId: "",
        objectName: "S3AccessPolicy",
        cloudAccountId: RECORDED_ACCOUNT,
        // The document it set (#11377): what the policy now is held to.
        policyDocuments: 1,
      },
    ]);
  });
});

describe("a role the attack made (CreateRole)", () => {
  const made: AccountChange = changeOf(CREATE_ROLE_RECORD);

  test("still there until it is deleted, linking the role's page", async () => {
    expect(
      await readBack(made, {
        roles: {
          TestRole: { roleId: "AROA6ON6E4XEFFEXAMPLE", trustPolicy: EC2_TRUST },
        },
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.StillThere,
      url: rolePage("TestRole"),
    });
  });

  test("still there, naming the outside accounts its trust policy trusts now", async () => {
    expect(
      await readBack(made, {
        roles: {
          TestRole: {
            roleId: "AROA6ON6E4XEFFEXAMPLE",
            trustPolicy: trusting(
              `arn:aws:iam::${ATTACKER}:root`,
              `arn:aws:iam::${RECORDED_ACCOUNT}:root`,
              `arn:aws:sts::${PARTNER}:assumed-role/Ops/session`,
            ),
          },
        },
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.StillThere,
      trusted: [ATTACKER, PARTNER],
      url: rolePage("TestRole"),
    });

    // Every AWS account, its trust policy's "*".
    expect(
      (
        await readBack(made, {
          roles: {
            TestRole: {
              roleId: "AROA6ON6E4XEFFEXAMPLE",
              trustPolicy: trusting("*"),
            },
          },
        })
      ).trusted,
    ).toEqual(["*"]);
  });

  test("undone once deleted - or once the role of its name is another one, made since", async () => {
    expect(await readBack(made, { roles: {} })).toEqual({
      provider: "AWS",
      state: AccountChangeState.Undone,
      isAccountGone: true,
    });
    expect(
      await readBack(made, {
        roles: {
          TestRole: {
            roleId: "AROAREMADEAFTEREXAMPLE",
            trustPolicy: EC2_TRUST,
          },
        },
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.Undone,
      isAccountGone: true,
    });
  });

  test("a read the connection was not given is the role a person confirms, never undone", async () => {
    expect(
      await readBack(made, {
        roles: {
          TestRole: { roleId: "AROA6ON6E4XEFFEXAMPLE", trustPolicy: EC2_TRUST },
        },
        refused: ["GetRole"],
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.NotGranted,
    });
  });
});

describe("a trust policy the attack set (UpdateAssumeRolePolicy)", () => {
  // The IAM API Reference's sample: S3AccessForEC2Instances made to trust EC2.
  const sample: AccountChange = changeOf(UPDATE_ASSUME_ROLE_POLICY_RECORD);
  // An attack's: a role made to trust its own account, beside a partner the role trusted already.
  const backdoor: AccountChange = changeOf(
    attackTrustRecord({
      roleName: "Deploy",
      policy: trusting(`arn:aws:iam::${PARTNER}:root`, ATTACKER),
      eventID: "attack-1",
    }),
  );

  test("still there while it is the policy the attack set, however IAM writes it back", async () => {
    // GetRole's own sample writes it plain, over two lines; a role of its shape, URL-encoded and compact.
    expect(
      await readBack(sample, {
        roles: {},
        answers: {
          GetRole: GET_ROLE_SAMPLE_RESPONSE.split("S3Access<").join(
            "S3AccessForEC2Instances<",
          ),
        },
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.StillThere,
      url: rolePage("S3AccessForEC2Instances"),
    });
    expect(
      await readBack(sample, {
        roles: {
          S3AccessForEC2Instances: {
            roleId: "AROADBQP57FF2AEXAMPLE",
            trustPolicy: EC2_TRUST,
          },
        },
      }),
    ).toMatchObject({ state: AccountChangeState.StillThere });
  });

  test("still there names the outside accounts it trusts: an account by its id is IAM's root ARN", async () => {
    expect(
      await readBack(backdoor, {
        roles: {
          Deploy: {
            roleId: "AROADEPLOYEXAMPLE",
            // IAM saves the account id as the account's root ARN.
            trustPolicy: trusting(
              `arn:aws:iam::${PARTNER}:root`,
              `arn:aws:iam::${ATTACKER}:root`,
            ),
          },
        },
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.StillThere,
      trusted: [PARTNER, ATTACKER],
      url: rolePage("Deploy"),
    });
  });

  test("undone once it trusts none of the outside accounts the attack's policy let in", async () => {
    for (const trustPolicy of [
      EC2_TRUST,
      trusting(`arn:aws:iam::${RECORDED_ACCOUNT}:role/Deployer`),
      // A principal deleted since lets nobody in: IAM writes its unique id.
      trusting("AROAATTACKERDELETEDEXAMPLE"),
    ]) {
      expect(
        await readBack(backdoor, {
          roles: { Deploy: { roleId: "AROADEPLOYEXAMPLE", trustPolicy } },
        }),
      ).toEqual({
        provider: "AWS",
        state: AccountChangeState.Undone,
        url: rolePage("Deploy"),
      });
    }
  });

  test("changed since, still trusting an outside account the attack's policy trusted: a person confirms it, naming it - it may have been trusted before", async () => {
    expect(
      await readBack(backdoor, {
        roles: {
          Deploy: {
            roleId: "AROADEPLOYEXAMPLE",
            trustPolicy: trusting(`arn:aws:iam::${PARTNER}:root`),
          },
        },
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.CannotTellWhich,
      trusted: [PARTNER],
      url: rolePage("Deploy"),
    });
  });

  test("changed to trust every AWS account: a person confirms it, told anyone may assume it", async () => {
    expect(
      await readBack(backdoor, {
        roles: {
          Deploy: { roleId: "AROADEPLOYEXAMPLE", trustPolicy: trusting("*") },
        },
      }),
    ).toMatchObject({
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.CannotTellWhich,
      trusted: ["*"],
    });
  });

  test("one that let in no outside account, changed since: a person confirms whom it trusts", async () => {
    expect(
      await readBack(sample, {
        roles: {
          S3AccessForEC2Instances: {
            roleId: "AROADBQP57FF2AEXAMPLE",
            trustPolicy: trusting(`arn:aws:iam::${PARTNER}:root`),
          },
        },
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.CannotTellWhich,
      trusted: [PARTNER],
      url: rolePage("S3AccessForEC2Instances"),
    });
  });

  test("a policy CloudTrail cut short is never read as undone: a person confirms whom the role trusts now", async () => {
    // A long trust policy: past the 1,000 characters CloudTrail's parser keeps of an attribute.
    const long: JSONObject = trusting(
      ...Array.from({ length: 30 }, (_: unknown, index: number): string => {
        return `arn:aws:iam::${PARTNER}:role/team-${String(index).padStart(2, "0")}-deployer`;
      }),
      `arn:aws:iam::${ATTACKER}:root`,
    );
    const cut: AccountChange = changeOf(
      attackTrustRecord({
        roleName: "Deploy",
        policy: long,
        eventID: "attack-long",
      }),
    );

    expect(cut.policyDocuments[0]!.length).toBe(1000);

    for (const [trustPolicy, trusted] of [
      [EC2_TRUST, undefined],
      [trusting(`arn:aws:iam::${ATTACKER}:root`), [ATTACKER]],
    ] as Array<[JSONObject, Array<string> | undefined]>) {
      expect(
        await readBack(cut, {
          roles: { Deploy: { roleId: "AROADEPLOYEXAMPLE", trustPolicy } },
        }),
      ).toEqual({
        provider: "AWS",
        state: AccountChangeState.Unknown,
        reason: AccountChangeUnknownReason.CannotTellWhich,
        ...(trusted ? { trusted } : {}),
        url: rolePage("Deploy"),
      });
    }
  });

  test("set twice: still there while it is the last the attack set, undone only once neither's outside account is trusted", async () => {
    const twice: AccountChange = changeOf(
      attackTrustRecord({
        roleName: "Deploy",
        policy: trusting(ATTACKER),
        eventID: "attack-1",
        eventTime: "2023-07-19T21:29:12Z",
      }),
      attackTrustRecord({
        roleName: "Deploy",
        policy: trusting("555555555555"),
        eventID: "attack-2",
        eventTime: "2023-07-19T21:31:00Z",
      }),
    );

    expect(twice.policyDocuments).toHaveLength(2);

    const read: (trustPolicy: JSONObject) => Promise<AccountChangeFacts> = (
      trustPolicy: JSONObject,
    ): Promise<AccountChangeFacts> => {
      return readBack(twice, {
        roles: { Deploy: { roleId: "AROADEPLOYEXAMPLE", trustPolicy } },
      });
    };

    expect(
      await read(trusting("arn:aws:iam::555555555555:root")),
    ).toMatchObject({
      state: AccountChangeState.StillThere,
      trusted: ["555555555555"],
    });
    // The first, though not the last: its account is still let in.
    expect(await read(trusting(`arn:aws:iam::${ATTACKER}:root`))).toMatchObject(
      {
        state: AccountChangeState.Unknown,
        trusted: [ATTACKER],
      },
    );
    expect(await read(EC2_TRUST)).toMatchObject({
      state: AccountChangeState.Undone,
    });
  });

  test("the role deleted took its trust policy with it", async () => {
    expect(await readBack(backdoor, { roles: {} })).toEqual({
      provider: "AWS",
      state: AccountChangeState.Undone,
      isAccountGone: true,
    });
  });
});

describe("a policy the attack gave the role (AttachRolePolicy, PutRolePolicy)", () => {
  const attached: AccountChange = changeOf(ATTACH_ROLE_POLICY_RECORD);
  const inline: AccountChange = changeOf(PUT_ROLE_POLICY_RECORD);

  test("a managed policy: still there while attached, by its ARN - ListAttachedRolePolicies' own sample says it is", async () => {
    expect(
      await readBack(attached, {
        roles: {
          ReadOnlyRole: {
            roleId: "AROAREADONLYEXAMPLE",
            trustPolicy: EC2_TRUST,
          },
        },
        answers: {
          ListAttachedRolePolicies: LIST_ATTACHED_ROLE_POLICIES_SAMPLE_RESPONSE,
        },
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.StillThere,
      url: rolePage("ReadOnlyRole"),
    });
  });

  test("a managed policy: undone once detached; another of its name in the account is not the one", async () => {
    for (const attachedPolicies of [
      [],
      ["arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"],
      [`arn:aws:iam::${RECORDED_ACCOUNT}:policy/ReadOnlyAccess`],
    ]) {
      expect(
        (
          await readBack(attached, {
            roles: {
              ReadOnlyRole: {
                roleId: "AROAREADONLYEXAMPLE",
                trustPolicy: EC2_TRUST,
                attachedPolicies,
              },
            },
          })
        ).state,
      ).toBe(AccountChangeState.Undone);
    }
  });

  test("an inline policy: still there while the role has it as the attack wrote it - GetRole's, ListRolePolicies' and GetRolePolicy's own samples say S3Access does (#11377)", async () => {
    expect(
      await readBack(inline, {
        roles: {},
        answers: {
          GetRole: GET_ROLE_SAMPLE_RESPONSE,
          ListRolePolicies: LIST_ROLE_POLICIES_SAMPLE_RESPONSE,
          GetRolePolicy: GET_ROLE_POLICY_SAMPLE_RESPONSE,
        },
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.StillThere,
      url: rolePage("S3Access"),
      policyDocument: AccountChangePolicyDocument.Attack,
    });
  });

  test("an inline policy: still there case aside while its document is the attack's; undone once deleted, or once its document is another (#11377)", async () => {
    const role: (
      inlinePolicies: Record<string, JSONObject>,
    ) => FakeIamOptions = (
      inlinePolicies: Record<string, JSONObject>,
    ): FakeIamOptions => {
      return {
        roles: {
          S3Access: {
            roleId: "AROADBQP57FF2AEXAMPLE",
            trustPolicy: EC2_TRUST,
            inlinePolicies,
          },
        },
      };
    };

    expect(
      (await readBack(inline, role({ s3accesspolicy: S3_ACCESS_POLICY })))
        .state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      (
        await readBack(
          inline,
          role({ CloudwatchPutMetricPolicy: S3_ACCESS_POLICY }),
        )
      ).state,
    ).toBe(AccountChangeState.Undone);
    expect(
      await readBack(
        inline,
        role({
          S3AccessPolicy: {
            Version: "2012-10-17",
            Statement: {
              Effect: "Allow",
              Action: "s3:GetObject",
              Resource: "*",
            },
          },
        }),
      ),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.Undone,
      url: rolePage("S3Access"),
      policyDocument: AccountChangePolicyDocument.Changed,
    });
  });

  test("the role deleted took its policies with it", async () => {
    for (const change of [attached, inline]) {
      expect(await readBack(change, { roles: {} })).toEqual({
        provider: "AWS",
        state: AccountChangeState.Undone,
        isAccountGone: true,
      });
    }
  });

  test("read across pages, the policy on the last one; a list longer than OneUptime reads is no answer, never undone", async () => {
    const requests: Array<URLSearchParams> = [];

    expect(
      (
        await readBack(
          attached,
          {
            roles: {
              ReadOnlyRole: {
                roleId: "AROAREADONLYEXAMPLE",
                trustPolicy: EC2_TRUST,
                attachedPolicies: [
                  "arn:aws:iam::aws:policy/A",
                  "arn:aws:iam::aws:policy/B",
                  "arn:aws:iam::aws:policy/ReadOnlyAccess",
                ],
              },
            },
            pageSize: 1,
          },
          requests,
        )
      ).state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      requests
        .filter((form: URLSearchParams): boolean => {
          return form.get("Action") === "ListAttachedRolePolicies";
        })
        .map((form: URLSearchParams): Array<string | null> => {
          return [form.get("RoleName"), form.get("Marker")];
        }),
    ).toEqual([
      ["ReadOnlyRole", null],
      ["ReadOnlyRole", "1"],
      ["ReadOnlyRole", "2"],
    ]);

    await expect(
      readBack(inline, {
        roles: {
          S3Access: {
            roleId: "AROADBQP57FF2AEXAMPLE",
            trustPolicy: EC2_TRUST,
            inlinePolicies: Object.fromEntries(
              Array.from(
                { length: AWS_IAM_MAX_LIST_PAGES + 1 },
                (_: unknown, index: number): [string, JSONObject] => {
                  return [`policy-${index}`, S3_ACCESS_POLICY];
                },
              ),
            ),
          },
        },
        pageSize: 1,
      }),
    ).rejects.toThrow("more for S3Access than OneUptime reads");
  });
});

describe("whatever the role's change", () => {
  const changes: Array<AccountChange> = [
    changeOf(CREATE_ROLE_RECORD),
    changeOf(UPDATE_ASSUME_ROLE_POLICY_RECORD),
    changeOf(ATTACH_ROLE_POLICY_RECORD),
    changeOf(PUT_ROLE_POLICY_RECORD),
  ];
  const roles: Record<string, FakeRole> = {
    TestRole: { roleId: "AROA6ON6E4XEFFEXAMPLE", trustPolicy: EC2_TRUST },
    S3AccessForEC2Instances: {
      roleId: "AROADBQP57FF2AEXAMPLE",
      trustPolicy: EC2_TRUST,
    },
    ReadOnlyRole: { roleId: "AROAREADONLYEXAMPLE", trustPolicy: EC2_TRUST },
    S3Access: { roleId: "AROAS3ACCESSEXAMPLE", trustPolicy: EC2_TRUST },
  };

  test("a read the connection was not given - the setting off, or its command not run again since it grants roles - is a person's to confirm, never undone", async () => {
    for (const refused of [
      ["GetRole"],
      ["ListAttachedRolePolicies", "ListRolePolicies"],
    ]) {
      for (const change of changes) {
        const facts: AccountChangeFacts = await readBack(change, {
          roles,
          refused,
        });

        // GetRole alone reads a role made and its trust policy.
        if (
          refused.includes("GetRole") ||
          change.kind === AccountChangeKind.Policy
        ) {
          expect({ change: change.eventName, facts }).toEqual({
            change: change.eventName,
            facts: {
              provider: "AWS",
              state: AccountChangeState.Unknown,
              reason: AccountChangeUnknownReason.NotGranted,
            },
          });
        }
      }
    }
  });

  test("a read IAM fails at is thrown, never taken as undone", async () => {
    for (const change of changes) {
      await expect(
        readBack(change, { roles, failing: ["GetRole"] }),
      ).rejects.toThrow();
    }
  });

  test("asks IAM nothing but the role and the one list each change is in - and writes nothing", async () => {
    const requests: Array<URLSearchParams> = [];

    for (const change of changes) {
      await readBack(change, { roles }, requests);
    }

    expect(
      requests.map((form: URLSearchParams): string => {
        return `${form.get("Action")} ${form.get("RoleName")}`;
      }),
    ).toEqual([
      "GetRole TestRole",
      "GetRole S3AccessForEC2Instances",
      "GetRole ReadOnlyRole",
      "ListAttachedRolePolicies ReadOnlyRole",
      "GetRole S3Access",
      "ListRolePolicies S3Access",
    ]);

    for (const form of requests) {
      expect(form.get("Version")).toBe("2010-05-08");
      expect(form.get("UserName")).toBeNull();
    }
  });
});

describe("the identity providers a role lets in (#11378)", () => {
  const GITHUB: string = "token.actions.githubusercontent.com";
  // An attack's trust: GitHub Actions with its audience alone - any repository, of any organization.
  const opened: AccountChange = changeOf(
    attackTrustRecord({
      roleName: "Deploy",
      policy: JSON.parse(GITHUB_AUDIENCE_ONLY_TRUST) as JSONObject,
      eventID: "attack-oidc-1",
    }),
  );
  const deploy: (trustPolicy: JSONObject | string) => FakeIamOptions = (
    trustPolicy: JSONObject | string,
  ): FakeIamOptions => {
    return {
      roles: { Deploy: { roleId: "AROADEPLOYEXAMPLE", trustPolicy } },
    };
  };
  const reachOf: (
    facts: AccountChangeFacts,
  ) => Array<[string, AwsIdentityProviderReach]> = (
    facts: AccountChangeFacts,
  ): Array<[string, AwsIdentityProviderReach]> => {
    return (facts.providers || []).map(
      (
        provider: AwsTrustedIdentityProvider,
      ): [string, AwsIdentityProviderReach] => {
        return [provider.name, provider.reach];
      },
    );
  };

  test("a role the attack made names whom its trust policy lets in now: the provider, and how far", async () => {
    const facts: AccountChangeFacts = await readBack(
      changeOf(CREATE_ROLE_RECORD),
      {
        roles: {
          TestRole: {
            roleId: "AROA6ON6E4XEFFEXAMPLE",
            trustPolicy: GITHUB_AUDIENCE_ONLY_TRUST,
          },
        },
      },
    );

    expect(facts).toEqual({
      provider: "AWS",
      state: AccountChangeState.StillThere,
      url: rolePage("TestRole"),
      providers: [
        {
          principal: `arn:aws:iam::012345678910:oidc-provider/${GITHUB}`,
          name: GITHUB,
          kind: AwsIdentityProviderKind.Oidc,
          reach: AwsIdentityProviderReach.AnyOrganization,
          claim: "sub",
          values: [],
        },
      ],
    });
  });

  test("a trust policy still as the attack set it names the provider it lets in", async () => {
    const facts: AccountChangeFacts = await readBack(
      opened,
      deploy(GITHUB_AUDIENCE_ONLY_TRUST),
    );

    expect(facts.state).toBe(AccountChangeState.StillThere);
    expect(reachOf(facts)).toEqual([
      [GITHUB, AwsIdentityProviderReach.AnyOrganization],
    ]);
  });

  test("undone once the role lets in none of the providers the attack's policy let in - counted as the outside accounts are", async () => {
    for (const trust of [
      EC2_TRUST,
      // Another provider the attack's policy never named is not its way back.
      GOOGLE_TRUST,
    ]) {
      expect(await readBack(opened, deploy(trust))).toEqual({
        provider: "AWS",
        state: AccountChangeState.Undone,
        url: rolePage("Deploy"),
      });
    }
  });

  test("the provider still let in, held to one repository now: a person confirms it, told what it lets in - never undone", async () => {
    const facts: AccountChangeFacts = await readBack(
      opened,
      deploy(GITHUB_BRANCH_TRUST),
    );

    expect(facts).toMatchObject({
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.CannotTellWhich,
    });
    expect(facts.providers).toEqual([
      expect.objectContaining({
        name: GITHUB,
        reach: AwsIdentityProviderReach.Limited,
        claim: "sub",
        values: ["repo:GitHubOrg/GitHubRepo:ref:refs/heads/GitHubBranch"],
      }),
    ]);
    expect(facts.trusted).toBeUndefined();
  });

  test("an attack that let in an outside account and a provider: undone only once neither is", async () => {
    const both: AccountChange = changeOf(
      attackTrustRecord({
        roleName: "Deploy",
        policy: {
          Version: "2012-10-17",
          Statement: [
            ...(trusting(ATTACKER)["Statement"] as Array<JSONObject>),
            ...((JSON.parse(GITHUB_AUDIENCE_ONLY_TRUST) as JSONObject)[
              "Statement"
            ] as Array<JSONObject>),
          ],
        },
        eventID: "attack-oidc-2",
      }),
    );

    expect(await readBack(both, deploy(trusting(ATTACKER)))).toMatchObject({
      state: AccountChangeState.Unknown,
      trusted: [ATTACKER],
    });
    expect(
      reachOf(await readBack(both, deploy(GITHUB_AUDIENCE_ONLY_TRUST))),
    ).toEqual([[GITHUB, AwsIdentityProviderReach.AnyOrganization]]);
    expect((await readBack(both, deploy(EC2_TRUST))).state).toBe(
      AccountChangeState.Undone,
    );
  });

  test("a role open to every AWS account now is never undone, whatever the attack let in", async () => {
    expect(await readBack(opened, deploy(trusting("*")))).toMatchObject({
      state: AccountChangeState.Unknown,
      trusted: ["*"],
    });
  });

  test("an attack's policy CloudTrail cut short: a person confirms, told every provider the role lets in now", async () => {
    const cut: AccountChange = changeOf(
      recordedRoleCall({
        eventName: "UpdateAssumeRolePolicy",
        requestParameters: {
          roleName: "Deploy",
          policyDocument: `${GITHUB_AUDIENCE_ONLY_TRUST.slice(0, 200)}`,
        },
        eventID: "attack-oidc-3",
      }),
    );

    const facts: AccountChangeFacts = await readBack(
      cut,
      deploy(GITHUB_ORGANIZATION_TRUST),
    );

    expect(facts.state).toBe(AccountChangeState.Unknown);
    expect(reachOf(facts)).toEqual([
      [GITHUB, AwsIdentityProviderReach.Limited],
    ]);
  });
});

describe("where a person undoes it", () => {
  test("the role's page in the partition's own console", () => {
    expect(getAwsIamRoleUrl("aws", "Deploy Bot")).toBe(
      "https://console.aws.amazon.com/iam/home#/roles/details/Deploy%20Bot",
    );
    expect(getAwsIamRoleUrl("aws-us-gov", "a")).toBe(
      "https://console.amazonaws-us-gov.com/iam/home#/roles/details/a",
    );
    expect(getAwsIamRoleUrl("aws-cn", "a")).toBe(
      "https://console.amazonaws.cn/iam/home#/roles/details/a",
    );
  });
});
