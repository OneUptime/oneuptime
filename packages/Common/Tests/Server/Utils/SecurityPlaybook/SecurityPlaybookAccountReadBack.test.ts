import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import AccountFixState, {
  AccountFixReading,
} from "../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AccountFixState";
import { SecurityConnectorSettings } from "../../../../Server/Utils/SecurityEvent/Connectors/Types";
import { OKTA_SESSIONS_CLEARED_EVENT } from "../../../../Server/Utils/SecurityEvent/Response/OktaResponseClient";
import {
  ENTRA_ID_AUTHENTICATION_METHODS_PERMISSION,
  ENTRA_ID_MFA_METHOD_TYPES,
} from "../../../../Server/Utils/SecurityEvent/Response/MicrosoftEntraIdResponseClient";
import SecurityPlaybookContainment, {
  AccountFixFacts,
  getEntraIdUserUrl,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  FAKE_ADMIN_EMAIL,
  FAKE_SERVICE_ACCOUNT_JSON,
  FAKE_TOKEN_URI,
} from "../SecurityEvent/Connectors/GoogleWorkspace/GoogleWorkspaceFakeApi";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What a Fix step's check reads back of an account (#10347), through the
 * identity products' own APIs - never changing anything: Okta's
 * passwordChanged, its System Log's user.session.clear and its enrolled
 * factors; Microsoft Entra ID's lastPasswordChangeDateTime,
 * signInSessionsValidFromDateTime and authentication methods; Google
 * Workspace's 2-Step Verification, and its silence on when a password
 * changed. Each product is a mock of its API that answers reads only.
 */

const OPENED: Date = new Date("2026-11-17T19:02:00.000Z");
const NOW: Date = new Date("2026-11-17T21:00:00.000Z");

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

function respond(statusCode: number, body: unknown): DataSourceHttpResponse {
  return { statusCode, bodyText: JSON.stringify(body ?? ""), bodyJson: body };
}

type Transport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

// A product that answers reads, and fails anything that would change it.
function readOnly(
  answer: (url: URL) => DataSourceHttpResponse,
  requests: Array<DataSourceHttpRequest> = [],
): Transport {
  return async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    requests.push(request);

    if (request.url.includes("oauth2")) {
      return respond(200, { access_token: "token", expires_in: 3599 });
    }

    if (request.method !== "GET") {
      throw new Error(`a read-back must not ${request.method} ${request.url}`);
    }

    return answer(new URL(request.url));
  };
}

async function credentials(
  settings: SecurityConnectorSettings,
  value: string,
  transport: Transport,
): Promise<AccountFixFacts | null> {
  return await SecurityPlaybookContainment.readAccountCredentials({
    provider: settings.provider,
    settings,
    value,
    since: OPENED,
    now: NOW,
    transport,
  });
}

async function mfa(
  settings: SecurityConnectorSettings,
  value: string,
  transport: Transport,
): Promise<AccountFixFacts | null> {
  return await SecurityPlaybookContainment.readAccountMfa({
    provider: settings.provider,
    settings,
    value,
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

describe("Okta", () => {
  function okta(data: {
    passwordChanged?: string | null;
    clears?: Array<string>;
    factors?: Array<JSONObject>;
    logsStatus?: number;
    factorsStatus?: number;
  }): { transport: Transport; requests: Array<DataSourceHttpRequest> } {
    const requests: Array<DataSourceHttpRequest> = [];

    return {
      requests,
      transport: readOnly((url: URL): DataSourceHttpResponse => {
        if (url.pathname === "/api/v1/logs") {
          return data.logsStatus
            ? respond(data.logsStatus, { errorCode: "E0000006" })
            : respond(
                200,
                (data.clears || []).map((published: string): JSONObject => {
                  return {
                    eventType: OKTA_SESSIONS_CLEARED_EVENT,
                    published,
                    target: [{ id: "00u1", type: "User" }],
                  };
                }),
              );
        }

        if (url.pathname.endsWith("/factors")) {
          return data.factorsStatus
            ? respond(data.factorsStatus, { errorCode: "E0000006" })
            : respond(200, data.factors || []);
        }

        const login: string = decodeURIComponent(
          url.pathname.split("/").filter(Boolean)[3] || "",
        );

        return login === "alice@acme.com"
          ? respond(200, {
              id: "00u1",
              status: "ACTIVE",
              passwordChanged: data.passwordChanged,
              profile: { login },
            })
          : respond(404, { errorCode: "E0000007" });
      }, requests),
    };
  }

  test("the password's change, and the latest time the System Log says every session was cleared since the case opened", async () => {
    const api: {
      transport: Transport;
      requests: Array<DataSourceHttpRequest>;
    } = okta({
      passwordChanged: "2026-11-17T19:30:00.000Z",
      clears: ["2026-11-17T19:31:00.000Z", "2026-11-17T19:40:00.000Z"],
    });

    expect(
      await credentials(OKTA_SETTINGS, "alice@acme.com", api.transport),
    ).toEqual({
      provider: "Okta",
      canTellPassword: true,
      passwordChangedAt: new Date("2026-11-17T19:30:00.000Z"),
      sessionsEndedAt: new Date("2026-11-17T19:40:00.000Z"),
      hasMfa: null,
      url: "https://acme-admin.okta.com/admin/user/profile/view/00u1",
    });

    const logs: URL = new URL(api.requests[1]!.url);

    expect(logs.origin + logs.pathname).toBe("https://acme.okta.com/api/v1/logs");
    expect(logs.searchParams.get("filter")).toBe(
      'eventType eq "user.session.clear" and target.id eq "00u1"',
    );
    expect(logs.searchParams.get("since")).toBe(OPENED.toISOString());
    expect(logs.searchParams.get("until")).toBe(NOW.toISOString());
    expect(api.requests[1]!.headers?.["Authorization"]).toBe(
      "SSWS 00okta-token",
    );
  });

  test("no session cleared since, and a password Okta says nothing of: both unknown, never made up", async () => {
    expect(
      await credentials(
        OKTA_SETTINGS,
        "alice@acme.com",
        okta({ passwordChanged: null }).transport,
      ),
    ).toMatchObject({ passwordChangedAt: null, sessionsEndedAt: null });
  });

  test("a System Log that cannot be read throws: the step cannot tell, never 'not reset'", async () => {
    const error: Error = await caught(
      credentials(
        OKTA_SETTINGS,
        "alice@acme.com",
        okta({ passwordChanged: "2026-11-17T19:30:00.000Z", logsStatus: 403 })
          .transport,
      ),
    );

    expect(error.message).not.toContain("00okta-token");
  });

  test("an enrolled, active factor is MFA; one pending activation is not", async () => {
    const api: {
      transport: Transport;
      requests: Array<DataSourceHttpRequest>;
    } = okta({
      factors: [
        { id: "f1", factorType: "sms", status: "PENDING_ACTIVATION" },
        { id: "f2", factorType: "push", status: "ACTIVE" },
      ],
    });

    expect(await mfa(OKTA_SETTINGS, "alice@acme.com", api.transport)).toEqual({
      provider: "Okta",
      canTellPassword: false,
      passwordChangedAt: null,
      sessionsEndedAt: null,
      hasMfa: true,
      url: "https://acme-admin.okta.com/admin/user/profile/view/00u1",
    });
    expect(new URL(api.requests[1]!.url).pathname).toBe(
      "/api/v1/users/00u1/factors",
    );

    for (const factors of [
      [],
      [{ id: "f1", factorType: "sms", status: "PENDING_ACTIVATION" }],
    ]) {
      expect(
        (await mfa(OKTA_SETTINGS, "alice@acme.com", okta({ factors }).transport))
          ?.hasMfa,
      ).toBe(false);
    }

    const refused: Error = await caught(
      mfa(OKTA_SETTINGS, "alice@acme.com", okta({ factorsStatus: 403 }).transport),
    );

    expect(refused.message).toContain("cannot read this user's factors");
  });

  test("an account Okta does not have is none", async () => {
    expect(
      await credentials(OKTA_SETTINGS, "nobody@acme.com", okta({}).transport),
    ).toBeNull();
    expect(
      await mfa(OKTA_SETTINGS, "nobody@acme.com", okta({}).transport),
    ).toBeNull();
  });
});

describe("Microsoft Entra ID", () => {
  const USER_ID: string = "11111111-aaaa-4aaa-8aaa-000000000001";

  function entra(data: {
    lastPasswordChange?: string | null;
    validFrom?: string | null;
    methods?: Array<string>;
    methodsStatus?: number;
  }): { transport: Transport; requests: Array<DataSourceHttpRequest> } {
    const requests: Array<DataSourceHttpRequest> = [];

    return {
      requests,
      transport: readOnly((url: URL): DataSourceHttpResponse => {
        if (url.pathname.endsWith("/authentication/methods")) {
          return data.methodsStatus
            ? respond(data.methodsStatus, {
                error: { code: "Authorization_RequestDenied" },
              })
            : respond(200, {
                value: (data.methods || []).map(
                  (type: string): JSONObject => {
                    return { "@odata.type": type, id: type };
                  },
                ),
              });
        }

        if (
          url.searchParams.get("$select") ===
          "lastPasswordChangeDateTime,signInSessionsValidFromDateTime"
        ) {
          return respond(200, {
            lastPasswordChangeDateTime: data.lastPasswordChange,
            signInSessionsValidFromDateTime: data.validFrom,
          });
        }

        return respond(200, {
          id: USER_ID,
          userPrincipalName: "alice@contoso.com",
          accountEnabled: true,
        });
      }, requests),
    };
  }

  test("the password's last change and since when its tokens are valid, both by $select", async () => {
    const api: {
      transport: Transport;
      requests: Array<DataSourceHttpRequest>;
    } = entra({
      lastPasswordChange: "2026-11-17T19:30:00Z",
      validFrom: "2026-11-17T19:31:00Z",
    });

    expect(
      await credentials(ENTRA_SETTINGS, "alice@contoso.com", api.transport),
    ).toEqual({
      provider: "Microsoft Entra ID",
      canTellPassword: true,
      passwordChangedAt: new Date("2026-11-17T19:30:00Z"),
      sessionsEndedAt: new Date("2026-11-17T19:31:00Z"),
      hasMfa: null,
      url: getEntraIdUserUrl("public", USER_ID),
    });
    expect(
      api.requests.some((request: DataSourceHttpRequest): boolean => {
        return request.url.includes(
          `/v1.0/users/${USER_ID}?$select=lastPasswordChangeDateTime,signInSessionsValidFromDateTime`,
        );
      }),
    ).toBe(true);
  });

  test("an authenticator, a key or a phone is MFA; a password, a reset email or a Temporary Access Pass is not", async () => {
    expect(
      (
        await mfa(
          ENTRA_SETTINGS,
          "alice@contoso.com",
          entra({
            methods: [
              "#microsoft.graph.passwordAuthenticationMethod",
              "#microsoft.graph.emailAuthenticationMethod",
              "#microsoft.graph.temporaryAccessPassAuthenticationMethod",
            ],
          }).transport,
        )
      )?.hasMfa,
    ).toBe(false);

    for (const method of ENTRA_ID_MFA_METHOD_TYPES) {
      expect(
        (
          await mfa(
            ENTRA_SETTINGS,
            "alice@contoso.com",
            entra({
              methods: ["#microsoft.graph.passwordAuthenticationMethod", method],
            }).transport,
          )
        )?.hasMfa,
      ).toBe(true);
    }
  });

  test("an app registration that cannot read authentication methods is told which permission it needs", async () => {
    const error: Error = await caught(
      mfa(
        ENTRA_SETTINGS,
        "alice@contoso.com",
        entra({ methodsStatus: 403 }).transport,
      ),
    );

    expect(ENTRA_ID_AUTHENTICATION_METHODS_PERMISSION).toBe(
      "UserAuthenticationMethod.Read.All",
    );
    expect(error.message).toContain("UserAuthenticationMethod.Read.All");
  });
});

describe("Google Workspace", () => {
  function workspace(user: JSONObject | null): Transport {
    return async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      if (request.url === FAKE_TOKEN_URI) {
        return respond(200, { access_token: "ya29.token", expires_in: 3599 });
      }

      if (request.method !== "GET") {
        throw new Error(
          `a read-back must not ${request.method} ${request.url}`,
        );
      }

      return user
        ? respond(200, user)
        : respond(404, { error: { code: 404, message: "Resource Not Found" } });
    };
  }

  const ALICE: JSONObject = {
    id: "104761234567890123456",
    primaryEmail: "alice@example.com",
    suspended: false,
    isEnrolledIn2Sv: true,
  };

  test("says nothing of when a password changed: an account OneUptime cannot tell about", async () => {
    expect(
      await credentials(GOOGLE_SETTINGS, "alice@example.com", workspace(ALICE)),
    ).toEqual({
      provider: "Google Workspace",
      canTellPassword: false,
      passwordChangedAt: null,
      sessionsEndedAt: null,
      hasMfa: null,
      url: "https://admin.google.com/ac/users/104761234567890123456",
    });
  });

  test("2-Step Verification is its MFA", async () => {
    expect(
      (await mfa(GOOGLE_SETTINGS, "alice@example.com", workspace(ALICE)))
        ?.hasMfa,
    ).toBe(true);
    expect(
      (
        await mfa(
          GOOGLE_SETTINGS,
          "alice@example.com",
          workspace({ ...ALICE, isEnrolledIn2Sv: false }),
        )
      )?.hasMfa,
    ).toBe(false);
    expect(
      await mfa(GOOGLE_SETTINGS, "nobody@example.com", workspace(null)),
    ).toBeNull();
  });
});

describe("a product that cannot be read for an account", () => {
  test("is refused by name: OneUptime never guesses", async () => {
    const settings: SecurityConnectorSettings = {
      provider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
      config: {},
      secrets: {},
      alertingOnly: true,
    };

    expect(
      (
        await caught(
          credentials(settings, "alice@acme.com", readOnly(() => {
            return respond(200, {});
          })),
        )
      ).message,
    ).toBe("OneUptime cannot read an account in CrowdStrike Falcon.");
  });
});

describe("every identity product the project is connected to is asked", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function connection(provider: SecurityEventConnectorProvider): SecurityEventConnection {
    const row: SecurityEventConnection = new SecurityEventConnection();
    row.id = ObjectID.generate();
    row.provider = provider;
    return row;
  }

  test("each answers, or says why it could not; a project with none says so", async () => {
    jest
      .spyOn(SecurityEventConnectionService, "findBy")
      .mockResolvedValue([
        connection(SecurityEventConnectorProvider.OktaSystemLog),
        connection(SecurityEventConnectorProvider.MicrosoftEntraId),
      ]);
    jest
      .spyOn(SecurityEventConnectionService, "getConnectorSettings")
      .mockImplementation(
        async (row: SecurityEventConnection): Promise<SecurityConnectorSettings> => {
          return row.provider === SecurityEventConnectorProvider.OktaSystemLog
            ? OKTA_SETTINGS
            : ENTRA_SETTINGS;
        },
      );
    jest
      .spyOn(SecurityPlaybookContainment, "readAccountMfa")
      .mockImplementation(
        async (data: unknown): Promise<AccountFixFacts | null> => {
          if (
            (data as { provider: SecurityEventConnectorProvider }).provider ===
            SecurityEventConnectorProvider.MicrosoftEntraId
          ) {
            throw new Error("Graph timed out");
          }

          return {
            provider: "Okta",
            canTellPassword: false,
            passwordChangedAt: null,
            sessionsEndedAt: null,
            hasMfa: true,
          };
        },
      );

    const reading: AccountFixReading = await AccountFixState.readMfa({
      projectId: ObjectID.generate(),
      value: "alice@acme.com",
    });

    expect(reading.answers).toEqual([
      {
        provider: "Okta",
        facts: {
          provider: "Okta",
          canTellPassword: false,
          passwordChangedAt: null,
          sessionsEndedAt: null,
          hasMfa: true,
        },
      },
      { provider: "Microsoft Entra ID", error: "Graph timed out" },
    ]);

    jest.spyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([]);

    expect(
      await AccountFixState.readCredentials({
        projectId: ObjectID.generate(),
        value: "alice@acme.com",
        since: OPENED,
        now: NOW,
      }),
    ).toEqual({ answers: [] });
  });
});
