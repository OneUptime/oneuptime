import SecurityCaseEvidence from "../../../../Models/DatabaseModels/SecurityCaseEvidence";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import SecurityCaseEvidenceService from "../../../../Server/Services/SecurityCaseEvidenceService";
import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import AccountChangesState, {
  AccountChangesReading,
} from "../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AccountChangesState";
import { SecurityConnectorSettings } from "../../../../Server/Utils/SecurityEvent/Connectors/Types";
import { GOOGLE_WORKSPACE_DIRECTORY_GROUP_MEMBER_SCOPE } from "../../../../Server/Utils/SecurityEvent/Response/GoogleWorkspaceResponseClient";
import AccountChangeReadBack, {
  ACCOUNT_CHANGE_CONNECTION_PROVIDERS,
  AccountChangeFacts,
  AccountChangeState,
  AccountChangeUnknownReason,
  ENTRA_ID_METHOD_ADDED_LEEWAY_MS,
} from "../../../../Server/Utils/SecurityPlaybook/AccountChangeReadBack";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  AccountChange,
  AccountChangeKind,
  AccountChangeProvider,
} from "../../../../Utils/SecurityCase/AttackAccountChanges";
import {
  FAKE_ADMIN_EMAIL,
  FAKE_SERVICE_ACCOUNT_JSON,
  FAKE_TOKEN_URI,
} from "../SecurityEvent/Connectors/GoogleWorkspace/GoogleWorkspaceFakeApi";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * Whether a change an attack made to an account is still there (#10603),
 * read back from the product it was made in through its own API - and
 * never changing anything. Each product is a fake of its API that answers
 * reads only, route by route: anything but a GET fails the test.
 */

type Transport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

function respond(statusCode: number, body: unknown): DataSourceHttpResponse {
  return { statusCode, bodyText: JSON.stringify(body ?? ""), bodyJson: body };
}

const NOT_FOUND: DataSourceHttpResponse = respond(404, {
  errorCode: "E0000007",
  errorSummary: "Not found: Resource not found",
});

// A product's API: each GET answered by the first route whose path it matches.
function api(
  routes: Array<[RegExp, (url: URL) => DataSourceHttpResponse]>,
  requests: Array<DataSourceHttpRequest> = [],
): Transport {
  return async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    requests.push(request);

    if (request.url === FAKE_TOKEN_URI || request.url.includes("oauth2")) {
      return respond(200, { access_token: "token", expires_in: 3599 });
    }

    if (request.method !== "GET") {
      throw new Error(`a read-back must not ${request.method} ${request.url}`);
    }

    const url: URL = new URL(request.url);

    for (const [path, answer] of routes) {
      if (path.test(url.pathname)) {
        return answer(url);
      }
    }

    return NOT_FOUND;
  };
}

function change(data: Partial<AccountChange>): AccountChange {
  return {
    provider: AccountChangeProvider.Okta,
    kind: AccountChangeKind.Group,
    account: "alice@acme.com",
    accountId: "",
    objectId: "",
    objectName: "",
    detailId: "",
    ownerType: "",
    cloudAccountId: "",
    cloudConnectionId: "",
    eventName: "",
    eventUid: "event-1",
    time: "2026-11-17T19:30:00.000Z",
    ...data,
  };
}

const OKTA_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.OktaSystemLog,
  config: { orgUrl: "https://acme.okta.com" },
  secrets: { apiToken: "00okta-token" },
  alertingOnly: false,
};

const ENTRA_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.MicrosoftEntraId,
  config: {
    tenantId: "contoso.onmicrosoft.com",
    clientId: "2f1c7a3e-0000-4000-8000-000000000001",
    cloud: "public",
  },
  secrets: { clientSecret: "s" },
  alertingOnly: false,
};

const GOOGLE_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.GoogleWorkspace,
  config: { adminEmail: FAKE_ADMIN_EMAIL },
  secrets: { serviceAccountJson: FAKE_SERVICE_ACCOUNT_JSON },
  alertingOnly: false,
};

async function read(
  settings: SecurityConnectorSettings,
  data: Partial<AccountChange>,
  transport: Transport,
): Promise<AccountChangeFacts | null> {
  return await AccountChangeReadBack.read({
    provider: settings.provider,
    settings,
    change: change(data),
    transport,
  });
}

async function caught(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the call to throw.");
}

// ---------- Okta ----------

describe("Okta", () => {
  const ALICE: JSONObject = {
    id: "00u1alice",
    status: "ACTIVE",
    profile: { login: "alice@acme.com" },
  };

  function okta(data: {
    user?: JSONObject | null;
    groups?: Array<JSONObject>;
    roles?: Array<JSONObject>;
    factors?: Array<JSONObject>;
    assignedApps?: Array<string>;
    apiTokens?: Array<string>;
    refuse?: number;
    requests?: Array<DataSourceHttpRequest>;
  }): Transport {
    const user: JSONObject | null = data.user === undefined ? ALICE : data.user;

    return api(
      [
        [
          /\/api\/v1\/users\/[^/]+\/groups$/,
          (): DataSourceHttpResponse => {
            return data.refuse
              ? respond(data.refuse, {
                  errorSummary: "You do not have permission",
                })
              : respond(200, data.groups || []);
          },
        ],
        [
          /\/api\/v1\/users\/[^/]+\/roles$/,
          (): DataSourceHttpResponse => {
            return respond(200, data.roles || []);
          },
        ],
        [
          /\/api\/v1\/users\/[^/]+\/factors$/,
          (): DataSourceHttpResponse => {
            return respond(200, data.factors || []);
          },
        ],
        [
          /\/api\/v1\/apps\/([^/]+)\/users\/[^/]+$/,
          (url: URL): DataSourceHttpResponse => {
            const app: string = url.pathname.split("/")[4] || "";

            return (data.assignedApps || []).includes(app)
              ? respond(200, { id: user?.["id"] })
              : NOT_FOUND;
          },
        ],
        [
          /\/api\/v1\/api-tokens\/([^/]+)$/,
          (url: URL): DataSourceHttpResponse => {
            const token: string = url.pathname.split("/").pop() || "";

            return (data.apiTokens || []).includes(token)
              ? respond(200, { id: token })
              : NOT_FOUND;
          },
        ],
        [
          /\/api\/v1\/users\/[^/]+$/,
          (url: URL): DataSourceHttpResponse => {
            const key: string = decodeURIComponent(
              url.pathname.split("/").pop() || "",
            );

            return user &&
              (key === user["id"] ||
                key === (user["profile"] as JSONObject)["login"])
              ? respond(200, user)
              : NOT_FOUND;
          },
        ],
      ],
      data.requests,
    );
  }

  test("a group: still there while the user's groups hold it, undone once they do not", async () => {
    const group: Partial<AccountChange> = {
      kind: AccountChangeKind.Group,
      accountId: "00u1alice",
      objectId: "00g1admins",
      objectName: "Admins",
    };
    const requests: Array<DataSourceHttpRequest> = [];

    expect(
      await read(
        OKTA_SETTINGS,
        group,
        okta({
          groups: [{ id: "00g1admins", profile: { name: "Admins" } }],
          requests,
        }),
      ),
    ).toEqual({
      provider: "Okta",
      state: AccountChangeState.StillThere,
      url: "https://acme-admin.okta.com/admin/user/profile/view/00u1alice",
    });
    expect(
      (await read(OKTA_SETTINGS, group, okta({ groups: [] })))?.state,
    ).toBe(AccountChangeState.Undone);
    // Read with the connection's own token, read-only.
    expect(requests[0]!.headers?.["Authorization"]).toBe("SSWS 00okta-token");
  });

  test("a group named but given no id is matched by its name; one named by nothing is not looked for", async () => {
    expect(
      (
        await read(
          OKTA_SETTINGS,
          { kind: AccountChangeKind.Group, objectName: "admins" },
          okta({ groups: [{ id: "00g1", profile: { name: "Admins" } }] }),
        )
      )?.state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      await read(OKTA_SETTINGS, { kind: AccountChangeKind.Group }, okta({})),
    ).toMatchObject({
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.NotNamed,
    });
  });

  test("an admin role: undone with none left, still there by its label, and no guess when others remain", async () => {
    const role: Partial<AccountChange> = {
      kind: AccountChangeKind.AdminRole,
      objectName: "Super administrator",
    };

    expect((await read(OKTA_SETTINGS, role, okta({ roles: [] })))?.state).toBe(
      AccountChangeState.Undone,
    );
    expect(
      (
        await read(
          OKTA_SETTINGS,
          role,
          okta({
            roles: [
              { id: "r1", type: "SUPER_ADMIN", label: "Super Administrator" },
            ],
          }),
        )
      )?.state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      await read(
        OKTA_SETTINGS,
        role,
        okta({
          roles: [
            {
              id: "r2",
              type: "HELP_DESK_ADMIN",
              label: "Help Desk Administrator",
            },
          ],
        }),
      ),
    ).toMatchObject({
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.CannotTellWhich,
      holding: ["Help Desk Administrator"],
    });
  });

  test("a factor: by the enrollment the event names; without one, undone only when no factor is active", async () => {
    const factor: Partial<AccountChange> = {
      kind: AccountChangeKind.MfaDevice,
      objectId: "pfd1attacker",
    };

    expect(
      (
        await read(
          OKTA_SETTINGS,
          factor,
          okta({ factors: [{ id: "pfd1attacker", status: "ACTIVE" }] }),
        )
      )?.state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      (
        await read(
          OKTA_SETTINGS,
          factor,
          okta({
            factors: [
              { id: "pfd1attacker", status: "PENDING_ACTIVATION" },
              { id: "pfd1owner", status: "ACTIVE" },
            ],
          }),
        )
      )?.state,
    ).toBe(AccountChangeState.Undone);
    expect(
      (
        await read(
          OKTA_SETTINGS,
          { kind: AccountChangeKind.MfaDevice },
          okta({ factors: [] }),
        )
      )?.state,
    ).toBe(AccountChangeState.Undone);
    expect(
      await read(
        OKTA_SETTINGS,
        { kind: AccountChangeKind.MfaDevice },
        okta({
          factors: [
            {
              id: "pfd1owner",
              status: "ACTIVE",
              factorType: "push",
              profile: { name: "iPhone" },
            },
          ],
        }),
      ),
    ).toMatchObject({
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.CannotTellWhich,
      holding: ["iPhone"],
    });
  });

  test("an app and an API token: still there while Okta answers, undone once it answers 404", async () => {
    expect(
      (
        await read(
          OKTA_SETTINGS,
          { kind: AccountChangeKind.App, objectId: "0oa1app" },
          okta({ assignedApps: ["0oa1app"] }),
        )
      )?.state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      (
        await read(
          OKTA_SETTINGS,
          { kind: AccountChangeKind.App, objectId: "0oa1app" },
          okta({}),
        )
      )?.state,
    ).toBe(AccountChangeState.Undone);
    expect(
      (
        await read(
          OKTA_SETTINGS,
          { kind: AccountChangeKind.Key, objectId: "00T1token" },
          okta({ apiTokens: ["00T1token"] }),
        )
      )?.state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      (
        await read(
          OKTA_SETTINGS,
          { kind: AccountChangeKind.Key, objectId: "00T1token" },
          okta({}),
        )
      )?.state,
    ).toBe(AccountChangeState.Undone);
  });

  test("an account the attack made: undone once deactivated or suspended", async () => {
    for (const [status, state] of [
      ["ACTIVE", AccountChangeState.StillThere],
      ["DEPROVISIONED", AccountChangeState.Undone],
      ["SUSPENDED", AccountChangeState.Undone],
    ] as Array<[string, AccountChangeState]>) {
      expect(
        (
          await read(
            OKTA_SETTINGS,
            { kind: AccountChangeKind.Account },
            okta({ user: { ...ALICE, status } }),
          )
        )?.state,
      ).toBe(state);
    }
  });

  test("an account gone by the id the event named is undone, all it held with it; a name nobody has is not this org's", async () => {
    expect(
      await read(
        OKTA_SETTINGS,
        {
          kind: AccountChangeKind.Group,
          accountId: "00u1gone",
          objectId: "00g1",
        },
        okta({ user: null }),
      ),
    ).toEqual({
      provider: "Okta",
      state: AccountChangeState.Undone,
      isAccountGone: true,
    });
    expect(
      await read(
        OKTA_SETTINGS,
        { kind: AccountChangeKind.Group, objectId: "00g1" },
        okta({ user: null }),
      ),
    ).toBeNull();
  });

  test("a refusal is thrown with what the token cannot read, never taken as undone", async () => {
    expect(
      (
        await caught(
          read(
            OKTA_SETTINGS,
            { kind: AccountChangeKind.Group, objectId: "00g1" },
            okta({ refuse: 403 }),
          ),
        )
      ).message,
    ).toContain("cannot read this user's groups");
  });
});

// ---------- Microsoft Entra ID ----------

describe("Microsoft Entra ID", () => {
  const ALICE_ID: string = "11111111-aaaa-4aaa-8aaa-111111111111";
  const ALICE: JSONObject = {
    id: ALICE_ID,
    userPrincipalName: "alice@contoso.com",
    accountEnabled: true,
  };
  const ROLE_TEMPLATE: string = "62e90394-69f5-4237-9190-012177145e10";
  const CHANGED_AT: string = "2026-11-17T19:30:00.000Z";

  function entra(data: {
    user?: JSONObject | null;
    roles?: Array<JSONObject>;
    groups?: Array<JSONObject>;
    assignments?: Array<JSONObject>;
    methods?: Array<JSONObject>;
    app?: JSONObject | null;
  }): Transport {
    const user: JSONObject | null = data.user === undefined ? ALICE : data.user;

    return api([
      [
        /\/memberOf\/microsoft\.graph\.directoryRole$/,
        (): DataSourceHttpResponse => {
          return respond(200, { value: data.roles || [] });
        },
      ],
      [
        /\/memberOf\/microsoft\.graph\.group$/,
        (): DataSourceHttpResponse => {
          return respond(200, { value: data.groups || [] });
        },
      ],
      [
        /\/appRoleAssignments$/,
        (): DataSourceHttpResponse => {
          return respond(200, { value: data.assignments || [] });
        },
      ],
      [
        /\/authentication\/methods$/,
        (): DataSourceHttpResponse => {
          return respond(200, { value: data.methods || [] });
        },
      ],
      [
        /\/v1\.0\/(applications|servicePrincipals)\/[^/]+$/,
        (): DataSourceHttpResponse => {
          return data.app
            ? respond(200, data.app)
            : respond(404, { error: { code: "Request_ResourceNotFound" } });
        },
      ],
      [
        /\/v1\.0\/users\/[^/]+$/,
        (url: URL): DataSourceHttpResponse => {
          const key: string = decodeURIComponent(
            url.pathname.split("/").pop() || "",
          );

          return user &&
            (key === user["id"] || key === user["userPrincipalName"])
            ? respond(200, user)
            : respond(404, { error: { code: "Request_ResourceNotFound" } });
        },
      ],
    ]);
  }

  test("a directory role: known by its template, still there while the account holds it", async () => {
    const role: Partial<AccountChange> = {
      provider: AccountChangeProvider.EntraId,
      kind: AccountChangeKind.AdminRole,
      account: "alice@contoso.com",
      accountId: ALICE_ID,
      objectId: ROLE_TEMPLATE,
      objectName: "Global Administrator",
    };

    expect(
      await read(
        ENTRA_SETTINGS,
        role,
        entra({
          roles: [
            {
              id: "aaaaaaaa-0000-4000-8000-000000000001",
              roleTemplateId: ROLE_TEMPLATE,
              displayName: "Global Administrator",
            },
          ],
        }),
      ),
    ).toMatchObject({
      provider: "Microsoft Entra ID",
      state: AccountChangeState.StillThere,
      url: `https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/${ALICE_ID}`,
    });
    expect(
      (await read(ENTRA_SETTINGS, role, entra({ roles: [] })))?.state,
    ).toBe(AccountChangeState.Undone);
  });

  test("a group, and an app role: by the app and, when the audit names it, the role", async () => {
    expect(
      (
        await read(
          ENTRA_SETTINGS,
          {
            provider: AccountChangeProvider.EntraId,
            kind: AccountChangeKind.Group,
            accountId: ALICE_ID,
            objectId: "22222222-bbbb-4bbb-8bbb-222222222222",
          },
          entra({
            groups: [{ id: "22222222-BBBB-4BBB-8BBB-222222222222" }],
          }),
        )
      )?.state,
    ).toBe(AccountChangeState.StillThere);

    const appRole: Partial<AccountChange> = {
      provider: AccountChangeProvider.EntraId,
      kind: AccountChangeKind.App,
      accountId: ALICE_ID,
      objectId: "33333333-cccc-4ccc-8ccc-333333333333",
      detailId: "44444444-dddd-4ddd-8ddd-444444444444",
    };

    expect(
      (
        await read(
          ENTRA_SETTINGS,
          appRole,
          entra({
            assignments: [
              {
                resourceId: "33333333-cccc-4ccc-8ccc-333333333333",
                appRoleId: "44444444-dddd-4ddd-8ddd-444444444444",
              },
            ],
          }),
        )
      )?.state,
    ).toBe(AccountChangeState.StillThere);
    // Another role of the same app is not the one the attack gave.
    expect(
      (
        await read(
          ENTRA_SETTINGS,
          appRole,
          entra({
            assignments: [
              {
                resourceId: "33333333-cccc-4ccc-8ccc-333333333333",
                appRoleId: "00000000-0000-0000-0000-000000000000",
              },
            ],
          }),
        )
      )?.state,
    ).toBe(AccountChangeState.Undone);
  });

  test("security info: a method added at the audit's time or since is still there; undated ones leave it to a person", async () => {
    const securityInfo: Partial<AccountChange> = {
      provider: AccountChangeProvider.EntraId,
      kind: AccountChangeKind.MfaDevice,
      accountId: ALICE_ID,
      time: CHANGED_AT,
    };
    const added: string = new Date(
      Date.parse(CHANGED_AT) - ENTRA_ID_METHOD_ADDED_LEEWAY_MS / 2,
    ).toISOString();

    expect(
      await read(
        ENTRA_SETTINGS,
        securityInfo,
        entra({
          methods: [
            {
              "@odata.type":
                "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod",
              displayName: "Attacker's phone",
              createdDateTime: added,
            },
            {
              "@odata.type": "#microsoft.graph.passwordAuthenticationMethod",
              createdDateTime: "2026-11-18T00:00:00.000Z",
            },
          ],
        }),
      ),
    ).toMatchObject({
      state: AccountChangeState.StillThere,
      holding: ["Attacker's phone"],
    });
    // Only the owner's older methods left: undone.
    expect(
      (
        await read(
          ENTRA_SETTINGS,
          securityInfo,
          entra({
            methods: [
              {
                "@odata.type": "#microsoft.graph.fido2AuthenticationMethod",
                displayName: "YubiKey",
                createdDateTime: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        )
      )?.state,
    ).toBe(AccountChangeState.Undone);
    // A phone Graph gives no date may be the one: a person confirms.
    expect(
      await read(
        ENTRA_SETTINGS,
        securityInfo,
        entra({
          methods: [
            {
              "@odata.type": "#microsoft.graph.phoneAuthenticationMethod",
              phoneNumber: "+1 555 0100",
            },
          ],
        }),
      ),
    ).toMatchObject({
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.CannotTellWhich,
    });
  });

  test("an app's key: on the app, by its identifier; a deleted app took it with it", async () => {
    const key: Partial<AccountChange> = {
      provider: AccountChangeProvider.EntraId,
      kind: AccountChangeKind.Key,
      account: "Payroll",
      accountId: "66666666-ffff-4fff-8fff-666666666666",
      ownerType: "ServicePrincipal",
      objectId: "55555555-eeee-4eee-8eee-555555555555",
    };

    expect(
      (
        await read(
          ENTRA_SETTINGS,
          key,
          entra({
            app: {
              passwordCredentials: [
                { keyId: "55555555-EEEE-4EEE-8EEE-555555555555" },
              ],
              keyCredentials: [],
            },
          }),
        )
      )?.state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      (
        await read(
          ENTRA_SETTINGS,
          key,
          entra({ app: { passwordCredentials: [], keyCredentials: [] } }),
        )
      )?.state,
    ).toBe(AccountChangeState.Undone);
    expect(await read(ENTRA_SETTINGS, key, entra({ app: null }))).toEqual({
      provider: "Microsoft Entra ID",
      state: AccountChangeState.Undone,
      isAccountGone: true,
    });
  });

  test("an account the attack made: undone once disabled", async () => {
    const account: Partial<AccountChange> = {
      provider: AccountChangeProvider.EntraId,
      kind: AccountChangeKind.Account,
      accountId: ALICE_ID,
    };

    expect((await read(ENTRA_SETTINGS, account, entra({})))?.state).toBe(
      AccountChangeState.StillThere,
    );
    expect(
      (
        await read(
          ENTRA_SETTINGS,
          account,
          entra({ user: { ...ALICE, accountEnabled: false } }),
        )
      )?.state,
    ).toBe(AccountChangeState.Undone);
  });
});

// ---------- Google Workspace ----------

describe("Google Workspace", () => {
  const ALICE: JSONObject = {
    id: "104761234567890123456",
    primaryEmail: "alice@example.com",
    suspended: false,
    isEnrolledIn2Sv: false,
    isAdmin: false,
    isDelegatedAdmin: false,
  };

  function workspace(data: {
    user?: JSONObject | null;
    tokens?: Array<string>;
  }): Transport {
    const user: JSONObject | null = data.user === undefined ? ALICE : data.user;

    return api([
      [
        /\/admin\/directory\/v1\/users\/[^/]+\/tokens\/[^/]+$/,
        (url: URL): DataSourceHttpResponse => {
          const clientId: string = decodeURIComponent(
            url.pathname.split("/").pop() || "",
          );

          return (data.tokens || []).includes(clientId)
            ? respond(200, { clientId })
            : respond(404, { error: { code: 404 } });
        },
      ],
      [
        /\/admin\/directory\/v1\/users\/[^/]+$/,
        (): DataSourceHttpResponse => {
          return user
            ? respond(200, user)
            : respond(404, { error: { code: 404 } });
        },
      ],
    ]);
  }

  const google: (data: Partial<AccountChange>) => Partial<AccountChange> = (
    data: Partial<AccountChange>,
  ): Partial<AccountChange> => {
    return {
      provider: AccountChangeProvider.GoogleWorkspace,
      account: "alice@example.com",
      ...data,
    };
  };

  test("a super admin granted is said for certain; another admin role only once none is left", async () => {
    const superAdmin: Partial<AccountChange> = google({
      kind: AccountChangeKind.AdminRole,
      objectId: "SUPER_ADMIN",
    });

    expect(
      (
        await read(
          GOOGLE_SETTINGS,
          superAdmin,
          workspace({ user: { ...ALICE, isAdmin: true } }),
        )
      )?.state,
    ).toBe(AccountChangeState.StillThere);
    expect(
      (await read(GOOGLE_SETTINGS, superAdmin, workspace({})))?.state,
    ).toBe(AccountChangeState.Undone);

    const role: Partial<AccountChange> = google({
      kind: AccountChangeKind.AdminRole,
      objectName: "Groups Admin",
    });

    expect((await read(GOOGLE_SETTINGS, role, workspace({})))?.state).toBe(
      AccountChangeState.Undone,
    );
    expect(
      await read(
        GOOGLE_SETTINGS,
        role,
        workspace({ user: { ...ALICE, isDelegatedAdmin: true } }),
      ),
    ).toMatchObject({
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.CannotTellWhich,
    });
  });

  test("an app given the account's data: still there while its token is", async () => {
    const app: Partial<AccountChange> = google({
      kind: AccountChangeKind.App,
      objectId: "123.apps.googleusercontent.com",
    });

    expect(
      (
        await read(
          GOOGLE_SETTINGS,
          app,
          workspace({ tokens: ["123.apps.googleusercontent.com"] }),
        )
      )?.state,
    ).toBe(AccountChangeState.StillThere);
    expect((await read(GOOGLE_SETTINGS, app, workspace({})))?.state).toBe(
      AccountChangeState.Undone,
    );
  });

  test("2-Step Verification: undone once off; on, it may be the owner's own", async () => {
    const twoStep: Partial<AccountChange> = google({
      kind: AccountChangeKind.MfaDevice,
    });

    expect((await read(GOOGLE_SETTINGS, twoStep, workspace({})))?.state).toBe(
      AccountChangeState.Undone,
    );
    expect(
      (
        await read(
          GOOGLE_SETTINGS,
          twoStep,
          workspace({ user: { ...ALICE, isEnrolledIn2Sv: true } }),
        )
      )?.state,
    ).toBe(AccountChangeState.Unknown);
  });

  /*
   * A group an attack added the account to (#10901): one membership, read
   * with the group member scope a connection set up before it was asked
   * for may not have.
   */
  describe("a group", () => {
    const group: Partial<AccountChange> = google({
      kind: AccountChangeKind.Group,
      objectName: "finance@acme.com",
    });

    // The scope each token is minted for, from the assertion it is asked with.
    function scopeOf(request: DataSourceHttpRequest): string {
      const assertion: string = String(
        (request.body as Record<string, string> | undefined)?.["assertion"] ||
          "",
      );
      const payload: string = assertion.split(".")[1] || "";

      return String(
        (
          JSON.parse(
            Buffer.from(payload, "base64url").toString("utf8") || "{}",
          ) as Record<string, unknown>
        )["scope"] || "",
      );
    }

    /*
     * Workspace with groups, each by its address and the ids of its own
     * members; a delegation that may refuse the group member scope, and a
     * members read that may answer otherwise.
     */
    function withGroups(data: {
      groups?: Record<string, Array<string>>;
      refusesGroupScope?: boolean;
      membersStatus?: number;
      requests?: Array<DataSourceHttpRequest>;
    }): Transport {
      const users: Transport = workspace({});

      return async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        data.requests?.push(request);

        if (request.url === FAKE_TOKEN_URI) {
          return data.refusesGroupScope &&
            scopeOf(request) === GOOGLE_WORKSPACE_DIRECTORY_GROUP_MEMBER_SCOPE
            ? respond(401, {
                error: "unauthorized_client",
                error_description:
                  "Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.",
              })
            : respond(200, { access_token: "token", expires_in: 3599 });
        }

        const match: RegExpMatchArray | null = new URL(
          request.url,
        ).pathname.match(
          /\/admin\/directory\/v1\/groups\/([^/]+)\/members\/([^/]+)$/,
        );

        if (!match) {
          return await users(request);
        }

        if (request.method !== "GET") {
          throw new Error(`a read-back must not ${request.method} a group`);
        }

        if (data.membersStatus) {
          return respond(data.membersStatus, {
            error: {
              code: data.membersStatus,
              message: "Not Authorized to access this resource/api",
            },
          });
        }

        const members: Array<string> | undefined = (data.groups || {})[
          decodeURIComponent(match[1]!)
        ];

        return members && members.includes(decodeURIComponent(match[2]!))
          ? respond(200, {
              kind: "admin#directory#member",
              id: match[2],
              role: "MEMBER",
              type: "USER",
              status: "ACTIVE",
            })
          : respond(404, {
              error: {
                code: 404,
                message: members
                  ? "Resource Not Found: memberKey"
                  : "Resource Not Found: groupKey",
              },
            });
      };
    }

    test("still there while the group names the account a member of its own", async () => {
      expect(
        await read(
          GOOGLE_SETTINGS,
          group,
          withGroups({
            groups: { "finance@acme.com": [String(ALICE["id"])] },
          }),
        ),
      ).toEqual({
        provider: "Google Workspace",
        state: AccountChangeState.StillThere,
        url: `https://admin.google.com/ac/users/${String(ALICE["id"])}`,
      });
    });

    test("undone once the account is removed, or the group with it", async () => {
      expect(
        (
          await read(
            GOOGLE_SETTINGS,
            group,
            withGroups({ groups: { "finance@acme.com": ["someone-else"] } }),
          )
        )?.state,
      ).toBe(AccountChangeState.Undone);
      expect(
        (await read(GOOGLE_SETTINGS, group, withGroups({ groups: {} })))?.state,
      ).toBe(AccountChangeState.Undone);
    });

    test("reads the one membership, by the account's id, with a token of the group member scope alone", async () => {
      const requests: Array<DataSourceHttpRequest> = [];

      await read(
        GOOGLE_SETTINGS,
        group,
        withGroups({
          groups: { "finance@acme.com": [String(ALICE["id"])] },
          requests,
        }),
      );

      const membership: DataSourceHttpRequest | undefined = requests.find(
        (request: DataSourceHttpRequest): boolean => {
          return request.url.includes("/groups/");
        },
      );

      expect(membership?.url).toBe(
        `https://admin.googleapis.com/admin/directory/v1/groups/finance%40acme.com/members/${String(ALICE["id"])}`,
      );
      expect(
        requests
          .filter((request: DataSourceHttpRequest): boolean => {
            return request.url === FAKE_TOKEN_URI;
          })
          .map(scopeOf),
      ).toContain(GOOGLE_WORKSPACE_DIRECTORY_GROUP_MEMBER_SCOPE);
    });

    test("a delegation without the scope keeps working: the change is a person's to confirm, saying what to grant", async () => {
      expect(
        await read(
          GOOGLE_SETTINGS,
          group,
          withGroups({ refusesGroupScope: true }),
        ),
      ).toEqual({
        provider: "Google Workspace",
        state: AccountChangeState.Unknown,
        reason: AccountChangeUnknownReason.NotGranted,
        url: `https://admin.google.com/ac/users/${String(ALICE["id"])}`,
      });
    });

    test("an administrator Google will not show the group to is not given the read either", async () => {
      expect(
        await read(GOOGLE_SETTINGS, group, withGroups({ membersStatus: 403 })),
      ).toMatchObject({
        state: AccountChangeState.Unknown,
        reason: AccountChangeUnknownReason.NotGranted,
      });
    });

    test("a members read Google fails at is thrown, never taken as undone", async () => {
      await expect(
        read(GOOGLE_SETTINGS, group, withGroups({ membersStatus: 500 })),
      ).rejects.toThrow();
    });

    test("an event that names no group is not looked for", async () => {
      expect(
        await read(
          GOOGLE_SETTINGS,
          { ...group, objectName: "" },
          withGroups({}),
        ),
      ).toMatchObject({
        state: AccountChangeState.Unknown,
        reason: AccountChangeUnknownReason.NotNamed,
      });
    });
  });

  test("an account the attack made: undone once suspended; one Workspace does not know is not this connection's", async () => {
    expect(
      (
        await read(
          GOOGLE_SETTINGS,
          google({ kind: AccountChangeKind.Account }),
          workspace({ user: { ...ALICE, suspended: true } }),
        )
      )?.state,
    ).toBe(AccountChangeState.Undone);
    expect(
      await read(
        GOOGLE_SETTINGS,
        google({ kind: AccountChangeKind.Account }),
        workspace({ user: null }),
      ),
    ).toBeNull();
  });
});

// ---------- Over the project's connections ----------

describe("each change is read in every connection of its product", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function connection(
    provider: SecurityEventConnectorProvider,
  ): SecurityEventConnection {
    const row: SecurityEventConnection = new SecurityEventConnection();
    row.id = ObjectID.generate();
    row.provider = provider;
    return row;
  }

  test("AWS is read through the cloud connections, never a security event connection", () => {
    expect(ACCOUNT_CHANGE_CONNECTION_PROVIDERS[AccountChangeProvider.Aws]).toBe(
      null,
    );
  });

  test("still there in one connection wins; a failure is said; no connection is said", async () => {
    // The project has no AWS cloud connection.
    jest.spyOn(CloudConnectionService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(SecurityEventConnectionService, "findBy")
      .mockResolvedValue([
        connection(SecurityEventConnectorProvider.OktaSystemLog),
        connection(SecurityEventConnectorProvider.OktaSystemLog),
      ]);
    jest
      .spyOn(SecurityEventConnectionService, "getConnectorSettings")
      .mockResolvedValue(OKTA_SETTINGS);

    let calls: number = 0;

    jest
      .spyOn(AccountChangeReadBack, "read")
      .mockImplementation(async (): Promise<AccountChangeFacts | null> => {
        calls++;

        return calls % 2 === 1
          ? { provider: "Okta", state: AccountChangeState.Undone }
          : { provider: "Okta", state: AccountChangeState.StillThere };
      });

    const reading: AccountChangesReading = await AccountChangesState.read({
      projectId: ObjectID.generate(),
      changes: [
        change({ objectId: "00g1" }),
        change({
          provider: AccountChangeProvider.GoogleWorkspace,
          objectName: "finance@acme.com",
        }),
        change({
          provider: AccountChangeProvider.Aws,
          objectName: "AKIA",
          cloudAccountId: "123456789012",
        }),
      ],
    });

    expect(reading.answers[0]!.facts?.state).toBe(
      AccountChangeState.StillThere,
    );
    expect(reading.answers[0]!.hasConnection).toBe(true);
    // No Google Workspace connection, and no connection reads AWS: said, never read.
    expect(reading.answers[1]).toMatchObject({
      facts: null,
      hasConnection: false,
    });
    expect(reading.answers[2]).toMatchObject({
      facts: null,
      hasConnection: false,
    });

    jest
      .spyOn(AccountChangeReadBack, "read")
      .mockRejectedValue(new Error("Okta is down"));

    expect(
      (
        await AccountChangesState.read({
          projectId: ObjectID.generate(),
          changes: [change({ objectId: "00g1" })],
        })
      ).answers[0],
    ).toMatchObject({ facts: null, error: "Okta is down" });
  });

  test("the events kept on the case are read as they were kept", async () => {
    const kept: SecurityCaseEvidence = new SecurityCaseEvidence();
    kept.eventSnapshot = {
      time: "2026-11-17T19:30:00.000Z",
      eventUid: "kept-1",
      productName: "Okta System Log",
      attributes: { eventType: "user.lifecycle.create" },
    } as unknown as JSONObject;
    const findBy: SpyInstance<typeof SecurityCaseEvidenceService.findBy> = jest
      .spyOn(SecurityCaseEvidenceService, "findBy")
      .mockResolvedValue([kept, new SecurityCaseEvidence()]);

    const events: Awaited<
      ReturnType<typeof AccountChangesState.readKeptEvents>
    > = await AccountChangesState.readKeptEvents({
      projectId: ObjectID.generate(),
      securityCaseId: ObjectID.generate(),
    });

    expect(
      events.map((event: { eventUid: string }) => {
        return event.eventUid;
      }),
    ).toEqual(["kept-1"]);
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: { kind: "Event" },
      props: { isRoot: true },
    });
  });
});
