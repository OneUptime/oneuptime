import { describe, expect, test } from "@jest/globals";
import { SecurityCaseEventSnapshot } from "../../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchesJson,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import {
  ACCOUNT_CHANGES_MAX,
  ACCOUNT_CHANGE_KINDS,
  AWS_IAM_ROLE_CHANGES,
  AccountChange,
  AccountChangeKind,
  AccountChangeProvider,
  AccountChangeSubject,
  getAttackAccountChanges,
  readAccountChange,
  readAwsPolicyName,
  readEntraKeyIdentifier,
  readEntraPropertyValue,
} from "../../../Utils/SecurityCase/AttackAccountChanges";
import {
  CLOUD_AUDIT_ACCOUNT_ATTRIBUTE,
  CLOUD_AUDIT_CONNECTION_ATTRIBUTE,
} from "../../../Server/Utils/SecurityEvent/CloudAudit/CloudAuditSecurityEvents";
import {
  ATTACH_ROLE_POLICY_RECORD,
  CREATE_ROLE_RECORD,
  PUT_ROLE_POLICY_RECORD,
  RECORDED_ACCOUNT,
  UPDATE_ASSUME_ROLE_POLICY_RECORD,
  readRecordedEvent,
} from "../../Helpers/AwsIamRoleRecords";

/*
 * What an attack changed on accounts, read from a case's events (#10603):
 * each identity product's own record of access given - a role, a group, an
 * app, a second factor, a key - and of an account made, as its connector
 * keeps it on the event; only what succeeded.
 */

function event(
  data: Partial<SecurityCaseEventSnapshot> & {
    attributes: Record<string, string>;
  },
): SecurityCaseEventSnapshot {
  return {
    time: "2026-11-17T19:30:00.000Z",
    eventUid: "event-1",
    sourceId: "",
    severityName: "Informational",
    className: "",
    categoryName: "",
    activityName: "",
    statusName: "",
    message: "",
    vendorName: "",
    productName: "",
    ruleName: "",
    principalUser: "",
    principalHost: "",
    principalIp: "",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: null,
    processName: "",
    processCommandLine: "",
    observables: [],
    mitreTactics: [],
    mitreTechniques: [],
    traceId: "",
    spanId: "",
    sessionId: "",
    requestOutcome: "",
    hunt: null,
    ...data,
  };
}

// ---------- Okta ----------

function okta(
  eventType: string,
  targets: Array<Record<string, string>>,
  extra: Record<string, string> = {},
): SecurityCaseEventSnapshot {
  const attributes: Record<string, string> = {
    eventType,
    "outcome.result": "SUCCESS",
    ...extra,
  };

  targets.forEach((target: Record<string, string>, index: number) => {
    for (const [key, value] of Object.entries(target)) {
      attributes[`target.${index}.${key}`] = value;
    }
  });

  return event({
    vendorName: "Okta",
    productName: "Okta System Log",
    principalUser: "mallory@acme.com",
    attributes,
  });
}

const OKTA_ALICE: Record<string, string> = {
  id: "00u1alice",
  type: "User",
  alternateId: "alice@acme.com",
  displayName: "Alice",
};

describe("Okta's System Log", () => {
  test("a group the account was put in", () => {
    expect(
      readAccountChange(
        okta("group.user_membership.add", [
          OKTA_ALICE,
          { id: "00g1admins", type: "UserGroup", displayName: "Admins" },
        ]),
      ),
    ).toMatchObject({
      provider: AccountChangeProvider.Okta,
      kind: AccountChangeKind.Group,
      account: "alice@acme.com",
      accountId: "00u1alice",
      objectId: "00g1admins",
      objectName: "Admins",
      eventName: "group.user_membership.add",
    });
  });

  test("an admin privilege granted, named as the System Log names it", () => {
    expect(
      readAccountChange(
        okta("user.account.privilege.grant", [OKTA_ALICE], {
          "debugContext.debugData.privilegeGranted": "Super administrator",
        }),
      ),
    ).toMatchObject({
      kind: AccountChangeKind.AdminRole,
      account: "alice@acme.com",
      objectName: "Super administrator",
    });
  });

  test("a factor activated: the enrollment the event names, and its authenticator", () => {
    expect(
      readAccountChange(
        okta("user.mfa.factor.activate", [
          OKTA_ALICE,
          {
            id: "pfd1factor",
            type: "AuthenticatorEnrollment",
            alternateId: "unknown",
            displayName: "Okta Verify",
          },
        ]),
      ),
    ).toMatchObject({
      kind: AccountChangeKind.MfaDevice,
      objectId: "pfd1factor",
      objectName: "Okta Verify",
    });
  });

  test("an app assigned to the account", () => {
    expect(
      readAccountChange(
        okta("application.user_membership.add", [
          OKTA_ALICE,
          { id: "0oa1app", type: "AppInstance", displayName: "Salesforce" },
        ]),
      ),
    ).toMatchObject({
      kind: AccountChangeKind.App,
      objectId: "0oa1app",
      objectName: "Salesforce",
    });
  });

  test("an API token made: the admin who made it holds its rights", () => {
    expect(
      readAccountChange(
        okta(
          "system.api_token.create",
          [{ id: "00T1token", type: "Token", displayName: "backup" }],
          { "actor.id": "00u1mallory" },
        ),
      ),
    ).toMatchObject({
      kind: AccountChangeKind.Key,
      account: "mallory@acme.com",
      accountId: "00u1mallory",
      objectId: "00T1token",
      objectName: "backup",
    });
  });

  test("an account the attack made", () => {
    expect(
      readAccountChange(okta("user.lifecycle.create", [OKTA_ALICE])),
    ).toMatchObject({
      kind: AccountChangeKind.Account,
      account: "alice@acme.com",
      accountId: "00u1alice",
    });
  });

  test("what failed gave nothing, and other events are no change", () => {
    expect(
      readAccountChange(
        okta("group.user_membership.add", [OKTA_ALICE], {
          "outcome.result": "FAILURE",
        }),
      ),
    ).toBeNull();
    expect(
      readAccountChange(okta("user.session.start", [OKTA_ALICE])),
    ).toBeNull();
    expect(
      readAccountChange(okta("group.user_membership.remove", [OKTA_ALICE])),
    ).toBeNull();
  });

  test("a change to no account it can name is none", () => {
    expect(
      readAccountChange(
        okta("group.user_membership.add", [
          { id: "00g1admins", type: "UserGroup", displayName: "Admins" },
        ]),
      ),
    ).toBeNull();
  });
});

// ---------- Microsoft Entra ID ----------

function entra(
  activity: string,
  targets: Array<{
    fields: Record<string, string>;
    properties?: Record<string, string>;
  }>,
  extra: Record<string, string> = {},
): SecurityCaseEventSnapshot {
  const attributes: Record<string, string> = {
    "entra.log": "AuditLogs",
    activityDisplayName: activity,
    result: "success",
    ...extra,
  };

  targets.forEach(
    (
      target: {
        fields: Record<string, string>;
        properties?: Record<string, string>;
      },
      index: number,
    ) => {
      for (const [key, value] of Object.entries(target.fields)) {
        attributes[`targetResources.${index}.${key}`] = value;
      }

      Object.entries(target.properties || {}).forEach(
        ([name, value]: [string, string], property: number) => {
          attributes[
            `targetResources.${index}.modifiedProperties.${property}.displayName`
          ] = name;
          attributes[
            `targetResources.${index}.modifiedProperties.${property}.newValue`
          ] = value;
        },
      );
    },
  );

  return event({
    vendorName: "Microsoft",
    productName: "Microsoft Entra ID",
    activityName: activity,
    attributes,
  });
}

const ENTRA_ALICE: Record<string, string> = {
  type: "User",
  id: "11111111-aaaa-4aaa-8aaa-111111111111",
  userPrincipalName: "alice@acme.onmicrosoft.com",
};

describe("Microsoft Entra ID's audit log", () => {
  test("a directory role, known by its template in every tenant", () => {
    expect(
      readAccountChange(
        entra("Add member to role", [
          {
            fields: ENTRA_ALICE,
            properties: {
              "Role.ObjectID": '"aaaaaaaa-0000-4000-8000-000000000001"',
              "Role.DisplayName": '"Global Administrator"',
              "Role.TemplateId": '"62e90394-69f5-4237-9190-012177145e10"',
            },
          },
        ]),
      ),
    ).toMatchObject({
      provider: AccountChangeProvider.EntraId,
      kind: AccountChangeKind.AdminRole,
      account: "alice@acme.onmicrosoft.com",
      accountId: "11111111-aaaa-4aaa-8aaa-111111111111",
      objectId: "62e90394-69f5-4237-9190-012177145e10",
      objectName: "Global Administrator",
    });
  });

  test("a group, by its own target", () => {
    expect(
      readAccountChange(
        entra("Add member to group", [
          { fields: ENTRA_ALICE },
          {
            fields: {
              type: "Group",
              id: "22222222-bbbb-4bbb-8bbb-222222222222",
              displayName: "Finance Admins",
            },
          },
        ]),
      ),
    ).toMatchObject({
      kind: AccountChangeKind.Group,
      objectId: "22222222-bbbb-4bbb-8bbb-222222222222",
      objectName: "Finance Admins",
    });
  });

  test("an app role, with the role the app gave", () => {
    expect(
      readAccountChange(
        entra("Add app role assignment to user", [
          {
            fields: {
              type: "ServicePrincipal",
              id: "33333333-cccc-4ccc-8ccc-333333333333",
              displayName: "Payroll",
            },
            properties: {
              "AppRole.Id": '"44444444-dddd-4ddd-8ddd-444444444444"',
            },
          },
          { fields: ENTRA_ALICE },
        ]),
      ),
    ).toMatchObject({
      kind: AccountChangeKind.App,
      account: "alice@acme.onmicrosoft.com",
      objectId: "33333333-cccc-4ccc-8ccc-333333333333",
      objectName: "Payroll",
      detailId: "44444444-dddd-4ddd-8ddd-444444444444",
    });
  });

  test("security info registered by the account or for it", () => {
    for (const activity of [
      "User registered security info",
      "Admin registered security info",
    ]) {
      expect(
        readAccountChange(
          entra(activity, [{ fields: ENTRA_ALICE }], {
            resultReason:
              "User registered Authenticator App with Notification and Code",
          }),
        ),
      ).toMatchObject({
        kind: AccountChangeKind.MfaDevice,
        account: "alice@acme.onmicrosoft.com",
        objectName:
          "User registered Authenticator App with Notification and Code",
      });
    }
  });

  test("a key added to an app: the app's, read by its key's identifier", () => {
    const description: string =
      '["[KeyIdentifier=55555555-EEEE-4EEE-8EEE-555555555555,KeyType=Password,KeyUsage=Verify,DisplayName=backdoor]"]';

    expect(
      readAccountChange(
        entra("Add service principal credentials", [
          {
            fields: {
              type: "ServicePrincipal",
              id: "66666666-ffff-4fff-8fff-666666666666",
              displayName: "Payroll",
            },
            properties: { KeyDescription: description },
          },
        ]),
      ),
    ).toMatchObject({
      kind: AccountChangeKind.Key,
      account: "Payroll",
      accountId: "66666666-ffff-4fff-8fff-666666666666",
      ownerType: "ServicePrincipal",
      objectId: "55555555-eeee-4eee-8eee-555555555555",
      objectName: "backdoor",
    });
    expect(
      readAccountChange(
        entra("Update application – Certificates and secrets management ", [
          {
            fields: {
              type: "Application",
              id: "77777777-0000-4000-8000-777777777777",
              displayName: "Payroll",
            },
            properties: { KeyDescription: description },
          },
        ]),
      ),
    ).toMatchObject({ kind: AccountChangeKind.Key, ownerType: "Application" });
  });

  test("an account the attack made", () => {
    expect(
      readAccountChange(entra("Add user", [{ fields: ENTRA_ALICE }])),
    ).toMatchObject({
      kind: AccountChangeKind.Account,
      account: "alice@acme.onmicrosoft.com",
    });
  });

  test("a failed audit, a sign-in and a removal are no change", () => {
    expect(
      readAccountChange(
        entra("Add member to role", [{ fields: ENTRA_ALICE }], {
          result: "failure",
        }),
      ),
    ).toBeNull();
    expect(
      readAccountChange(
        entra("Add member to role", [{ fields: ENTRA_ALICE }], {
          "entra.log": "SignInLogs",
        }),
      ),
    ).toBeNull();
    expect(
      readAccountChange(
        entra("Remove member from role", [{ fields: ENTRA_ALICE }]),
      ),
    ).toBeNull();
  });

  test("a modified property's value and a key's identifier, as Entra ID writes them", () => {
    expect(readEntraPropertyValue('"Global Administrator"')).toBe(
      "Global Administrator",
    );
    expect(readEntraPropertyValue('["Global Administrator"]')).toBe(
      "Global Administrator",
    );
    expect(readEntraKeyIdentifier("KeyIdentifier=nope")).toBe("");
  });
});

// ---------- Google Workspace ----------

function workspace(
  application: string,
  name: string,
  parameters: Record<string, string>,
  actor: string = "mallory@acme.com",
): SecurityCaseEventSnapshot {
  const attributes: Record<string, string> = {
    "id.applicationName": application,
    "event.name": name,
    "actor.email": actor,
  };

  for (const [key, value] of Object.entries(parameters)) {
    attributes[`parameters.${key}`] = value;
  }

  return event({
    vendorName: "Google",
    productName: "Google Workspace",
    principalUser: actor,
    attributes,
  });
}

describe("Google Workspace's audit log", () => {
  test("a super admin granted, and another admin role", () => {
    expect(
      readAccountChange(
        workspace("admin", "GRANT_ADMIN_PRIVILEGE", {
          USER_EMAIL: "alice@acme.com",
        }),
      ),
    ).toMatchObject({
      provider: AccountChangeProvider.GoogleWorkspace,
      kind: AccountChangeKind.AdminRole,
      account: "alice@acme.com",
      objectId: "SUPER_ADMIN",
    });
    expect(
      readAccountChange(
        workspace("admin", "ASSIGN_ROLE", {
          USER_EMAIL: "alice@acme.com",
          ROLE_NAME: "Groups Admin",
        }),
      ),
    ).toMatchObject({
      kind: AccountChangeKind.AdminRole,
      objectId: "",
      objectName: "Groups Admin",
    });
  });

  test("a group, an account made, an app given the account's data, 2-Step Verification", () => {
    expect(
      readAccountChange(
        workspace("admin", "ADD_GROUP_MEMBER", {
          USER_EMAIL: "alice@acme.com",
          GROUP_EMAIL: "finance@acme.com",
        }),
      ),
    ).toMatchObject({
      kind: AccountChangeKind.Group,
      objectName: "finance@acme.com",
    });
    expect(
      readAccountChange(
        workspace("admin", "CREATE_USER", { USER_EMAIL: "backup@acme.com" }),
      ),
    ).toMatchObject({
      kind: AccountChangeKind.Account,
      account: "backup@acme.com",
    });
    expect(
      readAccountChange(
        workspace(
          "token",
          "authorize",
          {
            client_id: "123.apps.googleusercontent.com",
            app_name: "Mail Sync",
          },
          "alice@acme.com",
        ),
      ),
    ).toMatchObject({
      kind: AccountChangeKind.App,
      account: "alice@acme.com",
      objectId: "123.apps.googleusercontent.com",
      objectName: "Mail Sync",
    });
    expect(
      readAccountChange(
        workspace("user_accounts", "2sv_enroll", {}, "alice@acme.com"),
      ),
    ).toMatchObject({
      kind: AccountChangeKind.MfaDevice,
      account: "alice@acme.com",
    });
  });

  test("a revoke and a sign-in are no change", () => {
    expect(
      readAccountChange(
        workspace("admin", "REVOKE_ADMIN_PRIVILEGE", {
          USER_EMAIL: "alice@acme.com",
        }),
      ),
    ).toBeNull();
    expect(
      readAccountChange(workspace("login", "login_success", {})),
    ).toBeNull();
  });
});

// ---------- AWS CloudTrail ----------

function cloudTrail(
  eventName: string,
  fields: Record<string, string>,
): SecurityCaseEventSnapshot {
  return event({
    vendorName: "Amazon Web Services",
    productName: "AWS CloudTrail",
    attributes: {
      eventSource: "iam.amazonaws.com",
      eventName,
      ...fields,
    },
  });
}

describe("AWS CloudTrail's IAM calls", () => {
  test.each([
    [
      "CreateAccessKey",
      {
        "requestParameters.userName": "deploy-bot",
        "responseElements.accessKey.accessKeyId": "AKIAEXAMPLE",
      },
      AccountChangeKind.Key,
      "AKIAEXAMPLE",
      "AKIAEXAMPLE",
    ],
    [
      "AttachUserPolicy",
      {
        "requestParameters.userName": "deploy-bot",
        "requestParameters.policyArn":
          "arn:aws:iam::aws:policy/AdministratorAccess",
      },
      AccountChangeKind.Policy,
      "arn:aws:iam::aws:policy/AdministratorAccess",
      "AdministratorAccess",
    ],
    [
      "PutUserPolicy",
      {
        "requestParameters.userName": "deploy-bot",
        "requestParameters.policyName": "backdoor",
      },
      AccountChangeKind.Policy,
      "",
      "backdoor",
    ],
    [
      "AddUserToGroup",
      {
        "requestParameters.userName": "deploy-bot",
        "requestParameters.groupName": "Admins",
      },
      AccountChangeKind.Group,
      "",
      "Admins",
    ],
    [
      "CreateLoginProfile",
      { "requestParameters.userName": "deploy-bot" },
      AccountChangeKind.Password,
      "",
      "",
    ],
    [
      "EnableMFADevice",
      {
        "requestParameters.userName": "deploy-bot",
        "requestParameters.serialNumber":
          "arn:aws:iam::123456789012:mfa/deploy-bot",
      },
      AccountChangeKind.MfaDevice,
      "arn:aws:iam::123456789012:mfa/deploy-bot",
      "arn:aws:iam::123456789012:mfa/deploy-bot",
    ],
    [
      "CreateUser",
      { "requestParameters.userName": "backup-admin" },
      AccountChangeKind.Account,
      "",
      "",
    ],
  ])(
    "%s: what it gave, by its id in IAM and its name (#10900)",
    (
      eventName: string,
      fields: Record<string, string>,
      kind: AccountChangeKind,
      objectId: string,
      objectName: string,
    ) => {
      expect(readAccountChange(cloudTrail(eventName, fields))).toMatchObject({
        provider: AccountChangeProvider.Aws,
        kind,
        objectId,
        objectName,
      });
    },
  );

  test("a managed policy is named by the end of its ARN, a path and a customer's account kept in its id", () => {
    expect(
      readAwsPolicyName("arn:aws:iam::aws:policy/AdministratorAccess"),
    ).toBe("AdministratorAccess");
    expect(
      readAwsPolicyName(
        "arn:aws:iam::123456789012:policy/team/ops/break-glass",
      ),
    ).toBe("break-glass");
    expect(readAwsPolicyName("not-an-arn")).toBe("not-an-arn");
    expect(
      readAccountChange(
        cloudTrail("AttachUserPolicy", {
          "requestParameters.userName": "deploy-bot",
          "requestParameters.policyArn":
            "arn:aws:iam::123456789012:policy/team/ops/break-glass",
        }),
      ),
    ).toMatchObject({
      objectId: "arn:aws:iam::123456789012:policy/team/ops/break-glass",
      objectName: "break-glass",
    });
  });

  test("the account a call was made in: the one CloudTrail says received it, else the connection's, else the caller's", () => {
    const made: (fields: Record<string, string>) => AccountChange | null = (
      fields: Record<string, string>,
    ): AccountChange | null => {
      return readAccountChange(
        cloudTrail("AddUserToGroup", {
          "requestParameters.userName": "deploy-bot",
          "requestParameters.groupName": "Admins",
          ...fields,
        }),
      );
    };

    expect(
      made({
        recipientAccountId: "123456789012",
        [CLOUD_AUDIT_ACCOUNT_ATTRIBUTE]: "210987654321",
        "userIdentity.accountId": "111122223333",
      })?.cloudAccountId,
    ).toBe("123456789012");
    expect(
      made({
        [CLOUD_AUDIT_ACCOUNT_ATTRIBUTE]: "210987654321",
        "userIdentity.accountId": "111122223333",
      })?.cloudAccountId,
    ).toBe("210987654321");
    expect(
      made({ "userIdentity.accountId": "111122223333" })?.cloudAccountId,
    ).toBe("111122223333");
    // Anything but twelve digits names no account.
    expect(
      made({ recipientAccountId: "anonymous", "userIdentity.accountId": "12" })
        ?.cloudAccountId,
    ).toBe("");
  });

  test("the cloud connection whose Cloud audit logs read the call, when one did", () => {
    expect(
      readAccountChange(
        cloudTrail("CreateUser", {
          "requestParameters.userName": "backup-admin",
          [CLOUD_AUDIT_CONNECTION_ATTRIBUTE]:
            "5d0c2a7e-0000-4000-8000-00000000c0de",
        }),
      )?.cloudConnectionId,
    ).toBe("5d0c2a7e-0000-4000-8000-00000000c0de");
    expect(
      readAccountChange(
        cloudTrail("CreateUser", { "requestParameters.userName": "a" }),
      )?.cloudConnectionId,
    ).toBe("");
  });

  test("a user of one name in two AWS accounts is two accounts; the same change twice in one is one", () => {
    const groupAdded: (
      account: string,
      time: string,
      uid: string,
    ) => SecurityCaseEventSnapshot = (
      account: string,
      time: string,
      uid: string,
    ): SecurityCaseEventSnapshot => {
      return {
        ...cloudTrail("AddUserToGroup", {
          "requestParameters.userName": "deploy-bot",
          "requestParameters.groupName": "Admins",
          recipientAccountId: account,
        }),
        time,
        eventUid: uid,
      };
    };

    const changes: Array<AccountChange> = getAttackAccountChanges({
      matches: null,
      keptEvents: [
        groupAdded("123456789012", "2026-11-17T19:30:00.000Z", "a"),
        groupAdded("210987654321", "2026-11-17T19:31:00.000Z", "b"),
        groupAdded("123456789012", "2026-11-17T19:32:00.000Z", "c"),
      ],
    });

    expect(
      changes.map((item: AccountChange): [string, string] => {
        return [item.cloudAccountId, item.eventUid];
      }),
    ).toEqual([
      ["123456789012", "a"],
      ["210987654321", "b"],
    ]);
  });

  test("an identity product's change names no cloud account or connection", () => {
    const okta: AccountChange | null = readAccountChange(
      event({
        productName: "Okta System Log",
        attributes: {
          eventType: "user.lifecycle.create",
          "outcome.result": "SUCCESS",
          "target.0.id": "00u1",
          "target.0.type": "User",
          "target.0.alternateId": "new@acme.com",
        },
      }),
    );

    expect(okta).toMatchObject({ cloudAccountId: "", cloudConnectionId: "" });
  });

  test("a refused call, another service's and a read are no change", () => {
    expect(
      readAccountChange(
        cloudTrail("CreateAccessKey", {
          "requestParameters.userName": "deploy-bot",
          errorCode: "AccessDenied",
        }),
      ),
    ).toBeNull();
    expect(
      readAccountChange(
        event({
          attributes: {
            eventSource: "s3.amazonaws.com",
            eventName: "CreateAccessKey",
          },
        }),
      ),
    ).toBeNull();
    expect(
      readAccountChange(
        cloudTrail("ListAccessKeys", { "requestParameters.userName": "a" }),
      ),
    ).toBeNull();
  });
});

describe("a case's changes", () => {
  function matches(
    events: Array<SecurityCaseEventSnapshot>,
  ): SecurityCaseMatchesJson {
    return {
      detections: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          source: "Detection Rule",
          title: "Admin role granted",
          severity: "High",
          groupValue: "alice@acme.com",
          ruleName: "Admin role granted",
          eventCount: events.length,
          fireCount: 1,
          firstSeenAt: null,
          lastSeenAt: null,
          sampleMessage: "",
          isOpening: true,
          rule: null,
          threatIntelFeedId: "",
          securityEventConnectionId: "",
          basis: SecurityCaseMatchBasis.RuleCondition,
          windowStart: null,
          windowEnd: null,
          events,
          isKept: true,
          keptPastRetentionCount: 0,
          hiddenEventCount: 0,
          matchedEventCount: events.length,
          outcomes: {},
        },
      ],
      detectionCount: 1,
      unreadableSources: [],
      failedSources: [],
    };
  }

  const group: SecurityCaseEventSnapshot = okta("group.user_membership.add", [
    OKTA_ALICE,
    { id: "00g1admins", type: "UserGroup", displayName: "Admins" },
  ]);

  test("the matched events and the kept ones, each change once, oldest first", () => {
    const later: SecurityCaseEventSnapshot = {
      ...group,
      eventUid: "event-2",
      time: "2026-11-17T20:00:00.000Z",
    };
    const factor: SecurityCaseEventSnapshot = {
      ...okta("user.mfa.factor.activate", [
        OKTA_ALICE,
        { id: "pfd1factor", type: "AuthenticatorEnrollment" },
      ]),
      eventUid: "event-3",
      time: "2026-11-17T19:00:00.000Z",
    };
    const changes: Array<AccountChange> = getAttackAccountChanges({
      matches: matches([later, group]),
      keptEvents: [factor],
    });

    expect(
      changes.map((change: AccountChange): [string, string] => {
        return [change.kind, change.eventUid];
      }),
    ).toEqual([
      [AccountChangeKind.MfaDevice, "event-3"],
      [AccountChangeKind.Group, "event-1"],
    ]);
  });

  test("none from a case whose events record no change, or that has no detections", () => {
    expect(
      getAttackAccountChanges({
        matches: matches([okta("user.session.start", [OKTA_ALICE])]),
      }),
    ).toEqual([]);
    expect(getAttackAccountChanges({ matches: null })).toEqual([]);
  });

  test("at most so many: each is a product's read", () => {
    const many: Array<SecurityCaseEventSnapshot> = [];

    for (let index: number = 0; index < ACCOUNT_CHANGES_MAX + 5; index++) {
      many.push({
        ...okta("group.user_membership.add", [
          OKTA_ALICE,
          {
            id: `00g${index}`,
            type: "UserGroup",
            displayName: `Group ${index}`,
          },
        ]),
        eventUid: `event-${index}`,
      });
    }

    expect(getAttackAccountChanges({ matches: matches(many) }).length).toBe(
      ACCOUNT_CHANGES_MAX,
    );
  });
});

// ---------- AWS CloudTrail: a role's calls (#11038) ----------

describe("AWS CloudTrail's IAM role calls (#11038)", () => {
  // A trust policy an attack set: its own account let in.
  const BACKDOOR_TRUST: string =
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::444455556666:root"},"Action":"sts:AssumeRole"}]}';

  test("a backdoor role, a role made to trust someone else and a role given more power are each a change - before #11038 the step never listed them", () => {
    const read: Array<{ eventName: string; read: boolean }> = [];

    for (const [eventName, fields] of [
      [
        "CreateRole",
        {
          "requestParameters.roleName": "backdoor",
          "responseElements.role.roleId": "AROA6ON6E4XEFFEXAMPLE",
        },
      ],
      [
        "UpdateAssumeRolePolicy",
        {
          "requestParameters.roleName": "Deploy",
          "requestParameters.policyDocument": BACKDOOR_TRUST,
        },
      ],
      [
        "AttachRolePolicy",
        {
          "requestParameters.roleName": "Deploy",
          "requestParameters.policyArn":
            "arn:aws:iam::aws:policy/AdministratorAccess",
        },
      ],
      [
        "PutRolePolicy",
        {
          "requestParameters.roleName": "Deploy",
          "requestParameters.policyName": "escalate",
        },
      ],
    ] as Array<[string, Record<string, string>]>) {
      read.push({
        eventName,
        read: readAccountChange(cloudTrail(eventName, fields)) !== null,
      });
    }

    expect(read).toEqual([
      { eventName: "CreateRole", read: true },
      { eventName: "UpdateAssumeRolePolicy", read: true },
      { eventName: "AttachRolePolicy", read: true },
      { eventName: "PutRolePolicy", read: true },
    ]);
  });

  test("a case of AWS's own recorded role calls lists each as a change to its role - before #11038 it listed none", () => {
    expect(
      getAttackAccountChanges({
        matches: null,
        keptEvents: [
          CREATE_ROLE_RECORD,
          UPDATE_ASSUME_ROLE_POLICY_RECORD,
          ATTACH_ROLE_POLICY_RECORD,
          PUT_ROLE_POLICY_RECORD,
        ].map(readRecordedEvent),
      }).map((change: AccountChange): [string, string, string] => {
        return [change.eventName, change.account, change.cloudAccountId];
      }),
    ).toEqual([
      ["CreateRole", "TestRole", RECORDED_ACCOUNT],
      ["UpdateAssumeRolePolicy", "S3AccessForEC2Instances", RECORDED_ACCOUNT],
      ["AttachRolePolicy", "ReadOnlyRole", RECORDED_ACCOUNT],
      ["PutRolePolicy", "S3Access", RECORDED_ACCOUNT],
    ]);
  });

  test.each([
    [
      "CreateRole",
      {
        "requestParameters.roleName": "backdoor",
        "responseElements.role.roleId": "AROA6ON6E4XEFFEXAMPLE",
      },
      {
        kind: AccountChangeKind.Account,
        account: "backdoor",
        accountId: "AROA6ON6E4XEFFEXAMPLE",
        objectId: "",
        objectName: "",
        trustPolicies: [],
      },
    ],
    [
      "UpdateAssumeRolePolicy",
      {
        "requestParameters.roleName": "Deploy",
        "requestParameters.policyDocument": BACKDOOR_TRUST,
      },
      {
        kind: AccountChangeKind.Trust,
        account: "Deploy",
        accountId: "",
        objectId: "",
        objectName: "",
        trustPolicies: [BACKDOOR_TRUST],
      },
    ],
    [
      "AttachRolePolicy",
      {
        "requestParameters.roleName": "Deploy",
        "requestParameters.policyArn":
          "arn:aws:iam::aws:policy/AdministratorAccess",
      },
      {
        kind: AccountChangeKind.Policy,
        account: "Deploy",
        accountId: "",
        objectId: "arn:aws:iam::aws:policy/AdministratorAccess",
        objectName: "AdministratorAccess",
        trustPolicies: [],
      },
    ],
    [
      "PutRolePolicy",
      {
        "requestParameters.roleName": "Deploy",
        "requestParameters.policyName": "escalate",
        "requestParameters.policyDocument":
          '{"Version":"2012-10-17","Statement":{"Effect":"Allow","Action":"*","Resource":"*"}}',
      },
      {
        kind: AccountChangeKind.Policy,
        account: "Deploy",
        accountId: "",
        objectId: "",
        objectName: "escalate",
        trustPolicies: [],
      },
    ],
  ])(
    "%s: a change to the role, by what it gave",
    (
      eventName: string,
      fields: Record<string, string>,
      expected: Partial<AccountChange>,
    ) => {
      expect(
        readAccountChange(
          cloudTrail(eventName, {
            recipientAccountId: "123456789012",
            ...fields,
          }),
        ),
      ).toEqual({
        provider: AccountChangeProvider.Aws,
        subject: AccountChangeSubject.Role,
        detailId: "",
        ownerType: "",
        cloudAccountId: "123456789012",
        cloudConnectionId: "",
        eventName,
        eventUid: "event-1",
        time: "2026-11-17T19:30:00.000Z",
        ...expected,
      });
    },
  );

  test("every role call the step reads, and nothing else of a role's", () => {
    expect(AWS_IAM_ROLE_CHANGES).toEqual({
      CreateRole: AccountChangeKind.Account,
      UpdateAssumeRolePolicy: AccountChangeKind.Trust,
      AttachRolePolicy: AccountChangeKind.Policy,
      PutRolePolicy: AccountChangeKind.Policy,
    });
    expect(ACCOUNT_CHANGE_KINDS).toContain(AccountChangeKind.Trust);

    for (const eventName of [
      "GetRole",
      "ListRolePolicies",
      "DeleteRole",
      "DetachRolePolicy",
      "DeleteRolePolicy",
      "TagRole",
      "UpdateRole",
    ]) {
      expect({
        eventName,
        change: readAccountChange(
          cloudTrail(eventName, { "requestParameters.roleName": "Deploy" }),
        ),
      }).toEqual({ eventName, change: null });
    }
  });

  test("a role's change is the role's the call names, never the caller's: a call that names none is no change", () => {
    expect(
      readAccountChange(
        cloudTrail("AttachRolePolicy", {
          "userIdentity.userName": "attacker",
          "requestParameters.policyArn":
            "arn:aws:iam::aws:policy/AdministratorAccess",
        }),
      ),
    ).toBeNull();
    expect(
      readAccountChange(
        cloudTrail("AttachRolePolicy", {
          "userIdentity.userName": "attacker",
          "requestParameters.roleName": "Deploy",
          "requestParameters.policyArn":
            "arn:aws:iam::aws:policy/AdministratorAccess",
        }),
      )?.account,
    ).toBe("Deploy");
  });

  test("a refused role call gave nothing", () => {
    expect(
      readAccountChange(
        cloudTrail("UpdateAssumeRolePolicy", {
          "requestParameters.roleName": "Deploy",
          "requestParameters.policyDocument": BACKDOOR_TRUST,
          errorCode: "AccessDenied",
        }),
      ),
    ).toBeNull();
  });

  test("the account it was made in and the connection that read it, as for a user's", () => {
    expect(
      readAccountChange(
        cloudTrail("CreateRole", {
          "requestParameters.roleName": "backdoor",
          [CLOUD_AUDIT_ACCOUNT_ATTRIBUTE]: "210987654321",
          [CLOUD_AUDIT_CONNECTION_ATTRIBUTE]:
            "5d0c2a7e-0000-4000-8000-00000000c0de",
        }),
      ),
    ).toMatchObject({
      cloudAccountId: "210987654321",
      cloudConnectionId: "5d0c2a7e-0000-4000-8000-00000000c0de",
    });
  });

  test("a user's change still has an account as its subject, and no trust policy", () => {
    expect(
      readAccountChange(
        cloudTrail("AttachUserPolicy", {
          "requestParameters.userName": "Deploy",
          "requestParameters.policyArn":
            "arn:aws:iam::aws:policy/AdministratorAccess",
        }),
      ),
    ).toMatchObject({
      subject: AccountChangeSubject.Account,
      kind: AccountChangeKind.Policy,
      account: "Deploy",
      trustPolicies: [],
    });
  });

  test("a user and a role of one name, given the same policy, are two changes", () => {
    const given: (
      eventName: string,
      field: string,
      uid: string,
    ) => SecurityCaseEventSnapshot = (
      eventName: string,
      field: string,
      uid: string,
    ): SecurityCaseEventSnapshot => {
      return {
        ...cloudTrail(eventName, {
          [field]: "Deploy",
          "requestParameters.policyArn":
            "arn:aws:iam::aws:policy/AdministratorAccess",
          recipientAccountId: "123456789012",
        }),
        eventUid: uid,
      };
    };

    expect(
      getAttackAccountChanges({
        matches: null,
        keptEvents: [
          given("AttachUserPolicy", "requestParameters.userName", "a"),
          given("AttachRolePolicy", "requestParameters.roleName", "b"),
          given("AttachRolePolicy", "requestParameters.roleName", "c"),
        ],
      }).map((change: AccountChange): [string, string] => {
        return [change.subject, change.eventUid];
      }),
    ).toEqual([
      [AccountChangeSubject.Account, "a"],
      [AccountChangeSubject.Role, "b"],
    ]);
  });

  test("a role's trust policy set more than once is one change keeping each policy once, oldest first - and the last the attack set, last", () => {
    const set: (
      policy: string,
      time: string,
      uid: string,
    ) => SecurityCaseEventSnapshot = (
      policy: string,
      time: string,
      uid: string,
    ): SecurityCaseEventSnapshot => {
      return {
        ...cloudTrail("UpdateAssumeRolePolicy", {
          "requestParameters.roleName": "Deploy",
          "requestParameters.policyDocument": policy,
          recipientAccountId: "123456789012",
        }),
        time,
        eventUid: uid,
      };
    };
    const first: string = BACKDOOR_TRUST;
    const second: string = BACKDOOR_TRUST.split("444455556666").join(
      "555555555555",
    );

    const changes: Array<AccountChange> = getAttackAccountChanges({
      matches: null,
      // Out of order, as a case's events may be; and the first set again last.
      keptEvents: [
        set(second, "2026-11-17T19:31:00.000Z", "b"),
        set(first, "2026-11-17T19:30:00.000Z", "a"),
        set(first, "2026-11-17T19:32:00.000Z", "c"),
      ],
    });

    expect(changes).toHaveLength(1);
    // The change is the first event's; its policies, each where it was set last.
    expect(changes[0]).toMatchObject({
      kind: AccountChangeKind.Trust,
      eventUid: "a",
      trustPolicies: [second, first],
    });
  });

  test("a trust policy the event recorded nothing of keeps none", () => {
    expect(
      readAccountChange(
        cloudTrail("UpdateAssumeRolePolicy", {
          "requestParameters.roleName": "Deploy",
        }),
      )?.trustPolicies,
    ).toEqual([]);
  });
});
