import { describe, expect, test } from "@jest/globals";
import {
  AwsIamSession,
  getAwsIamRoleUrl,
  getAwsIamUserUrl,
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
import {
  AccountChange,
  AccountChangeKind,
  AccountChangeSubject,
  getAttackAccountChanges,
} from "../../../../Utils/SecurityCase/AttackAccountChanges";
import {
  AWS_DOCS_GAP,
  GET_ROLE_POLICY_SAMPLE_RESPONSE,
  GET_ROLE_SAMPLE_RESPONSE,
  GET_USER_POLICY_SAMPLE_RESPONSE,
  LIST_ROLE_POLICIES_SAMPLE_RESPONSE,
  PUT_ROLE_POLICY_RECORD,
  PUT_USER_POLICY_RECORD,
  RECORDED_ACCOUNT,
  attackInlinePolicyRecord,
  getInlinePolicyResponse,
  getRoleResponse,
  iamErrorBody,
  readRecordedEvent,
} from "../../../Helpers/AwsIamRoleRecords";

/*
 * AN INLINE POLICY THE ATTACK WROTE, READ BY ITS DOCUMENT (#11377).
 *
 * PutRolePolicy and PutUserPolicy write a role's or a user's inline policy
 * - and overwrite one of the same name. Read by its name alone, a policy
 * the attack rewrote (ci-deploy widened to "Action": "*") read as still
 * there after a person put its old document back, so the step said Not
 * Done Yet and the person had to mark it done anyway. Now the document
 * IAM holds (GetRolePolicy, GetUserPolicy) is held to the ones the case's
 * CloudTrail events show written to it:
 *
 *   still there   it is the last one the attack wrote, as IAM reads it;
 *   undone        the policy is gone, or its document is none the case's
 *                 events show - the old one put back, or any other;
 *   to confirm    it is an earlier one the case's events show (the old
 *                 one, or one the attack wrote first), or one of theirs
 *                 CloudTrail cut short, or its document cannot be read:
 *                 never undone on what OneUptime could not compare.
 *
 * A connection whose command was run before the document reads were
 * granted is refused them: the change is a person's to confirm, and the
 * step says to run the command again. Every record is AWS's own - the
 * IAM API Reference's PutRolePolicy, PutUserPolicy, GetRolePolicy and
 * GetUserPolicy samples (Helpers/AwsIamRoleRecords) - read by OneUptime's
 * own CloudTrail parser; IAM answers as its Query API does, URL-encoded.
 */

// The reads a connection set up before #11377 was granted: no policy's document.
const GRANTED_BEFORE_DOCUMENT_READS: Array<string> =
  AWS_SECURITY_CASE_CHECKS_ACTIONS.filter((action: string): boolean => {
    return action !== "iam:GetRolePolicy" && action !== "iam:GetUserPolicy";
  });

interface FakeSubject {
  // Its inline policies, by name: each one's document.
  inlinePolicies: Record<string, JSONObject | string>;
}

interface FakeIamOptions {
  roles?: Record<string, FakeSubject> | undefined;
  users?: Record<string, FakeSubject> | undefined;
  // Whole answers, by action: the IAM API Reference's samples, word for word.
  answers?: Partial<Record<string, string>> | undefined;
  // What the connection's command granted: every read Security case checks grant, unless set.
  granted?: Array<string> | undefined;
  // Actions IAM fails at: a 500 every time.
  failing?: Array<string> | undefined;
  // Policies deleted between the list and the read of their document.
  deletedSinceListed?: Array<string> | undefined;
}

function answer(statusCode: number, bodyText: string): DataSourceHttpResponse {
  return { statusCode, bodyText, bodyJson: undefined, headers: {} };
}

function listXml(action: string, result: string): string {
  return `<${action}Response xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><${action}Result>${result}</${action}Result><ResponseMetadata><RequestId>1</RequestId></ResponseMetadata></${action}Response>`;
}

function fakeIam(
  options: FakeIamOptions,
  requests: Array<URLSearchParams> = [],
): CloudConnectorTransport {
  const granted: Array<string> = options.granted || [
    ...AWS_SECURITY_CASE_CHECKS_ACTIONS,
  ];

  return async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    const url: URL = new URL(request.url);
    const form: URLSearchParams = new URLSearchParams(String(request.body));
    const action: string = form.get("Action") || "";
    const roleName: string | null = form.get("RoleName");
    const userName: string | null = form.get("UserName");

    requests.push(form);

    if (url.hostname !== "iam.amazonaws.com" || request.method !== "POST") {
      throw new Error(`not IAM's endpoint: ${request.method} ${request.url}`);
    }

    if (!granted.includes(`iam:${action}`)) {
      return answer(
        403,
        iamErrorBody(
          "AccessDenied",
          `User: arn:aws:sts::${RECORDED_ACCOUNT}:assumed-role/OneUptimeReadOnly-1a2b3c4d/session is not authorized to perform: iam:${action} because no identity-based policy allows the iam:${action} action`,
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

    const subject: FakeSubject | undefined =
      roleName !== null
        ? options.roles?.[roleName]
        : userName !== null
          ? options.users?.[userName]
          : undefined;
    const name: string = roleName ?? userName ?? "";

    if (!subject) {
      return answer(
        404,
        iamErrorBody(
          "NoSuchEntity",
          `The ${roleName !== null ? "role" : "user"} with name ${name} cannot be found.`,
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
            roleId: "AROADEPLOYEXAMPLE",
            trustPolicy: {
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Principal: { Service: "ec2.amazonaws.com" },
                  Action: "sts:AssumeRole",
                },
              ],
            },
          }),
        );
      case "GetUser":
        return answer(
          200,
          listXml(
            action,
            `<User><Path>/</Path><UserName>${name}</UserName><UserId>AIDAEXAMPLE</UserId><Arn>arn:aws:iam::${RECORDED_ACCOUNT}:user/${name}</Arn><CreateDate>2026-01-01T00:00:00Z</CreateDate></User>`,
          ),
        );
      case "ListRolePolicies":
      case "ListUserPolicies":
        return answer(
          200,
          listXml(
            action,
            `<PolicyNames>${Object.keys(subject.inlinePolicies)
              .map((policy: string): string => {
                return `<member>${policy}</member>`;
              })
              .join("")}</PolicyNames><IsTruncated>false</IsTruncated>`,
          ),
        );
      case "GetRolePolicy":
      case "GetUserPolicy": {
        const policyName: string = form.get("PolicyName") || "";
        const document: JSONObject | string | undefined =
          subject.inlinePolicies[policyName];

        if (
          document === undefined ||
          (options.deletedSinceListed || []).includes(policyName)
        ) {
          return answer(
            404,
            iamErrorBody(
              "NoSuchEntity",
              `The ${action === "GetRolePolicy" ? "role" : "user"} policy with name ${policyName} cannot be found.`,
            ),
          );
        }

        return answer(
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
        throw new Error(`the fake does not answer ${action}`);
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
      return new Date("2026-11-28T12:00:00.000Z");
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

// A document as the AWS CLI sends a file of it: pretty-printed, AWS's run of whitespace and all.
function asSent(policy: JSONObject): string {
  return JSON.stringify(policy, null, 4).replace(
    '"Version": "2012-10-17",',
    `"Version": "2012-10-17",${AWS_DOCS_GAP}`,
  );
}

/*
 * The role Deploy's inline policy ci-deploy, as the team wrote it: push the
 * build to its bucket, roll the service out.
 */
const CI_DEPLOY: JSONObject = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "PushArtifacts",
      Effect: "Allow",
      Action: ["s3:PutObject", "s3:GetObject"],
      Resource: "arn:aws:s3:::deploy-artifacts/*",
    },
    {
      Sid: "RollOutService",
      Effect: "Allow",
      Action: ["ecs:UpdateService", "ecs:DescribeServices"],
      Resource: "*",
    },
  ],
};

// What the attack widened it to: everything, everywhere.
const EVERYTHING: JSONObject = {
  Version: "2012-10-17",
  Statement: { Effect: "Allow", Action: "*", Resource: "*" },
};

// The attack's PutRolePolicy: ci-deploy rewritten to EVERYTHING.
const WIDENED_CI_DEPLOY: JSONObject = attackInlinePolicyRecord({
  eventName: "PutRolePolicy",
  subject: "Deploy",
  policyName: "ci-deploy",
  policyDocument: asSent(EVERYTHING),
  eventID: "6a3f2c1e-9b4d-4e07-8c55-EXAMPLE77a01",
});

function deployRole(document: JSONObject | string): FakeIamOptions {
  return { roles: { Deploy: { inlinePolicies: { "ci-deploy": document } } } };
}

/*
 * Bob's inline policy IAMReadAccess - the IAM API Reference's PutUserPolicy
 * sample - and the attack's PutUserPolicy rewriting it to everything.
 */
const IAM_READ_ACCESS: JSONObject = {
  Version: "2012-10-17",
  Statement: {
    Effect: "Allow",
    Action: ["iam:Get*", "iam:List*", "iam:Generate*"],
    Resource: "*",
  },
};
const WIDENED_IAM_READ_ACCESS: JSONObject = attackInlinePolicyRecord({
  eventName: "PutUserPolicy",
  subject: "Bob",
  policyName: "IAMReadAccess",
  policyDocument: asSent(EVERYTHING),
  eventID: "1d7b5e93-4f2a-4c18-9e60-EXAMPLE77a02",
});

function bob(document: JSONObject | string): FakeIamOptions {
  return { users: { Bob: { inlinePolicies: { IAMReadAccess: document } } } };
}

describe("the attack's write, as the case reads it", () => {
  test("PutRolePolicy and PutUserPolicy each keep the document they set, as CloudTrail recorded it", () => {
    for (const [record, subject, name] of [
      [WIDENED_CI_DEPLOY, AccountChangeSubject.Role, "Deploy"],
      [WIDENED_IAM_READ_ACCESS, AccountChangeSubject.Account, "Bob"],
      [PUT_ROLE_POLICY_RECORD, AccountChangeSubject.Role, "S3Access"],
      [PUT_USER_POLICY_RECORD, AccountChangeSubject.Account, "Bob"],
    ] as Array<[JSONObject, AccountChangeSubject, string]>) {
      const change: AccountChange = changeOf(record);

      expect({
        subject: change.subject,
        kind: change.kind,
        account: change.account,
        objectId: change.objectId,
        documents: change.policyDocuments,
      }).toEqual({
        subject,
        kind: AccountChangeKind.Policy,
        account: name,
        objectId: "",
        documents: [
          (record["requestParameters"] as JSONObject)[
            "policyDocument"
          ] as string,
        ],
      });
    }
  });
});

/*
 * #11377's wrong verdict, on main's code: the policy's name was still there,
 * so a document put back read as the attack's still there. Each of these
 * fails there with "Received: StillThere".
 */
describe("a policy the attack rewrote, its old document put back (#11377)", () => {
  test("a role's: undone, its role's page linked - the name is still there, the attack's document is not", async () => {
    const facts: AccountChangeFacts = await readBack(
      changeOf(WIDENED_CI_DEPLOY),
      deployRole(CI_DEPLOY),
    );

    expect(facts.state).toBe(AccountChangeState.Undone);
    expect(facts).toEqual({
      provider: "AWS",
      state: AccountChangeState.Undone,
      url: getAwsIamRoleUrl("aws", "Deploy"),
      policyDocument: AccountChangePolicyDocument.Changed,
    });
  });

  test("a user's: undone once the IAM API Reference's own IAMReadAccess is back on Bob", async () => {
    const facts: AccountChangeFacts = await readBack(
      changeOf(WIDENED_IAM_READ_ACCESS),
      bob(
        // Put back as PutUserPolicy's sample wrote it.
        (PUT_USER_POLICY_RECORD["requestParameters"] as JSONObject)[
          "policyDocument"
        ] as string,
      ),
    );

    expect(facts.state).toBe(AccountChangeState.Undone);
    expect(facts).toEqual({
      provider: "AWS",
      state: AccountChangeState.Undone,
      url: getAwsIamUserUrl("aws", "Bob"),
      policyDocument: AccountChangePolicyDocument.Changed,
    });
  });

  test("any other document is the attack's gone too: a person who narrowed it further", async () => {
    const narrower: JSONObject = {
      Version: "2012-10-17",
      Statement: [(CI_DEPLOY["Statement"] as Array<JSONObject>)[0]!],
    };

    expect(
      (await readBack(changeOf(WIDENED_CI_DEPLOY), deployRole(narrower))).state,
    ).toBe(AccountChangeState.Undone);
  });
});

describe("a policy still as the attack wrote it", () => {
  test("still there, however IAM writes it back: another order, a Sid, a list of one, an action's case", async () => {
    for (const document of [
      EVERYTHING,
      JSON.stringify(EVERYTHING),
      {
        Statement: [
          { Sid: "Backdoor", Resource: ["*"], Action: ["*"], Effect: "Allow" },
        ],
        Version: "2012-10-17",
      },
    ]) {
      expect({
        document,
        facts: await readBack(
          changeOf(WIDENED_CI_DEPLOY),
          deployRole(document),
        ),
      }).toEqual({
        document,
        facts: {
          provider: "AWS",
          state: AccountChangeState.StillThere,
          url: getAwsIamRoleUrl("aws", "Deploy"),
          policyDocument: AccountChangePolicyDocument.Attack,
        },
      });
    }
  });

  test("the IAM API Reference's own samples agree: PutRolePolicy's S3AccessPolicy is the one GetRolePolicy reads back, written differently", async () => {
    expect(
      await readBack(changeOf(PUT_ROLE_POLICY_RECORD), {
        answers: {
          GetRole: GET_ROLE_SAMPLE_RESPONSE,
          ListRolePolicies: LIST_ROLE_POLICIES_SAMPLE_RESPONSE,
          GetRolePolicy: GET_ROLE_POLICY_SAMPLE_RESPONSE,
        },
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.StillThere,
      url: getAwsIamRoleUrl("aws", "S3Access"),
      policyDocument: AccountChangePolicyDocument.Attack,
    });
  });

  test("a user's: GetUserPolicy's own sample, Bob's AllAccessPolicy, is the attack's everything", async () => {
    const change: AccountChange = changeOf(
      attackInlinePolicyRecord({
        eventName: "PutUserPolicy",
        subject: "Bob",
        policyName: "AllAccessPolicy",
        policyDocument: asSent(EVERYTHING),
        eventID: "9f0e3b72-5c1a-4d6e-8b47-EXAMPLE77a03",
      }),
    );

    expect(
      await readBack(change, {
        users: { Bob: { inlinePolicies: { AllAccessPolicy: EVERYTHING } } },
        answers: { GetUserPolicy: GET_USER_POLICY_SAMPLE_RESPONSE },
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.StillThere,
      url: getAwsIamUserUrl("aws", "Bob"),
      policyDocument: AccountChangePolicyDocument.Attack,
    });
  });

  test("a policy name is IAM's case aside: its document is read under the name IAM lists", async () => {
    const requests: Array<URLSearchParams> = [];

    expect(
      (
        await readBack(
          changeOf(WIDENED_CI_DEPLOY),
          {
            roles: { Deploy: { inlinePolicies: { "CI-Deploy": EVERYTHING } } },
          },
          requests,
        )
      ).state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      requests
        .filter((form: URLSearchParams): boolean => {
          return form.get("Action") === "GetRolePolicy";
        })
        .map((form: URLSearchParams): string | null => {
          return form.get("PolicyName");
        }),
    ).toEqual(["CI-Deploy"]);
  });
});

describe("a policy gone", () => {
  test("deleted, or its role or user with it: undone, its document never asked for", async () => {
    const requests: Array<URLSearchParams> = [];

    expect(
      await readBack(
        changeOf(WIDENED_CI_DEPLOY),
        { roles: { Deploy: { inlinePolicies: {} } } },
        requests,
      ),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.Undone,
      url: getAwsIamRoleUrl("aws", "Deploy"),
    });
    expect(
      requests.map((form: URLSearchParams): string | null => {
        return form.get("Action");
      }),
    ).toEqual(["GetRole", "ListRolePolicies"]);

    for (const change of [
      changeOf(WIDENED_CI_DEPLOY),
      changeOf(WIDENED_IAM_READ_ACCESS),
    ]) {
      expect(await readBack(change, {})).toEqual({
        provider: "AWS",
        state: AccountChangeState.Undone,
        isAccountGone: true,
      });
    }
  });

  test("deleted between the list and the read of its document: undone", async () => {
    expect(
      await readBack(changeOf(WIDENED_IAM_READ_ACCESS), {
        ...bob(EVERYTHING),
        deletedSinceListed: ["IAMReadAccess"],
      }),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.Undone,
      url: getAwsIamUserUrl("aws", "Bob"),
    });
  });

  test("on a connection set up before the document reads, a deleted policy still reads undone: the list alone says so", async () => {
    expect(
      (
        await readBack(changeOf(WIDENED_CI_DEPLOY), {
          roles: { Deploy: { inlinePolicies: {} } },
          granted: GRANTED_BEFORE_DOCUMENT_READS,
        })
      ).state,
    ).toBe(AccountChangeState.Undone);
  });
});

describe("what OneUptime cannot read or compare is a person's to confirm, never undone", () => {
  test("a connection set up before the document reads: AWS refuses them, the role's page is still linked", async () => {
    for (const [change, options, url] of [
      [
        changeOf(WIDENED_CI_DEPLOY),
        deployRole(CI_DEPLOY),
        getAwsIamRoleUrl("aws", "Deploy"),
      ],
      [
        changeOf(WIDENED_IAM_READ_ACCESS),
        bob(IAM_READ_ACCESS),
        getAwsIamUserUrl("aws", "Bob"),
      ],
    ] as Array<[AccountChange, FakeIamOptions, string]>) {
      expect(
        await readBack(change, {
          ...options,
          granted: GRANTED_BEFORE_DOCUMENT_READS,
        }),
      ).toEqual({
        provider: "AWS",
        state: AccountChangeState.Unknown,
        reason: AccountChangeUnknownReason.NotGranted,
        url,
      });
    }
  });

  test("a document IAM answers that is no policy: OneUptime cannot tell", async () => {
    expect(
      await readBack(
        changeOf(WIDENED_CI_DEPLOY),
        deployRole("not a policy at all"),
      ),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.CannotTellWhich,
      url: getAwsIamRoleUrl("aws", "Deploy"),
      policyDocument: AccountChangePolicyDocument.NotComparable,
    });
  });

  test("a read IAM fails at is thrown, never taken as undone", async () => {
    await expect(
      readBack(changeOf(WIDENED_CI_DEPLOY), {
        ...deployRole(CI_DEPLOY),
        failing: ["GetRolePolicy"],
      }),
    ).rejects.toThrow();
  });

  test("a document CloudTrail cut short at OneUptime's 1,000 characters: never undone, whatever the policy holds now", async () => {
    // The team's policy with a statement the attack added, longer than CloudTrail's attribute keeps.
    const long: JSONObject = {
      Version: "2012-10-17",
      Statement: [
        ...(CI_DEPLOY["Statement"] as Array<JSONObject>),
        {
          Sid: "Everything",
          Effect: "Allow",
          Action: "*",
          Resource: Array.from({ length: 20 }, (_: unknown, index: number) => {
            return `arn:aws:s3:::deploy-artifacts-${index}/*`;
          }),
        },
      ],
    };
    const change: AccountChange = changeOf(
      attackInlinePolicyRecord({
        eventName: "PutRolePolicy",
        subject: "Deploy",
        policyName: "ci-deploy",
        policyDocument: asSent(long),
        eventID: "2b8c4d6e-0f1a-4b3c-9d5e-EXAMPLE77a04",
      }),
    );

    expect(asSent(long).length).toBeGreaterThan(1000);
    expect(change.policyDocuments[0]!.length).toBe(1000);

    for (const now of [CI_DEPLOY, long, EVERYTHING]) {
      expect({
        now,
        facts: await readBack(change, deployRole(now)),
      }).toEqual({
        now,
        facts: {
          provider: "AWS",
          state: AccountChangeState.Unknown,
          reason: AccountChangeUnknownReason.CannotTellWhich,
          url: getAwsIamRoleUrl("aws", "Deploy"),
          policyDocument: AccountChangePolicyDocument.NotComparable,
        },
      });
    }
  });
});

describe("a policy the case's events show written more than once", () => {
  const firstWrite: JSONObject = attackInlinePolicyRecord({
    eventName: "PutRolePolicy",
    subject: "Deploy",
    policyName: "ci-deploy",
    policyDocument: asSent({
      Version: "2012-10-17",
      Statement: { Effect: "Allow", Action: "iam:*", Resource: "*" },
    }),
    eventID: "7c9d1e2f-3a4b-4c5d-8e6f-EXAMPLE77a05",
    eventTime: "2023-07-19T21:20:00Z",
  });
  const lastWrite: JSONObject = attackInlinePolicyRecord({
    eventName: "PutRolePolicy",
    subject: "Deploy",
    policyName: "ci-deploy",
    policyDocument: asSent(EVERYTHING),
    eventID: "8d0e2f3a-4b5c-4d6e-9f70-EXAMPLE77a06",
    eventTime: "2023-07-19T21:29:12Z",
  });

  test("is one change that keeps each document, oldest first", () => {
    const change: AccountChange = changeOf(lastWrite, firstWrite);

    expect(change.policyDocuments).toEqual([
      (firstWrite["requestParameters"] as JSONObject)["policyDocument"],
      (lastWrite["requestParameters"] as JSONObject)["policyDocument"],
    ]);
    expect(change.eventUid).toBe(readRecordedEvent(firstWrite).eventUid);
  });

  test("still there while it holds the last the attack wrote", async () => {
    expect(
      (await readBack(changeOf(firstWrite, lastWrite), deployRole(EVERYTHING)))
        .state,
    ).toBe(AccountChangeState.StillThere);
  });

  test("back to an earlier one: the old one put back, or the attack's first - a person confirms which", async () => {
    expect(
      await readBack(
        changeOf(firstWrite, lastWrite),
        deployRole({
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["iam:*"], Resource: ["*"] }],
        }),
      ),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.CannotTellWhich,
      url: getAwsIamRoleUrl("aws", "Deploy"),
      policyDocument: AccountChangePolicyDocument.Earlier,
    });
  });

  test("none of them: undone", async () => {
    expect(
      (await readBack(changeOf(firstWrite, lastWrite), deployRole(CI_DEPLOY)))
        .state,
    ).toBe(AccountChangeState.Undone);
  });
});

describe("what it asks of IAM", () => {
  test("the role or the user, the one list, and the one policy's document - and writes nothing", async () => {
    const requests: Array<URLSearchParams> = [];

    await readBack(
      changeOf(WIDENED_CI_DEPLOY),
      deployRole(CI_DEPLOY),
      requests,
    );
    await readBack(
      changeOf(WIDENED_IAM_READ_ACCESS),
      bob(IAM_READ_ACCESS),
      requests,
    );

    expect(
      requests.map((form: URLSearchParams): string => {
        return [
          form.get("Action"),
          form.get("RoleName") || form.get("UserName"),
          form.get("PolicyName") || "",
        ]
          .join(" ")
          .trim();
      }),
    ).toEqual([
      "GetRole Deploy",
      "ListRolePolicies Deploy",
      "GetRolePolicy Deploy ci-deploy",
      "GetUser Bob",
      "ListUserPolicies Bob",
      "GetUserPolicy Bob IAMReadAccess",
    ]);

    for (const form of requests) {
      expect(form.get("Version")).toBe("2010-05-08");
      expect(AWS_SECURITY_CASE_CHECKS_ACTIONS).toContain(
        `iam:${form.get("Action")}`,
      );
    }
  });
});
