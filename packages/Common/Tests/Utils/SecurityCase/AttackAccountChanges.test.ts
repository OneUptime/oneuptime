import { describe, expect, test } from "@jest/globals";
import { SecurityCaseEventSnapshot } from "../../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchesJson,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import {
  ACCOUNT_CHANGES_MAX,
  AccountChange,
  AccountChangeKind,
  AccountChangeProvider,
  getAttackAccountChanges,
  readAccountChange,
  readEntraKeyIdentifier,
  readEntraPropertyValue,
} from "../../../Utils/SecurityCase/AttackAccountChanges";

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
    ],
    [
      "AttachUserPolicy",
      {
        "requestParameters.userName": "deploy-bot",
        "requestParameters.policyArn":
          "arn:aws:iam::aws:policy/AdministratorAccess",
      },
      AccountChangeKind.AdminRole,
      "arn:aws:iam::aws:policy/AdministratorAccess",
    ],
    [
      "AddUserToGroup",
      {
        "requestParameters.userName": "deploy-bot",
        "requestParameters.groupName": "Admins",
      },
      AccountChangeKind.Group,
      "Admins",
    ],
    [
      "CreateLoginProfile",
      { "requestParameters.userName": "deploy-bot" },
      AccountChangeKind.Key,
      "console password",
    ],
    [
      "CreateUser",
      { "requestParameters.userName": "backup-admin" },
      AccountChangeKind.Account,
      "",
    ],
  ])(
    "%s",
    (
      eventName: string,
      fields: Record<string, string>,
      kind: AccountChangeKind,
      objectName: string,
    ) => {
      expect(readAccountChange(cloudTrail(eventName, fields))).toMatchObject({
        provider: AccountChangeProvider.Aws,
        kind,
        objectName,
      });
    },
  );

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
