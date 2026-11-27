import { describe, expect, test } from "@jest/globals";
import {
  AWS_IAM_MAX_LIST_PAGES,
  AwsIamSession,
  getAwsIamPartition,
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
  AWS_LOGIN_PROFILE_LEEWAY_MS,
  AccountChangeFacts,
  AccountChangeState,
  AccountChangeUnknownReason,
} from "../../../../Server/Utils/SecurityPlaybook/AccountChangeReadBack";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { AWS_SECURITY_CASE_CHECKS_ACTIONS } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import {
  AccountChange,
  AccountChangeKind,
  AccountChangeProvider,
  AccountChangeSubject,
} from "../../../../Utils/SecurityCase/AttackAccountChanges";

/*
 * THE AWS IAM CHANGES AN ATTACK MADE, READ BACK (#10900): through a session
 * signed in to the account each was made in, with the reads Security case
 * checks grant - the user first, then the one list the change is in - and
 * never anything else. IAM here is a fake of its query API: each action
 * answered as IAM answers it, in XML, and every request held to the reads
 * the setting grants.
 */

const USER: string = "deploy-bot";
const CHANGED_AT: string = "2026-11-17T19:30:00.000Z";

interface FakeUser {
  accessKeys?: Array<{ id: string; status: string }> | undefined;
  // When its console password was set up: none when it has none.
  loginProfileCreatedAt?: string | undefined;
  attachedPolicies?: Array<string> | undefined;
  inlinePolicies?: Array<string> | undefined;
  groups?: Array<string> | undefined;
  mfaDevices?: Array<string> | undefined;
}

interface FakeIamOptions {
  // The users of the account, by name.
  users: Record<string, FakeUser>;
  // Actions the connection may not call: AccessDenied.
  refused?: Array<string> | undefined;
  // Actions IAM fails at: a 500 every time.
  failing?: Array<string> | undefined;
  // The most items a page holds, to read a list across pages.
  pageSize?: number | undefined;
}

function xml(action: string, result: string): DataSourceHttpResponse {
  const text: string = `<${action}Response xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><${action}Result>${result}</${action}Result><ResponseMetadata><RequestId>1</RequestId></ResponseMetadata></${action}Response>`;

  return { statusCode: 200, bodyText: text, bodyJson: undefined, headers: {} };
}

function iamError(
  statusCode: number,
  code: string,
  message: string,
): DataSourceHttpResponse {
  return {
    statusCode,
    bodyText: `<ErrorResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>1</RequestId></ErrorResponse>`,
    bodyJson: undefined,
    headers: {},
  };
}

function members(items: Array<string>): string {
  return items
    .map((item: string): string => {
      return `<member>${item}</member>`;
    })
    .join("");
}

// One page of a list: its items from `marker` on, and the marker of the next.
function page<T>(
  items: Array<T>,
  form: URLSearchParams,
  size: number,
): { items: Array<T>; tail: string } {
  const start: number = Number(form.get("Marker") || "0");
  const pageItems: Array<T> = items.slice(start, start + size);
  const next: number = start + size;

  return {
    items: pageItems,
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
      return iamError(
        403,
        "AccessDenied",
        `User: arn:aws:sts::123456789012:assumed-role/OneUptimeReadOnly-1a2b3c4d/session is not authorized to perform: iam:${action} because no identity-based policy allows the iam:${action} action`,
      );
    }

    if ((options.failing || []).includes(action)) {
      return iamError(500, "ServiceFailure", "Request processing has failed.");
    }

    const name: string = form.get("UserName") || "";
    const user: FakeUser | undefined = options.users[name];

    if (!user) {
      return iamError(
        404,
        "NoSuchEntity",
        `The user with name ${name} cannot be found.`,
      );
    }

    switch (action) {
      case "GetUser":
        return xml(
          action,
          `<User><Path>/</Path><UserName>${name}</UserName><UserId>AIDAEXAMPLE</UserId><Arn>arn:aws:iam::123456789012:user/${name}</Arn><CreateDate>2026-01-01T00:00:00Z</CreateDate></User>`,
        );
      case "ListAccessKeys": {
        const listed: {
          items: Array<{ id: string; status: string }>;
          tail: string;
        } = page(user.accessKeys || [], form, size);

        return xml(
          action,
          `<UserName>${name}</UserName><AccessKeyMetadata>${listed.items
            .map((key: { id: string; status: string }): string => {
              return `<member><UserName>${name}</UserName><AccessKeyId>${key.id}</AccessKeyId><Status>${key.status}</Status><CreateDate>2026-11-17T19:30:00Z</CreateDate></member>`;
            })
            .join("")}</AccessKeyMetadata>${listed.tail}`,
        );
      }
      case "GetLoginProfile":
        return user.loginProfileCreatedAt
          ? xml(
              action,
              `<LoginProfile><UserName>${name}</UserName><CreateDate>${user.loginProfileCreatedAt}</CreateDate><PasswordResetRequired>false</PasswordResetRequired></LoginProfile>`,
            )
          : iamError(
              404,
              "NoSuchEntity",
              `Login Profile for User ${name} cannot be found.`,
            );
      case "ListAttachedUserPolicies": {
        const listed: { items: Array<string>; tail: string } = page(
          user.attachedPolicies || [],
          form,
          size,
        );

        return xml(
          action,
          `<AttachedPolicies>${listed.items
            .map((arn: string): string => {
              return `<member><PolicyName>${arn.split("/").pop()}</PolicyName><PolicyArn>${arn}</PolicyArn></member>`;
            })
            .join("")}</AttachedPolicies>${listed.tail}`,
        );
      }
      case "ListUserPolicies": {
        const listed: { items: Array<string>; tail: string } = page(
          user.inlinePolicies || [],
          form,
          size,
        );

        return xml(
          action,
          `<PolicyNames>${members(listed.items)}</PolicyNames>${listed.tail}`,
        );
      }
      case "ListGroupsForUser": {
        const listed: { items: Array<string>; tail: string } = page(
          user.groups || [],
          form,
          size,
        );

        return xml(
          action,
          `<Groups>${listed.items
            .map((group: string): string => {
              return `<member><Path>/</Path><GroupName>${group}</GroupName><GroupId>AGPAEXAMPLE</GroupId><Arn>arn:aws:iam::123456789012:group/${group}</Arn><CreateDate>2026-01-01T00:00:00Z</CreateDate></member>`;
            })
            .join("")}</Groups>${listed.tail}`,
        );
      }
      case "ListMFADevices": {
        const listed: { items: Array<string>; tail: string } = page(
          user.mfaDevices || [],
          form,
          size,
        );

        return xml(
          action,
          `<MFADevices>${listed.items
            .map((serial: string): string => {
              return `<member><UserName>${name}</UserName><SerialNumber>${serial}</SerialNumber><EnableDate>2026-11-17T19:30:00Z</EnableDate></member>`;
            })
            .join("")}</MFADevices>${listed.tail}`,
        );
      }
      default:
        throw new Error(`the fake does not answer ${action}`);
    }
  };
}

function session(
  transport: CloudConnectorTransport,
  partition: AwsIamSession["partition"] = "aws",
): AwsIamSession {
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
    partition,
    accountId: "123456789012",
    subject: "The role",
  };
}

function change(data: Partial<AccountChange>): AccountChange {
  return {
    provider: AccountChangeProvider.Aws,
    kind: AccountChangeKind.Key,
    subject: AccountChangeSubject.Account,
    account: USER,
    accountId: "",
    objectId: "",
    objectName: "",
    detailId: "",
    ownerType: "",
    cloudAccountId: "123456789012",
    cloudConnectionId: "",
    trustPolicies: [],
    eventName: "",
    eventUid: "cloudtrail:1",
    time: CHANGED_AT,
    ...data,
  };
}

async function read(
  options: FakeIamOptions,
  data: Partial<AccountChange>,
  requests?: Array<URLSearchParams>,
): Promise<AccountChangeFacts> {
  return await AccountChangeReadBack.readInAws({
    session: session(fakeIam(options, requests)),
    change: change(data),
  });
}

const USER_PAGE: string = `https://console.aws.amazon.com/iam/home#/users/details/${USER}`;

describe("an access key the attack made (CreateAccessKey)", () => {
  const key: Partial<AccountChange> = {
    kind: AccountChangeKind.Key,
    eventName: "CreateAccessKey",
    objectId: "AKIAEXAMPLE1",
    objectName: "AKIAEXAMPLE1",
  };

  test("still there while it is, and active, linking the user's page", async () => {
    expect(
      await read(
        {
          users: {
            [USER]: { accessKeys: [{ id: "AKIAEXAMPLE1", status: "Active" }] },
          },
        },
        key,
      ),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.StillThere,
      url: USER_PAGE,
    });
  });

  test("undone once it is deleted, or made inactive: it no longer works", async () => {
    for (const accessKeys of [
      [],
      [{ id: "AKIAEXAMPLE1", status: "Inactive" }],
      [{ id: "AKIAOWNERS0", status: "Active" }],
    ]) {
      expect(
        (await read({ users: { [USER]: { accessKeys } } }, key)).state,
      ).toBe(AccountChangeState.Undone);
    }
  });

  test("an event that names no key: undone with no active key, else no guess", async () => {
    const unnamed: Partial<AccountChange> = {
      ...key,
      objectId: "",
      objectName: "",
    };

    expect(
      (
        await read(
          {
            users: {
              [USER]: { accessKeys: [{ id: "AKIAOLD", status: "Inactive" }] },
            },
          },
          unnamed,
        )
      ).state,
    ).toBe(AccountChangeState.Undone);
    expect(
      await read(
        {
          users: {
            [USER]: { accessKeys: [{ id: "AKIAOWNERS0", status: "Active" }] },
          },
        },
        unnamed,
      ),
    ).toMatchObject({
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.CannotTellWhich,
      holding: ["AKIAOWNERS0"],
    });
  });

  test("read across pages, the key on the last one", async () => {
    const requests: Array<URLSearchParams> = [];
    const accessKeys: Array<{ id: string; status: string }> = [
      { id: "AKIA1", status: "Inactive" },
      { id: "AKIA2", status: "Inactive" },
      { id: "AKIAEXAMPLE1", status: "Active" },
    ];

    expect(
      (
        await read(
          { users: { [USER]: { accessKeys } }, pageSize: 1 },
          key,
          requests,
        )
      ).state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      requests
        .filter((form: URLSearchParams): boolean => {
          return form.get("Action") === "ListAccessKeys";
        })
        .map((form: URLSearchParams): string | null => {
          return form.get("Marker");
        }),
    ).toEqual([null, "1", "2"]);
  });

  test("a list longer than OneUptime reads is no answer, never undone", async () => {
    const accessKeys: Array<{ id: string; status: string }> = [];

    for (let index: number = 0; index <= AWS_IAM_MAX_LIST_PAGES; index++) {
      accessKeys.push({ id: `AKIA${index}`, status: "Inactive" });
    }

    await expect(
      read({ users: { [USER]: { accessKeys } }, pageSize: 1 }, key),
    ).rejects.toThrow("more for deploy-bot than OneUptime reads");
  });
});

describe("a console password the attack set (CreateLoginProfile)", () => {
  const password: Partial<AccountChange> = {
    kind: AccountChangeKind.Password,
    eventName: "CreateLoginProfile",
  };

  test("undone once the user has none", async () => {
    expect((await read({ users: { [USER]: {} } }, password)).state).toBe(
      AccountChangeState.Undone,
    );
  });

  test("undone once one is set up again after the attack's, which went with it", async () => {
    expect(
      (
        await read(
          {
            users: {
              [USER]: {
                loginProfileCreatedAt: new Date(
                  Date.parse(CHANGED_AT) + AWS_LOGIN_PROFILE_LEEWAY_MS + 60_000,
                ).toISOString(),
              },
            },
          },
          password,
        )
      ).state,
    ).toBe(AccountChangeState.Undone);
  });

  test("the attack's own still there is a person's to confirm: IAM does not say whether its password changed", async () => {
    expect(
      await read(
        { users: { [USER]: { loginProfileCreatedAt: CHANGED_AT } } },
        password,
      ),
    ).toEqual({
      provider: "AWS",
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.CannotTellWhich,
      url: USER_PAGE,
    });
  });
});

describe("a policy put on the user (AttachUserPolicy, PutUserPolicy)", () => {
  const managed: Partial<AccountChange> = {
    kind: AccountChangeKind.Policy,
    eventName: "AttachUserPolicy",
    objectId: "arn:aws:iam::aws:policy/AdministratorAccess",
    objectName: "AdministratorAccess",
  };
  const inline: Partial<AccountChange> = {
    kind: AccountChangeKind.Policy,
    eventName: "PutUserPolicy",
    objectName: "backdoor",
  };

  test("a managed policy: still there while it is attached, by its ARN; undone once detached", async () => {
    expect(
      (
        await read(
          {
            users: {
              [USER]: {
                attachedPolicies: [
                  "arn:aws:iam::aws:policy/ReadOnlyAccess",
                  "arn:aws:iam::aws:policy/AdministratorAccess",
                ],
              },
            },
          },
          managed,
        )
      ).state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      (
        await read(
          {
            users: {
              [USER]: {
                // Another policy of the same name is not the one.
                attachedPolicies: [
                  "arn:aws:iam::123456789012:policy/AdministratorAccess",
                ],
              },
            },
          },
          managed,
        )
      ).state,
    ).toBe(AccountChangeState.Undone);
  });

  test("an inline policy: still there while the user has one of its name, case aside; undone once deleted", async () => {
    expect(
      (
        await read(
          { users: { [USER]: { inlinePolicies: ["BackDoor"] } } },
          inline,
        )
      ).state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      (await read({ users: { [USER]: { inlinePolicies: [] } } }, inline)).state,
    ).toBe(AccountChangeState.Undone);
  });

  test("an event that names no policy is not looked for", async () => {
    expect(
      await read(
        { users: { [USER]: {} } },
        { ...managed, objectId: "", objectName: "" },
      ),
    ).toMatchObject({ reason: AccountChangeUnknownReason.NotNamed });
    expect(
      await read({ users: { [USER]: {} } }, { ...inline, objectName: "" }),
    ).toMatchObject({ reason: AccountChangeUnknownReason.NotNamed });
  });
});

describe("a group the user was put in (AddUserToGroup)", () => {
  const group: Partial<AccountChange> = {
    kind: AccountChangeKind.Group,
    eventName: "AddUserToGroup",
    objectName: "Admins",
  };

  test("still there while the user is in it, case aside; undone once removed", async () => {
    expect(
      (await read({ users: { [USER]: { groups: ["admins", "Ops"] } } }, group))
        .state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      (await read({ users: { [USER]: { groups: ["Ops"] } } }, group)).state,
    ).toBe(AccountChangeState.Undone);
  });
});

describe("an MFA device the attack enabled (EnableMFADevice)", () => {
  const device: Partial<AccountChange> = {
    kind: AccountChangeKind.MfaDevice,
    eventName: "EnableMFADevice",
    objectId: "arn:aws:iam::123456789012:mfa/attacker",
    objectName: "arn:aws:iam::123456789012:mfa/attacker",
  };

  test("still there while the user has it, by its serial number; undone once deactivated", async () => {
    expect(
      (
        await read(
          {
            users: {
              [USER]: {
                mfaDevices: [
                  "arn:aws:iam::123456789012:mfa/owner",
                  "arn:aws:iam::123456789012:mfa/attacker",
                ],
              },
            },
          },
          device,
        )
      ).state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      (
        await read(
          {
            users: {
              [USER]: { mfaDevices: ["arn:aws:iam::123456789012:mfa/owner"] },
            },
          },
          device,
        )
      ).state,
    ).toBe(AccountChangeState.Undone);
  });

  test("an event that names no device: undone with none left, else the owner's own may be the one", async () => {
    const unnamed: Partial<AccountChange> = {
      ...device,
      objectId: "",
      objectName: "",
    };

    expect((await read({ users: { [USER]: {} } }, unnamed)).state).toBe(
      AccountChangeState.Undone,
    );
    expect(
      await read(
        {
          users: {
            [USER]: { mfaDevices: ["arn:aws:iam::123456789012:mfa/owner"] },
          },
        },
        unnamed,
      ),
    ).toMatchObject({ reason: AccountChangeUnknownReason.CannotTellWhich });
  });
});

describe("a user the attack made (CreateUser)", () => {
  test("still there until it is deleted", async () => {
    const made: Partial<AccountChange> = {
      kind: AccountChangeKind.Account,
      eventName: "CreateUser",
    };

    expect((await read({ users: { [USER]: {} } }, made)).state).toBe(
      AccountChangeState.StillThere,
    );
    expect(await read({ users: {} }, made)).toEqual({
      provider: "AWS",
      state: AccountChangeState.Undone,
      isAccountGone: true,
    });
  });
});

describe("whatever the change", () => {
  const changes: Array<Partial<AccountChange>> = [
    { kind: AccountChangeKind.Key, objectId: "AKIAEXAMPLE1" },
    { kind: AccountChangeKind.Password, eventName: "CreateLoginProfile" },
    {
      kind: AccountChangeKind.Policy,
      eventName: "AttachUserPolicy",
      objectId: "arn:aws:iam::aws:policy/AdministratorAccess",
    },
    {
      kind: AccountChangeKind.Policy,
      eventName: "PutUserPolicy",
      objectName: "x",
    },
    { kind: AccountChangeKind.Group, objectName: "Admins" },
    { kind: AccountChangeKind.MfaDevice, objectId: "arn:aws:iam::1:mfa/a" },
  ];

  test("a user deleted took everything it was given with it", async () => {
    for (const data of changes) {
      expect(await read({ users: {} }, data)).toEqual({
        provider: "AWS",
        state: AccountChangeState.Undone,
        isAccountGone: true,
      });
    }
  });

  test("a read the connection was not given is the change a person confirms, never undone", async () => {
    for (const refused of [
      ["GetUser"],
      [
        "ListAccessKeys",
        "GetLoginProfile",
        "ListAttachedUserPolicies",
        "ListUserPolicies",
        "ListGroupsForUser",
        "ListMFADevices",
      ],
    ]) {
      for (const data of changes) {
        expect(await read({ users: { [USER]: {} }, refused }, data)).toEqual({
          provider: "AWS",
          state: AccountChangeState.Unknown,
          reason: AccountChangeUnknownReason.NotGranted,
        });
      }
    }
  });

  test("a read IAM fails at is thrown, never taken as undone", async () => {
    for (const data of changes) {
      await expect(
        read({ users: { [USER]: {} }, failing: ["GetUser"] }, data),
      ).rejects.toThrow();
    }
  });

  test("asks IAM nothing but the user and the one list each change is in", async () => {
    const requests: Array<URLSearchParams> = [];

    for (const data of changes) {
      await read({ users: { [USER]: {} } }, data, requests);
    }

    expect(
      requests.map((form: URLSearchParams): string => {
        return `${form.get("Action")} ${form.get("UserName")}`;
      }),
    ).toEqual([
      "GetUser deploy-bot",
      "ListAccessKeys deploy-bot",
      "GetUser deploy-bot",
      "GetLoginProfile deploy-bot",
      "GetUser deploy-bot",
      "ListAttachedUserPolicies deploy-bot",
      "GetUser deploy-bot",
      "ListUserPolicies deploy-bot",
      "GetUser deploy-bot",
      "ListGroupsForUser deploy-bot",
      "GetUser deploy-bot",
      "ListMFADevices deploy-bot",
    ]);

    for (const form of requests) {
      expect(form.get("Version")).toBe("2010-05-08");
    }
  });
});

describe("where a person undoes it", () => {
  test("the user's page in the partition's own console", () => {
    expect(getAwsIamUserUrl("aws", "deploy bot")).toBe(
      "https://console.aws.amazon.com/iam/home#/users/details/deploy%20bot",
    );
    expect(getAwsIamUserUrl("aws-us-gov", "a")).toBe(
      "https://console.amazonaws-us-gov.com/iam/home#/users/details/a",
    );
    expect(getAwsIamUserUrl("aws-cn", "a")).toBe(
      "https://console.amazonaws.cn/iam/home#/users/details/a",
    );
  });

  test("the partition a connection's account is in: its role's ARN says, else its Regions", () => {
    const settings: (config: Record<string, string>) => {
      provider: CloudProvider;
      projectId: string;
      config: Record<string, string>;
      secrets: Record<string, string>;
    } = (config: Record<string, string>) => {
      return {
        provider: CloudProvider.AWS,
        projectId: "p",
        config,
        secrets: {},
      };
    };

    expect(
      getAwsIamPartition(
        settings({ roleArn: "arn:aws-us-gov:iam::123456789012:role/R" }),
      ),
    ).toBe("aws-us-gov");
    expect(
      getAwsIamPartition(
        settings({ roleArn: "arn:aws:iam::123456789012:role/R" }),
      ),
    ).toBe("aws");
    expect(
      getAwsIamPartition(
        settings({ authMethod: "aws-access-key", regions: "cn-north-1" }),
      ),
    ).toBe("aws-cn");
    expect(getAwsIamPartition(settings({ authMethod: "aws-access-key" }))).toBe(
      "aws",
    );
  });
});
